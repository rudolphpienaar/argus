/**
 * @file Session Path Resolver
 *
 * Computes topology-aware session tree paths for each DAG stage.
 * The session tree mirrors the DAG topology: each stage's directory
 * nests under its primary parent, creating a filesystem structure
 * that IS the provenance chain.
 *
 * Layout:
 *   session-root/
 *     data/search.json                                   ← root stage
 *     gather/
 *       data/gather.json                                 ← child of root
 *       rename/
 *         data/rename.json                               ← child of gather
 *       harmonize/
 *         data/harmonize.json                            ← child of gather (primary parent)
 *         code/
 *           data/code.json
 *           train/
 *             data/train.json
 *             federate-brief/
 *               data/federate-brief.json
 *               ...
 *
 * @module dag/bridge
 * @see docs/dag-engine.adoc
 */

import type { DAGDefinition, DAGNode } from '../graph/types.js';

/**
 * Artifact location within the session tree.
 *
 * @property dataDir - Relative path to the stage's data/ directory (from session root)
 * @property artifactFile - Full relative path to the artifact JSON file
 */
export interface StagePath {
    dataDir: string;
    artifactFile: string;
}

/**
 * Compute topology-aware session tree paths for all stages in a DAG.
 *
 * Walks the parent chain for each node to build the nesting path.
 * For multi-parent nodes (join points), the first parent in the
 * `previous` array is the primary parent for nesting.
 *
 * @param definition - Parsed DAG definition
 * @returns Map of stage ID → StagePath
 */
export function sessionPaths_compute(definition: DAGDefinition): Map<string, StagePath> {
    const paths = new Map<string, StagePath>();

    for (const node of definition.nodes.values()) {
        const ancestors = ancestorChain_build(node, definition);

        if (ancestors.length === 0) {
            // Root node: artifact at rootPath/data/<id>.json
            paths.set(node.id, {
                dataDir: 'data',
                artifactFile: `data/${node.id}.json`,
            });
        } else {
            // Non-root: nest under ancestors (skip the root ancestor since
            // it maps to rootPath/ implicitly)
            const nesting = [...ancestors.slice(1), node.id].join('/');
            paths.set(node.id, {
                dataDir: `${nesting}/data`,
                artifactFile: `${nesting}/data/${node.id}.json`,
            });
        }
    }

    return paths;
}

/**
 * Build the ancestor chain from a node back to the root, following
 * primary parents (first entry in `previous` array).
 *
 * @returns Array of ancestor IDs from root to immediate parent (NOT including the node itself)
 */
function ancestorChain_build(node: DAGNode, definition: DAGDefinition): string[] {
    const chain: string[] = [];
    let current: DAGNode = node;

    while (current.previous && current.previous.length > 0) {
        const primaryParentId = current.previous[0];
        const parent = definition.nodes.get(primaryParentId);
        if (!parent) break; // defensive
        chain.unshift(parent.id);
        current = parent;
    }

    return chain;
}
