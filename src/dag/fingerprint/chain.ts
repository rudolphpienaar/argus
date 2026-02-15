/**
 * @file Merkle Chain Validation
 *
 * Validates the fingerprint chain across materialized artifacts.
 * Detects staleness when a parent has been re-executed, causing
 * downstream artifacts to be based on outdated data.
 *
 * @module dag/fingerprint
 * @see docs/dag-engine.adoc
 */

import type {
    StalenessResult,
    ChainValidationResult,
    FingerprintRecord,
} from './types.js';
import type { DAGDefinition } from '../graph/types.js';

/**
 * Check a single stage for staleness by comparing its recorded parent
 * fingerprints against the current parent fingerprints.
 *
 * @param stageId - The stage to check
 * @param recorded - The fingerprint record from this stage's artifact
 * @param currentParentFingerprints - Current fingerprints of parent stages
 * @returns StalenessResult indicating whether the stage is stale
 */
export function staleness_check(
    stageId: string,
    recorded: FingerprintRecord,
    currentParentFingerprints: Record<string, string>,
): StalenessResult {
    const staleParents: string[] = [];

    for (const [parentId, recordedFp] of Object.entries(recorded.parentFingerprints)) {
        const currentFp = currentParentFingerprints[parentId];
        if (currentFp !== undefined && currentFp !== recordedFp) {
            staleParents.push(parentId);
        }
    }

    return {
        stageId,
        stale: staleParents.length > 0,
        staleParents,
        currentFingerprint: recorded.fingerprint,
    };
}

/**
 * Artifact reader function type. Given a stage ID, returns the
 * fingerprint record from its materialized artifact, or null if
 * the stage has no artifact.
 */
export type ArtifactFingerprintReader = (stageId: string) => FingerprintRecord | null;

/**
 * Validate the entire Merkle chain for a DAG definition.
 *
 * Walks topologically, checking each materialized artifact's recorded
 * parent fingerprints against the current parent fingerprints. Staleness
 * cascades: if a parent is stale, its children are stale too.
 *
 * @param definition - The DAG definition
 * @param artifactReader - Function to read fingerprint records from artifacts
 * @returns ChainValidationResult with stale and missing stages
 */
export function chain_validate(
    definition: DAGDefinition,
    artifactReader: ArtifactFingerprintReader,
): ChainValidationResult {
    const staleStages: StalenessResult[] = [];
    const missingStages: string[] = [];

    // Build current fingerprint map as we walk
    const currentFingerprints = new Map<string, string>();
    // Track stale stage IDs for cascading
    const staleIds = new Set<string>();

    // Topological order via Kahn's algorithm
    const topoOrder = topologicalSort(definition);

    for (const stageId of topoOrder) {
        const record = artifactReader(stageId);

        if (!record) {
            missingStages.push(stageId);
            continue;
        }

        // Record this stage's current fingerprint
        currentFingerprints.set(stageId, record.fingerprint);

        // Build current parent fingerprints for comparison
        const node = definition.nodes.get(stageId);
        const parentIds = node?.previous ?? [];
        const currentParentFps: Record<string, string> = {};

        let parentIsStale = false;
        for (const parentId of parentIds) {
            const fp = currentFingerprints.get(parentId);
            if (fp) {
                currentParentFps[parentId] = fp;
            }
            if (staleIds.has(parentId)) {
                parentIsStale = true;
            }
        }

        // Check staleness
        const result = staleness_check(stageId, record, currentParentFps);

        // Cascade: if any parent is stale, this stage is stale too
        if (parentIsStale && !result.stale) {
            result.stale = true;
            // Add the stale parents from upstream
            for (const parentId of parentIds) {
                if (staleIds.has(parentId) && !result.staleParents.includes(parentId)) {
                    result.staleParents.push(parentId);
                }
            }
        }

        if (result.stale) {
            staleStages.push(result);
            staleIds.add(stageId);
        }
    }

    return {
        valid: staleStages.length === 0 && missingStages.length === 0,
        staleStages,
        missingStages,
    };
}

/** Compute topological order using Kahn's algorithm. */
function topologicalSort(definition: DAGDefinition): string[] {
    const inDegree = new Map<string, number>();
    for (const id of definition.nodes.keys()) {
        inDegree.set(id, 0);
    }
    for (const edge of definition.edges) {
        if (inDegree.has(edge.to)) {
            inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
        }
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
        if (deg === 0) queue.push(id);
    }

    const order: string[] = [];
    while (queue.length > 0) {
        const current = queue.shift()!;
        order.push(current);
        for (const edge of definition.edges) {
            if (edge.from === current && inDegree.has(edge.to)) {
                const newDeg = (inDegree.get(edge.to) ?? 1) - 1;
                inDegree.set(edge.to, newDeg);
                if (newDeg === 0) {
                    queue.push(edge.to);
                }
            }
        }
    }

    return order;
}
