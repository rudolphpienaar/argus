/**
 * @file DAG Validator
 *
 * Validates a DAGDefinition for structural correctness: no cycles,
 * no orphan references, no duplicate IDs, non-empty produces, at
 * least one root node.
 *
 * Uses Kahn's algorithm for cycle detection via topological sort.
 *
 * @module dag/graph
 * @see docs/dag-engine.adoc
 */

import type { DAGDefinition, ValidationResult } from './types.js';

/**
 * Validate a DAGDefinition for structural correctness.
 *
 * @param definition - The DAG to validate
 * @returns ValidationResult with valid flag and error messages
 */
export function dag_validate(definition: DAGDefinition): ValidationResult {
    const errors: string[] = [];

    // Check at least one root node
    if (definition.rootIds.length === 0) {
        errors.push('DAG has no root nodes (no stage with previous: null)');
    }

    // Check produces non-empty for each stage
    for (const node of definition.nodes.values()) {
        if (node.produces.length === 0) {
            errors.push(`Stage '${node.id}': produces must be non-empty`);
        }
    }

    // Check all previous references point to existing nodes (orphan detection)
    for (const node of definition.nodes.values()) {
        if (node.previous) {
            for (const parentId of node.previous) {
                if (!definition.nodes.has(parentId)) {
                    errors.push(`Stage '${node.id}': references nonexistent parent '${parentId}'`);
                }
            }
        }
    }

    // Cycle detection via Kahn's algorithm (topological sort)
    const cycleError = cycles_detect(definition);
    if (cycleError) {
        errors.push(cycleError);
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

/**
 * Detect cycles using Kahn's algorithm.
 * Returns an error message if a cycle exists, null otherwise.
 */
function cycles_detect(definition: DAGDefinition): string | null {
    // Build in-degree map
    const inDegree = new Map<string, number>();
    for (const id of definition.nodes.keys()) {
        inDegree.set(id, 0);
    }
    for (const edge of definition.edges) {
        // Only count edges where both nodes exist
        if (inDegree.has(edge.to)) {
            inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
        }
    }

    // BFS from zero-in-degree nodes
    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
        if (deg === 0) queue.push(id);
    }

    let visited = 0;
    while (queue.length > 0) {
        const current = queue.shift()!;
        visited++;

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

    if (visited < definition.nodes.size) {
        return 'Cycle detected in DAG';
    }
    return null;
}
