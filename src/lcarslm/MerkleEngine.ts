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

/**
 * Orchestrates the creation and storage of Merkle-proven artifacts.
 */
export class MerkleEngine {
    constructor(
        private vfs: VirtualFileSystem,
        private workflowAdapter: WorkflowAdapter,
        private sessionPath: string
    ) {}

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
    public artifact_materialize(stageId: string, content: Record<string, unknown>): void {
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
}
