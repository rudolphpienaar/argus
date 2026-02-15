/**
 * @file Completion Mapper
 *
 * Maps DAG stage IDs to session tree artifact checks for completion resolution.
 * This is the bridge between the manifest-driven DAG engine and the
 * session tree. Each stage's completion is determined by checking whether
 * its artifact envelope exists at the topology-aware location in the session tree.
 *
 * Session tree layout mirrors the DAG topology:
 *   ~/sessions/<persona>/session-<id>/<nested-path>/data/<stageId>.json
 *
 * @module dag/bridge
 * @see docs/dag-engine.adoc
 */

import type { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import type { StagePath } from './SessionPaths.js';

/**
 * A completion check function. Returns true if the stage is complete.
 * The second parameter is the session root path (e.g. ~/sessions/fedml/session-xxx).
 */
export type CompletionCheck = (vfs: VirtualFileSystem, sessionPath: string) => boolean;

/**
 * Completion mapper interface.
 *
 * Maps stage IDs to session tree artifact checks and resolves the set of
 * completed stage IDs for a given VFS + session state.
 */
export interface CompletionMapper {
    /** Resolve which stages are complete by checking session tree artifacts. */
    completedIds_resolve(vfs: VirtualFileSystem, sessionPath: string): Set<string>;
}

/**
 * Create a CompletionMapper from a stage-to-check mapping.
 *
 * @param checks - Map of stage ID → session tree completion check function
 * @returns CompletionMapper instance
 */
export function completionMapper_create(
    checks: Record<string, CompletionCheck>,
): CompletionMapper {
    return {
        completedIds_resolve(vfs: VirtualFileSystem, sessionPath: string): Set<string> {
            const completed = new Set<string>();
            for (const [stageId, check] of Object.entries(checks)) {
                if (check(vfs, sessionPath)) {
                    completed.add(stageId);
                }
            }
            return completed;
        },
    };
}

// ─── VFS Helper ────────────────────────────────────────────────

/** Check if a VFS path exists. */
function vfsExists(vfs: VirtualFileSystem, path: string): boolean {
    return vfs.node_stat(path) !== null;
}

// ─── Topology-Aware Mapper Factory ─────────────────────────────

/**
 * Create a CompletionMapper from a topology-aware path map.
 *
 * Each stage checks for its artifact at the topology-aware location
 * computed from the DAG structure. Stages can be aliased to share
 * a single artifact check (e.g. search → gather, rename → gather,
 * all federation sub-stages → federate).
 *
 * @param pathMap - Map of stage ID → StagePath (from sessionPaths_compute)
 * @param aliases - Map of stage ID → target stage ID whose artifact to check
 * @returns CompletionMapper instance
 */
export function topologyMapper_create(
    pathMap: Map<string, StagePath>,
    aliases: Record<string, string> = {},
): CompletionMapper {
    const checks: Record<string, CompletionCheck> = {};

    for (const [stageId] of pathMap) {
        const targetId = aliases[stageId] || stageId;
        const targetPath = pathMap.get(targetId);
        if (targetPath) {
            checks[stageId] = (vfs, sessionPath) =>
                vfsExists(vfs, `${sessionPath}/${targetPath.artifactFile}`);
        }
    }

    return completionMapper_create(checks);
}

// ─── FedML Completion Mapper ───────────────────────────────────

/**
 * Create the FedML completion mapper from topology-aware paths.
 *
 * Search and rename are aliased to gather (subsumed/optional).
 * All federation sub-stages are aliased to a single federate artifact.
 *
 * @param pathMap - Topology-aware path map from WorkflowAdapter
 */
export function fedmlMapper_create(pathMap?: Map<string, StagePath>): CompletionMapper {
    if (!pathMap) {
        // Fallback for tests that don't have a DAGDefinition
        // This should not be used in production — WorkflowAdapter always passes pathMap
        return completionMapper_create({});
    }

    return topologyMapper_create(pathMap, {
        'search': 'gather',       // subsumed by gather
        'rename': 'gather',       // optional, completes with gather
        'federate-brief': 'federate-brief',
        'federate-transcompile': 'federate-brief',
        'federate-containerize': 'federate-brief',
        'federate-publish-config': 'federate-brief',
        'federate-publish-execute': 'federate-brief',
        'federate-dispatch': 'federate-brief',
        'federate-execute': 'federate-brief',
        'federate-model-publish': 'federate-brief',
    });
}

// ─── ChRIS Completion Mapper ───────────────────────────────────

/**
 * Create the ChRIS plugin completion mapper from topology-aware paths.
 *
 * Publish is an action/terminal stage that never auto-completes.
 *
 * @param pathMap - Topology-aware path map from WorkflowAdapter
 */
export function chrisMapper_create(pathMap?: Map<string, StagePath>): CompletionMapper {
    if (!pathMap) {
        return completionMapper_create({});
    }

    const checks: Record<string, CompletionCheck> = {};
    for (const [stageId] of pathMap) {
        if (stageId === 'publish') {
            checks[stageId] = () => false; // Action/terminal, never auto-complete
        } else {
            const path = pathMap.get(stageId);
            if (path) {
                checks[stageId] = (vfs, sessionPath) =>
                    vfsExists(vfs, `${sessionPath}/${path.artifactFile}`);
            }
        }
    }
    return completionMapper_create(checks);
}
