/**
 * @file DAG Resolver
 *
 * Resolves node readiness and workflow position from a DAGDefinition
 * and a set of completed stage IDs. This is the primary contact surface
 * between the DAG engine and consumers like CalypsoCore.
 *
 * @module dag/graph
 * @see docs/dag-engine.adoc
 */

import type {
    DAGDefinition,
    DAGNode,
    NodeReadiness,
    WorkflowPosition,
} from './types.js';

/**
 * Resolve readiness for all nodes in a DAG.
 *
 * @param definition - The DAG definition
 * @param completedIds - Set of stage IDs whose artifacts exist
 * @param staleFn - Optional function that returns true if a stage is stale
 * @returns Array of NodeReadiness for every node
 */
export function dag_resolve(
    definition: DAGDefinition,
    completedIds: Set<string>,
    staleFn?: (id: string) => boolean,
): NodeReadiness[] {
    const result: NodeReadiness[] = [];

    for (const node of definition.nodes.values()) {
        const complete = completedIds.has(node.id);
        const pendingParents: string[] = [];

        if (node.previous) {
            for (const parentId of node.previous) {
                if (!completedIds.has(parentId)) {
                    pendingParents.push(parentId);
                }
            }
        }

        const ready = !complete && pendingParents.length === 0;
        const stale = staleFn ? staleFn(node.id) : false;

        result.push({
            nodeId: node.id,
            ready,
            complete,
            stale,
            pendingParents,
        });
    }

    return result;
}

/**
 * Resolve the current workflow position.
 *
 * Walks the DAG in topological order to find the first ready-but-incomplete
 * stage, which becomes the "current" stage. This is the primary output
 * consumed by CalypsoCore.
 *
 * @param definition - The DAG definition
 * @param completedIds - Set of stage IDs whose artifacts exist
 * @param staleIds - Optional set of stale stage IDs
 * @returns WorkflowPosition describing "where are we?"
 */
export function position_resolve(
    definition: DAGDefinition,
    completedIds: Set<string>,
    staleIds?: Set<string>,
): WorkflowPosition {
    const staleFn = staleIds ? (id: string) => staleIds.has(id) : undefined;
    const allReadiness = dag_resolve(definition, completedIds, staleFn);

    // Topological order via Kahn's algorithm
    const topoOrder = topologicalSort_compute(definition);

    // Find the first ready (not complete) stage in topological order
    const readinessMap = new Map(allReadiness.map(r => [r.nodeId, r]));
    let currentStage: DAGNode | null = null;

    for (const id of topoOrder) {
        const r = readinessMap.get(id);
        if (r && r.ready && !r.complete) {
            currentStage = definition.nodes.get(id) ?? null;
            break;
        }
    }

    const completedStages = Array.from(completedIds).filter(id =>
        definition.nodes.has(id),
    );

    return {
        completedStages,
        currentStage,
        nextInstruction: currentStage?.instruction ?? null,
        availableCommands: currentStage?.commands ?? [],
        staleStages: staleIds ? Array.from(staleIds) : [],
        allReadiness,
        progress: {
            completed: completedStages.length,
            total: definition.nodes.size,
            phase: currentStage?.phase ?? null,
        },
        isComplete: completedStages.length === definition.nodes.size,
    };
}

/**
 * Compute topological order using Kahn's algorithm.
 * Returns node IDs in topological order.
 */
function topologicalSort_compute(definition: DAGDefinition): string[] {
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
