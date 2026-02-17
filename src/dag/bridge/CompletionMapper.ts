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
import type { DAGDefinition } from '../graph/types.js';
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
    aliases: Record<string, string | null> = {},
): CompletionMapper {
    const checks: Record<string, CompletionCheck> = {};

    for (const [stageId] of pathMap) {
        const targetId = aliases[stageId];

        if (targetId === null) {
            // Explicitly never auto-completes (action/terminal stage)
            checks[stageId] = () => false;
        } else {
            const finalTargetId = targetId || stageId;
            const targetPath = pathMap.get(finalTargetId);
            if (targetPath) {
                checks[stageId] = (vfs, sessionPath) =>
                    vfsExists(vfs, `${sessionPath}/${targetPath.artifactFile}`);
            }
        }
    }

    return completionMapper_create(checks);
}

// ─── Manifest Completion Mapper ────────────────────────────────

/**
 * Create a generic completion mapper from a DAG definition.
 *
 * Reads 'completes_with' aliases directly from the manifest stages.
 * If 'completes_with' is 'null', the stage is an action/terminal stage
 * that never auto-completes.
 *
 * @param definition - Parsed DAG definition (manifest)
 * @param pathMap - Topology-aware path map
 */
export function manifestMapper_create(
    definition: DAGDefinition,
    pathMap: Map<string, StagePath>,
): CompletionMapper {
    const aliases: Record<string, string | null> = {};

    for (const node of definition.nodes.values()) {
        if (node.completes_with !== undefined) {
            aliases[node.id] = node.completes_with;
        }
    }

    return topologyMapper_create(pathMap, aliases);
}
