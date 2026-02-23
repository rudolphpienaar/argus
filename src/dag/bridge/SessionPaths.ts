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
        const artifactName = (node.produces && node.produces.length > 0)
            ? node.produces[0]
            : `${node.id}.json`;

        // Include the full ancestor chain + the current node for nesting.
        // This ensures the root stage (e.g. 'search') gets its own directory.
        const nesting = [...ancestors, node.id].join('/');

        paths.set(node.id, {
            dataDir: `${nesting}/meta`,
            artifactFile: `${nesting}/meta/${artifactName}`,
        });
    }

    return paths;
}

/**
 * Build the ancestor chain from a node back to the root, following
 * primary parents (first entry in `previous` array), skipping
 * structural and optional nodes — they are transparent to path layout.
 *
 * @param node - The DAG node whose ancestor chain to build.
 * @param definition - The full DAG definition for node lookup.
 * @returns Array of user-facing ancestor IDs from root to immediate parent (NOT including the node itself).
 */
function ancestorChain_build(node: DAGNode, definition: DAGDefinition): string[] {
    const chain: string[] = [];
    let current: DAGNode = node;

    while (current.previous && current.previous.length > 0) {
        const primaryParentId = current.previous[0];
        const parent = definition.nodes.get(primaryParentId);
        if (!parent) break; // defensive

        // Skip structural nodes entirely (implementation details).
        // Skip non-root optional nodes (e.g. 'rename' which is a bypass in a join).
        // Root-level optionals (e.g. 'search' with no parents) ARE canonical path elements.
        const isNonRootOptional = parent.optional && parent.previous !== null && parent.previous.length > 0;
        if (parent.structural || isNonRootOptional) {
            current = parent;
            continue;
        }

        chain.unshift(parent.id);
        current = parent;
    }

    return chain;
}
