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
    // Auto-promote no-commands stages when all their deps are met.
    // This makes no-commands nodes transparent to position resolution.
    const effectiveCompleted = autoExecuteCompletion_resolve(definition, completedIds);

    const staleFn: ((id: string) => boolean) | undefined = staleIds ? (id: string): boolean => staleIds.has(id) : undefined;
    const allReadiness = dag_resolve(definition, effectiveCompleted, staleFn);

    // Topological order via Kahn's algorithm
    const topoOrder = topologicalSort_compute(definition);

    // Find the first ready (not complete) user-facing stage in topological order.
    // No-commands stages are skipped — they are transparent to the user.
    const readinessMap = new Map(allReadiness.map(r => [r.nodeId, r]));
    let currentStage: DAGNode | null = null;

    for (const id of topoOrder) {
        const node: DAGNode | undefined = definition.nodes.get(id);
        if (!node || !nodeHasCommands(node)) continue; // skip no-commands nodes
        const r: NodeReadiness | undefined = readinessMap.get(id);
        if (r && r.ready && !r.complete) {
            currentStage = node;
            break;
        }
    }

    // Only include user-facing (commands-bearing) completed stages in progress counts.
    const completedStages = Array.from(completedIds).filter(id => {
        const node = definition.nodes.get(id);
        return node && nodeHasCommands(node);
    });

    // User-facing total excludes no-commands nodes.
    const userFacingTotal = Array.from(definition.nodes.values()).filter(n => nodeHasCommands(n)).length;

    return {
        completedStages,
        currentStage,
        nextInstruction: currentStage?.instruction ?? null,
        availableCommands: currentStage?.commands ?? [],
        staleStages: staleIds ? Array.from(staleIds) : [],
        allReadiness,
        progress: {
            completed: completedStages.length,
            total: userFacingTotal,
            phase: currentStage?.phase ?? null,
        },
        isComplete: completedStages.length === userFacingTotal,
    };
}

/**
 * Determine whether a DAG node has user-invocable commands.
 * Nodes without commands are auto-executed when their parents complete.
 *
 * @param node - The DAGNode to inspect.
 * @returns True if the node has at least one command, false otherwise.
 */
function nodeHasCommands(node: DAGNode): boolean {
    return Array.isArray(node.commands) && node.commands.length > 0;
}

/**
 * Auto-promote no-commands stages when all their dependencies are met.
 * No-commands stages are implementation-level nodes invisible to the user.
 * They are treated as virtually complete once their deps are satisfied.
 *
 * @param definition - The DAG definition
 * @param completedIds - Set of actually materialized stage IDs
 * @returns Expanded set with no-commands stages auto-promoted
 */
function autoExecuteCompletion_resolve(
    definition: DAGDefinition,
    completedIds: Set<string>,
): Set<string> {
    const effective = new Set(completedIds);
    let changed = true;

    while (changed) {
        changed = false;
        for (const node of definition.nodes.values()) {
            if (nodeHasCommands(node) || effective.has(node.id)) continue;

            const allParentsMet =
                !node.previous || node.previous.every((parentId: string) => effective.has(parentId));

            if (allParentsMet) {
                effective.add(node.id);
                changed = true;
            }
        }
    }

    return effective;
}

/**
 * Compute topological order using Kahn's algorithm.
 *
 * @param definition - The DAG definition containing nodes and edges.
 * @returns Node IDs in topological order (roots first).
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
                const newDeg: number = (inDegree.get(edge.to) ?? 1) - 1;
                inDegree.set(edge.to, newDeg);
                if (newDeg === 0) {
                    queue.push(edge.to);
                }
            }
        }
    }

    return order;
}
