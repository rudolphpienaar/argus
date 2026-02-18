/**
 * @file MerkleEngine - High-Integrity Provenance Materializer
 *
 * Responsible for wrapping domain-specific content in Merkle-proven
 * artifact envelopes and materializing them into the session tree.
 *
 * @module lcarslm/MerkleEngine
 */

import type { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import { fingerprint_compute } from '../dag/fingerprint/hasher.js';
import type { FingerprintRecord } from '../dag/fingerprint/types.js';
import type { ArtifactEnvelope } from '../dag/store/types.js';
import type { DAGNode, StageParameters } from '../dag/graph/types.js';
import { WorkflowAdapter } from '../dag/bridge/WorkflowAdapter.js';
import type { StagePath } from '../dag/bridge/SessionPaths.js';
import { SessionStore } from '../dag/store/SessionStore.js';
import { VfsBackend } from '../dag/store/backend/vfs.js';
import type { Session } from '../dag/store/types.js';

export type RuntimeMaterializationMode = 'legacy' | 'store';

export interface MerkleEngineConfig {
    runtimeMode?: RuntimeMaterializationMode;
    joinMaterializationEnabled?: boolean;
}

/**
 * Orchestrates the creation and storage of Merkle-proven artifacts.
 */
export class MerkleEngine {
    private static legacyDeprecationShown: boolean = false;
    private readonly runtimeMode: RuntimeMaterializationMode;
    private readonly joinMaterializationEnabled: boolean;
    private readonly backend: VfsBackend;
    private readonly sessionStore: SessionStore;

    constructor(
        private vfs: VirtualFileSystem,
        private workflowAdapter: WorkflowAdapter,
        private sessionPath: string,
        config: MerkleEngineConfig = {},
    ) {
        this.runtimeMode = config.runtimeMode ?? 'store';
        this.joinMaterializationEnabled = config.joinMaterializationEnabled ?? true;
        this.backend = new VfsBackend(vfs);
        this.sessionStore = new SessionStore(
            this.backend,
            '/runtime-not-used',
            { rootStageInOwnDirectory: true },
        );

        if (this.runtimeMode === 'legacy' && !MerkleEngine.legacyDeprecationShown) {
            MerkleEngine.legacyDeprecationShown = true;
            console.warn(
                '[ARGUS][DEPRECATION] runtimeMode=legacy write path is deprecated. ' +
                'Use runtimeMode=store with join materialization enabled.',
            );
        }
    }

    /**
     * Update the session path for subsequent materializations.
     *
     * @param sessionPath - The new absolute session path.
     */
    public session_setPath(sessionPath: string): void {
        this.sessionPath = sessionPath;
    }

    /**
     * Materialize a workflow stage artifact with Merkle fingerprinting.
     *
     * @param stageId - The ID of the stage being materialized.
     * @param content - Domain-specific content block (artifactData from plugin).
     */
    public async artifact_materialize(stageId: string, content: Record<string, unknown>): Promise<void> {
        const stage: DAGNode | undefined = this.workflowAdapter.dag.nodes.get(stageId);
        const stagePath: StagePath | undefined = this.workflowAdapter.stagePaths.get(stageId);
        if (!stage || !stagePath) {
            return;
        }

        const parentFingerprints: Record<string, string> = this.parentFingerprints_resolve(stage);
        
        // Handle parameters: use provided args or manifest defaults
        const parameters_used: StageParameters = (content.args !== undefined)
            ? { args: content.args } as StageParameters
            : stage.parameters;
        
        const contentStr: string = JSON.stringify(content);
        const _fingerprint: string = fingerprint_compute(contentStr, parentFingerprints);

        const tsNow: Date = new Date();
        const timestamp: string = tsNow.toISOString() + '-' + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        
        const envelope: ArtifactEnvelope = {
            stage: stageId,
            timestamp,
            parameters_used,
            content,
            _fingerprint,
            _parent_fingerprints: parentFingerprints
        };

        if (this.runtimeMode === 'store') {
            await this.artifact_storeWrite(stage, stagePath, envelope);
            return;
        }

        const finalPath: string = this.artifactPath_resolve(stageId, stagePath, tsNow);

        // Ensure parent directory exists
        const parentDir: string = finalPath.substring(0, finalPath.lastIndexOf('/'));
        try {
            this.vfs.dir_create(parentDir);
        } catch { /* exists */ }

        this.vfs.file_create(finalPath, JSON.stringify(envelope, null, 2));
    }

    /**
     * Resolve the fingerprints of all parent stages.
     */
    private parentFingerprints_resolve(node: DAGNode): Record<string, string> {
        const parentFingerprints: Record<string, string> = {};
        if (node.previous) {
            for (const parentId of node.previous) {
                const fp: string | null = this.fingerprint_get(parentId);
                if (fp) {
                    parentFingerprints[parentId] = fp;
                }
            }
        }
        return parentFingerprints;
    }

    /**
     * Resolve the physical path for an artifact, creating a branch if needed.
     */
    private artifactPath_resolve(stageId: string, stagePath: StagePath, tsNow: Date): string {
        const baseDir: string = `${this.sessionPath}/${stagePath.artifactFile}`;
        if (this.vfs.node_stat(baseDir) !== null) {
            const branchSuffix: string = tsNow.getTime().toString();
            const branchPath: string = stagePath.artifactFile.replace(
                `${stageId}/data/`, 
                `${stageId}_BRANCH_${branchSuffix}/data/`
            );
            return `${this.sessionPath}/${branchPath}`;
        }
        return baseDir;
    }

    /**
     * Read the fingerprint from the latest materialized artifact for a stage.
     */
    private fingerprint_get(stageId: string): string | null {
        const record: FingerprintRecord | null = this.workflowAdapter.latestFingerprint_get(
            this.vfs,
            this.sessionPath,
            stageId
        );
        return record ? record.fingerprint : null;
    }

    private async artifact_storeWrite(
        stage: DAGNode,
        stagePath: StagePath,
        envelope: ArtifactEnvelope,
    ): Promise<void> {
        const session: Session = this.session_resolve();
        const stagePathSegments: string[] = this.stagePathSegments_resolve(stagePath);
        const effectivePathSegments: string[] = await this.stagePathForWrite_resolve(
            session,
            stage,
            stagePathSegments,
        );
        const dataDir: string = this.sessionStore.stagePath_resolve(session, effectivePathSegments);
        const artifactName: string = stagePath.artifactFile.split('/').pop() || `${stage.id}.json`;
        const basePath: string = `${dataDir}/${artifactName}`;
        const finalPath: string = await this.artifactPath_storeResolve(basePath, stage.id);
        await this.backend.artifact_write(
            finalPath,
            JSON.stringify(envelope, null, 2),
        );
    }

    private session_resolve(): Session {
        const now = new Date().toISOString();
        return {
            id: 'runtime',
            persona: this.workflowAdapter.workflowId,
            manifestVersion: 'runtime',
            created: now,
            lastActive: now,
            rootPath: this.sessionPath,
        };
    }

    private stagePathSegments_resolve(stagePath: StagePath): string[] {
        const stageDir: string = stagePath.dataDir.replace(/\/data$/, '');
        return stageDir.split('/').filter(Boolean);
    }

    private async stagePathForWrite_resolve(
        session: Session,
        stage: DAGNode,
        stagePath: string[],
    ): Promise<string[]> {
        if (!this.joinMaterializationEnabled) {
            return stagePath;
        }
        const cache = new Map<string, string[]>();
        const resolved: string[] | null = await this.stagePathWithJoins_resolve(
            session,
            stage.id,
            cache,
        );
        return resolved && resolved.length > 0 ? resolved : stagePath;
    }

    private async stagePathWithJoins_resolve(
        session: Session,
        stageId: string,
        cache: Map<string, string[]>,
    ): Promise<string[] | null> {
        const cached = cache.get(stageId);
        if (cached) {
            return cached;
        }

        const node: DAGNode | undefined = this.workflowAdapter.dag.nodes.get(stageId);
        if (!node) {
            return null;
        }

        if (!node.previous || node.previous.length === 0) {
            const rootPath = [stageId];
            cache.set(stageId, rootPath);
            return rootPath;
        }

        if (node.previous.length === 1) {
            const parentPath = await this.stagePathWithJoins_resolve(session, node.previous[0], cache);
            if (!parentPath) {
                return null;
            }
            const resolved = [...parentPath, stageId];
            cache.set(stageId, resolved);
            return resolved;
        }

        const parentPaths: Record<string, string[]> = {};
        const sortedParentIds = [...node.previous].sort();
        for (const parentId of sortedParentIds) {
            const parentPath = await this.stagePathWithJoins_resolve(session, parentId, cache);
            if (!parentPath) {
                return null;
            }
            parentPaths[parentId] = parentPath;
        }

        const anchorParentId = this.joinAnchorParent_resolve(sortedParentIds, parentPaths);
        const nestUnderPath = parentPaths[anchorParentId];
        const joinName = await this.sessionStore.joinNode_materialize(
            session,
            parentPaths,
            nestUnderPath,
        );
        const resolved = [...nestUnderPath, joinName, stageId];
        cache.set(stageId, resolved);
        return resolved;
    }

    private joinAnchorParent_resolve(
        sortedParentIds: string[],
        parentPaths: Record<string, string[]>,
    ): string {
        let anchorId = sortedParentIds[0];
        for (const parentId of sortedParentIds.slice(1)) {
            const current = parentPaths[parentId];
            const anchor = parentPaths[anchorId];
            if (
                current.length > anchor.length ||
                (current.length === anchor.length && parentId.localeCompare(anchorId) > 0)
            ) {
                anchorId = parentId;
            }
        }
        return anchorId;
    }

    private async artifactPath_storeResolve(basePath: string, stageId: string): Promise<string> {
        const exists: boolean = await this.backend.path_exists(basePath);
        if (!exists) {
            return basePath;
        }

        const branchSuffix: string = Date.now().toString();
        const canonical: string = basePath.replace(
            `/${stageId}/data/`,
            `/${stageId}_BRANCH_${branchSuffix}/data/`,
        );
        if (canonical !== basePath) {
            return canonical;
        }

        const marker = '/data/';
        const markerPos = basePath.lastIndexOf(marker);
        if (markerPos < 0) {
            return `${basePath}_BRANCH_${branchSuffix}`;
        }

        const stagePrefix = basePath.slice(0, markerPos);
        const afterMarker = basePath.slice(markerPos);
        return `${stagePrefix}_BRANCH_${branchSuffix}${afterMarker}`;
    }
}
