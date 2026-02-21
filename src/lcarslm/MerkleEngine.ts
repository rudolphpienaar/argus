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

/**
 * Orchestrates the creation and storage of Merkle-proven artifacts.
 */
export class MerkleEngine {
    private readonly backend: VfsBackend;
    private readonly sessionStore: SessionStore;

    constructor(
        private vfs: VirtualFileSystem,
        private workflowAdapter: WorkflowAdapter,
        private sessionPath: string,
    ) {
        this.backend = new VfsBackend(vfs);
        this.sessionStore = new SessionStore(
            this.backend,
            '/runtime-not-used',
        );
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
     * Resolve the physical directory where a plugin should materialize its payload.
     */
    public async dataDir_resolve(stageId: string): Promise<string> {
        const stage: DAGNode | undefined = this.workflowAdapter.dag.nodes.get(stageId);
        const stagePath: StagePath | undefined = this.workflowAdapter.stagePaths.get(stageId);
        if (!stage || !stagePath) {
            throw new Error(`Cannot resolve dataDir for unknown stage ${stageId}`);
        }

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
        const finalArtifactPath: string = await this.artifactPath_storeResolve(basePath, stage.id, null);
        
        // The data directory is the parent of the final artifact path
        return finalArtifactPath.substring(0, finalArtifactPath.lastIndexOf('/'));
    }

    /**
     * Materialize a skip sentinel for an auto-declined optional stage.
     *
     * Used when a user proceeds past an optional stage (e.g. rename) without
     * executing it. The sentinel enters the Merkle chain so the provenance
     * records the explicit decision to skip.
     *
     * @param stageId - The optional stage being declined.
     * @param reason - Human-readable reason for the skip.
     */
    public async skipSentinel_materialize(stageId: string, reason: string): Promise<void> {
        await this.artifact_materialize(stageId, { skipped: true, reason });
    }

    /**
     * Materialize a workflow stage artifact with Merkle fingerprinting.
     *
     * @param stageId - The ID of the stage being materialized.
     * @param content - Domain-specific content block (artifactData from plugin).
     * @param materialized - Optional list of side-effect files created by this stage.
     */
    public async artifact_materialize(
        stageId: string, 
        content: Record<string, unknown>,
        materialized?: string[],
        dataDirOverride?: string,
    ): Promise<void> {
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
            materialized,
            _fingerprint,
            _parent_fingerprints: parentFingerprints
        };

        await this.artifact_storeWrite(stage, stagePath, envelope, dataDirOverride);
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
        dataDirOverride?: string,
    ): Promise<void> {
        let dataDir: string;
        if (dataDirOverride) {
            dataDir = dataDirOverride;
        } else {
            const session: Session = this.session_resolve();
            const stagePathSegments: string[] = this.stagePathSegments_resolve(stagePath);
            const effectivePathSegments: string[] = await this.stagePathForWrite_resolve(
                session,
                stage,
                stagePathSegments,
            );
            dataDir = this.sessionStore.stagePath_resolve(session, effectivePathSegments);
        }
        const artifactName: string = stagePath.artifactFile.split('/').pop() || `${stage.id}.json`;
        const basePath: string = `${dataDir}/${artifactName}`;
        const finalPath: string = await this.artifactPath_storeResolve(basePath, stage.id, envelope._fingerprint);
        
        if (process.env.CALYPSO_VERBOSE === 'true') {
            console.log(`[MerkleEngine] Materializing ${stage.id} -> ${finalPath}`);
        }

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
        // stagePath.artifactFile is e.g. "search/gather/data/gather.json"
        // We want ["search", "gather"]
        const parts = stagePath.artifactFile.split('/');
        // Remove the filename and the 'data' directory
        return parts.filter(p => p !== 'data' && !p.endsWith('.json')).filter(Boolean);
    }

    private async stagePathForWrite_resolve(
        session: Session,
        stage: DAGNode,
        stagePath: string[],
    ): Promise<string[]> {
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
        const activeParentPaths = new Set<string>();
        const activeParentIds: string[] = [];

        for (const parentId of sortedParentIds) {
            const parentNode = this.workflowAdapter.dag.nodes.get(parentId);
            
            // v10.2.1: Optional parents don't affect physical nesting.
            // They are resolved via JOIN semantics (real artifact or skip sentinel)
            // but don't create join nodes in the session tree.
            if (parentNode?.optional) continue;

            // Check if parent actually has an artifact.
            const parentFp = this.fingerprint_get(parentId);
            if (!parentFp) {
                return null;
            }

            const parentPath = await this.stagePathWithJoins_resolve(session, parentId, cache);
            if (!parentPath) return null;
            
            const pathKey = parentPath.join('/');
            if (activeParentPaths.has(pathKey)) continue;

            parentPaths[parentId] = parentPath;
            activeParentIds.push(parentId);
            activeParentPaths.add(pathKey);
        }

        // If only one parent path is active after filtering, don't create a join node
        if (activeParentIds.length === 1) {
            const resolved = [...parentPaths[activeParentIds[0]], stageId];
            cache.set(stageId, resolved);
            return resolved;
        }

        const anchorParentId = this.joinAnchorParent_resolve(activeParentIds, parentPaths);
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

    private async artifactPath_storeResolve(basePath: string, stageId: string, newFingerprint: string | null): Promise<string> {
        const exists: boolean = await this.backend.path_exists(basePath);
        if (!exists) {
            return basePath;
        }

        // v10.2: Root stages (no parents) update in-place instead of branching.
        // This keeps the base of the tree predictable for the developer.
        const node = this.workflowAdapter.dag.nodes.get(stageId);
        if (!node || !node.previous || node.previous.length === 0) {
            return basePath;
        }

        // v10.2: Only branch if the stage has ALREADY been completed (has a fingerprint)
        // AND the new content is actually different.
        const currentFp = this.fingerprint_get(stageId);
        if (!currentFp) {
            return basePath;
        }

        // If we have a new fingerprint and it matches the current one, don't branch.
        if (newFingerprint && newFingerprint === currentFp) {
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
