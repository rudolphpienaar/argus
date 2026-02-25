/**
 * @file MerkleEngine - High-Integrity Provenance Materializer
 *
 * Responsible for wrapping domain-specific content in Merkle-proven
 * artifact envelopes and materializing them into the session tree.
 *
 * v12.0: Pure-Literal Topology. The engine injects NO structural nodes.
 * physical paths strictly follow node.previous[0] pointers.
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
        
        const stageDir: string = this.sessionStore.stagePath_resolve(session, effectivePathSegments);
        
        // v12.0: Physical Contract - Return STAGE ROOT.
        // PluginHost handles input/ and output/ creation.
        await this.backend.dir_create(stageDir);
        
        return stageDir;
    }

    /**
     * Materialize a skip sentinel for an auto-declined optional stage.
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
     * @param dataDirOverride - Optional stage directory path to write to instead of computing from topology.
     * @returns Promise that resolves when the artifact has been written.
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
     *
     * @param node - The DAGNode whose parent fingerprints to collect.
     * @returns Map of parentId → fingerprint string for all materialized parents.
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
     *
     * @param stageId - Stage ID to look up.
     * @returns The fingerprint string, or null if no artifact exists.
     */
    private fingerprint_get(stageId: string): string | null {
        const record: FingerprintRecord | null = this.workflowAdapter.latestFingerprint_get(
            this.vfs,
            this.sessionPath,
            stageId
        );
        return record ? record.fingerprint : null;
    }

    /**
     * Write an artifact envelope to the session tree's meta/ directory.
     *
     * @param stage - The DAGNode being materialized.
     * @param stagePath - Topology-aware path descriptor for this stage.
     * @param envelope - Fully assembled Merkle artifact envelope.
     * @param dataDirOverride - If provided, skip topology resolution and write here.
     * @returns Promise that resolves when the artifact file has been created.
     */
    private async artifact_storeWrite(
        stage: DAGNode,
        stagePath: StagePath,
        envelope: ArtifactEnvelope,
        dataDirOverride?: string,
    ): Promise<void> {
        let stageDir: string;
        if (dataDirOverride) {
            stageDir = dataDirOverride.replace(/\/output$/, '');
        } else {
            const session: Session = this.session_resolve();
            const stagePathSegments: string[] = this.stagePathSegments_resolve(stagePath);
            const effectivePathSegments: string[] = await this.stagePathForWrite_resolve(
                session,
                stage,
                stagePathSegments,
            );
            stageDir = this.sessionStore.stagePath_resolve(session, effectivePathSegments);
        }

        // v12.0: System ledger files go into meta/
        const metaDir = `${stageDir}/meta`;
        await this.backend.dir_create(metaDir);

        const artifactName: string = stagePath.artifactFile.split('/').pop() || `${stage.id}.json`;
        const basePath: string = `${metaDir}/${artifactName}`;
        const finalPath: string = await this.artifactPath_storeResolve(basePath, stage.id, envelope._fingerprint);
        
        if (process.env.CALYPSO_VERBOSE === 'true') {
            console.log(`[MerkleEngine] Materializing ${stage.id} -> ${finalPath}`);
        }

        await this.backend.artifact_write(
            finalPath,
            JSON.stringify(envelope, null, 2),
        );
    }

    /**
     * Build a minimal runtime Session record from the current engine state.
     *
     * @returns Session object suitable for use with SessionStore path resolution.
     */
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

    /**
     * Extract directory segment names from a topology-aware StagePath.
     * Strips 'data', 'meta', and artifact filename components.
     *
     * @param stagePath - The StagePath computed from the DAG topology.
     * @returns Array of directory segment names in topological nesting order.
     */
    private stagePathSegments_resolve(stagePath: StagePath): string[] {
        const parts = stagePath.artifactFile.split('/');
        return parts.filter(p => p !== 'data' && p !== 'meta' && !p.endsWith('.json')).filter(Boolean);
    }

    /**
     * Resolve the effective path segments to use when writing an artifact.
     * Prefers literal manifest-order resolution over topology-derived segments.
     *
     * @param session - The runtime Session record.
     * @param stage - The DAGNode being materialized.
     * @param stagePath - Fallback path segments from topology.
     * @returns Path segments to pass to SessionStore for directory resolution.
     */
    private async stagePathForWrite_resolve(
        session: Session,
        stage: DAGNode,
        stagePath: string[],
    ): Promise<string[]> {
        const cache = new Map<string, string[]>();
        const resolved: string[] | null = await this.stagePathLiteral_resolve(
            stage.id,
            cache,
        );
        return resolved && resolved.length > 0 ? resolved : stagePath;
    }

    /**
     * Strictly literal path resolution following primary parent chain.
     * All stages — including joins, gates, and resolvers — appear in the
     * provenance path. Descendants nest under their primary parent (previous[0]).
     */
    private async stagePathLiteral_resolve(
        stageId: string,
        cache: Map<string, string[]>,
    ): Promise<string[] | null> {
        const cached = cache.get(stageId);
        if (cached) return cached;

        const node: DAGNode | undefined = this.workflowAdapter.dag.nodes.get(stageId);
        if (!node) return null;

        // Base case: root nodes (no parents)
        if (!node.previous || node.previous.length === 0) {
            const rootPath = [stageId];
            cache.set(stageId, rootPath);
            return rootPath;
        }

        // Follow primary parent (previous[0]) for path nesting.
        // Every stage appears in the chain — no transparency skipping.
        const primaryParentId = node.previous[0];
        const parentPath = await this.stagePathLiteral_resolve(primaryParentId, cache);
        if (!parentPath) return null;

        const resolved = [...parentPath, stageId];
        cache.set(stageId, resolved);
        return resolved;
    }

    /**
     * Resolve the final artifact file path, branching if the fingerprint changed.
     * Prevents overwriting prior artifacts by creating a BRANCH-suffixed path on divergence.
     *
     * @param basePath - The canonical artifact path (meta/stageId.json).
     * @param stageId - Stage ID for fingerprint lookup.
     * @param newFingerprint - The fingerprint of the artifact being written.
     * @returns The final file path to write to (may be a branched path).
     */
    private async artifactPath_storeResolve(basePath: string, stageId: string, newFingerprint: string | null): Promise<string> {
        const exists: boolean = await this.backend.path_exists(basePath);
        if (!exists) {
            return basePath;
        }

        const node = this.workflowAdapter.dag.nodes.get(stageId);
        if (!node || !node.previous || node.previous.length === 0) {
            return basePath;
        }

        const currentFp = this.fingerprint_get(stageId);
        if (!currentFp) {
            return basePath;
        }

        if (newFingerprint && newFingerprint === currentFp) {
            return basePath;
        }

        const branchSuffix: string = Date.now().toString();
        const canonical: string = basePath.replace(
            `/${stageId}/meta/`,
            `/${stageId}_BRANCH_${branchSuffix}/meta/`,
        );
        if (canonical !== basePath) {
            return canonical;
        }

        const marker = '/meta/';
        const markerPos = basePath.lastIndexOf(marker);
        if (markerPos < 0) {
            return `${basePath}_BRANCH_${branchSuffix}`;
        }

        const stagePrefix = basePath.slice(0, markerPos);
        const afterMarker = basePath.slice(markerPos);
        return `${stagePrefix}_BRANCH_${branchSuffix}${afterMarker}`;
    }
}
