/**
 * @file DAG Renderer
 *
 * Visualization engine for ARGUS workflows. Supports multiple rendering
 * modes including ASCII Tree, Compact paths, and Boxed Graphviz glyphs.
 *
 * @module dag/visualizer/DagRenderer
 */

import type { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import type { 
    DAGDefinition, 
    DAGNode, 
    WorkflowPosition, 
    ManifestHeader 
} from '../graph/types.js';
import type { DagRenderOptions } from '../bridge/WorkflowAdapter.js';
import { dagBoxGraphviz_render, type DagBoxNodeInput, type DagBoxEdgeInput } from './graphvizBox.js';

/**
 * Context required for rendering a DAG.
 */
export interface DagRenderContext {
    vfs: VirtualFileSystem;
    sessionPath: string;
    definition: DAGDefinition;
    position: WorkflowPosition;
    workflowId: string;
    
    /** Resolver for parent nodes during visualization. */
    displayParents_resolve: (node: DAGNode, visibleSet: Set<string>) => string[];
}

/**
 * Visualization engine for workflow Directed Acyclic Graphs.
 */
export class DagRenderer {
    /**
     * Render the DAG visualization based on provided options.
     *
     * @param options - Rendering controls.
     * @param ctx - Rendering context.
     * @returns Multi-line DAG visualization string.
     */
    public dag_render(options: DagRenderOptions, ctx: DagRenderContext): string {
        const includeStructural: boolean = options.includeStructural !== false;
        const includeOptional: boolean = options.includeOptional !== false;
        const compact: boolean = options.compact === true;
        const box: boolean = options.box === true;
        const showWhere: boolean = options.showWhere !== false;
        const showStale: boolean = options.showStale === true;

        const { vfs, sessionPath, definition, position, workflowId } = ctx;
        const header = definition.header as ManifestHeader;

        const orderedNodes: DAGNode[] = definition.orderedNodeIds
            .map((id: string): DAGNode | undefined => definition.nodes.get(id))
            .filter((node: DAGNode | undefined): node is DAGNode => Boolean(node));
            
        const orderIndex: Map<string, number> = new Map<string, number>(
            orderedNodes.map((node: DAGNode, index: number): [string, number] => [node.id, index]),
        );

        const visibleNodes: DAGNode[] = orderedNodes.filter((node: DAGNode): boolean => {
            const hasCommands = Array.isArray(node.commands) && node.commands.length > 0;
            if (!includeStructural && !hasCommands) return false;
            if (!includeOptional && node.optional) return false;
            return true;
        });

        if (visibleNodes.length === 0) {
            return `DAG [${workflowId}] ${header.name}
(no visible stages with current filters)`;
        }

        const visibleSet: Set<string> = new Set<string>(visibleNodes.map((node: DAGNode): string => node.id));
        const parentMultiMap: Map<string, string[]> = new Map<string, string[]>();
        const parentMap: Map<string, string | null> = new Map<string, string | null>();
        const childrenMap: Map<string, string[]> = new Map<string, string[]>();
        const childrenPrimaryMap: Map<string, string[]> = new Map<string, string[]>();

        for (const node of visibleNodes) {
            childrenMap.set(node.id, []);
            childrenPrimaryMap.set(node.id, []);
        }

        for (const node of visibleNodes) {
            const parents: string[] = ctx.displayParents_resolve(node, visibleSet)
                .sort((left: string, right: string): number => (orderIndex.get(left) ?? 0) - (orderIndex.get(right) ?? 0));
            parentMultiMap.set(node.id, parents);

            const parentId: string | null = parents.length > 0 ? parents[0] : null;
            parentMap.set(node.id, parentId);
            for (const p of parents) {
                if (childrenMap.has(p)) {
                    childrenMap.get(p)!.push(node.id);
                }
            }
            if (parentId && childrenPrimaryMap.has(parentId)) {
                childrenPrimaryMap.get(parentId)!.push(node.id);
            }
        }

        // Sort children for deterministic output
        for (const children of childrenMap.values()) {
            children.sort((left: string, right: string): number => {
                return (orderIndex.get(left) ?? 0) - (orderIndex.get(right) ?? 0);
            });
        }
        for (const children of childrenPrimaryMap.values()) {
            children.sort((left: string, right: string): number => {
                return (orderIndex.get(left) ?? 0) - (orderIndex.get(right) ?? 0);
            });
        }

        const roots: string[] = visibleNodes
            .map((node: DAGNode): string => node.id)
            .filter((id: string): boolean => !parentMap.get(id))
            .sort((left: string, right: string): number => (orderIndex.get(left) ?? 0) - (orderIndex.get(right) ?? 0));

        const lines: string[] = [];
        lines.push(`DAG [${workflowId}] ${header.name}`);
        lines.push(`Progress: ${position.progress.completed}/${position.progress.total} stages`);
        lines.push(`Legend: ● complete  ◉ current  ○ pending  ◌ optional pending  ! stale`);
        lines.push('');

        const marker_resolve = (node: DAGNode): string => {
            const isCurrent: boolean = showWhere && position.currentStage?.id === node.id;
            const isComplete: boolean = position.completedStages.includes(node.id);
            const isStale: boolean = showStale && position.staleStages.includes(node.id);

            if (isStale) return '!';
            if (isCurrent) return '◉';
            if (isComplete) return '●';
            if (node.optional) return '◌';
            return '○';
        };

        const nodeLine_format = (node: DAGNode): string => {
            const isCurrent: boolean = showWhere && position.currentStage?.id === node.id;
            const isStale: boolean = showStale && position.staleStages.includes(node.id);
            const marker: string = marker_resolve(node);

            const tags: string[] = [];
            const hasCommands = Array.isArray(node.commands) && node.commands.length > 0;
            if (node.optional) tags.push('optional');
            if (!hasCommands) tags.push('auto-execute');
            if (isCurrent) tags.push('current');
            if (isStale) tags.push('stale');
            if (node.previous && node.previous.length > 1) {
                tags.push(`join:${node.previous.join('+')}`);
            }

            const tagSuffix: string = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
            return `${marker} ${node.id} — ${node.name}${tagSuffix}`;
        };

        if (box) {
            const boxNodes: DagBoxNodeInput[] = visibleNodes.map((node: DAGNode): DagBoxNodeInput => ({
                id: node.id,
                line1: `${marker_resolve(node)} ${node.id}${node.optional ? ' (opt)' : ''}`,
                line2: `${node.name}${node.previous && node.previous.length > 1 ? ' [join]' : ''}`,
                order: orderIndex.get(node.id) ?? 0,
            }));
            const boxEdges: DagBoxEdgeInput[] = [];
            for (const child of visibleNodes) {
                const parents: string[] = parentMultiMap.get(child.id) || [];
                for (const parent of parents) {
                    boxEdges.push({ from: parent, to: child.id });
                }
            }
            const boxLines: string[] = dagBoxGraphviz_render({ nodes: boxNodes, edges: boxEdges });
            return [...lines, ...boxLines].join('\n');
        }

        if (compact) {
            for (const nodeId of visibleNodes.map((node: DAGNode): string => node.id)) {
                const node: DAGNode | undefined = definition.nodes.get(nodeId);
                if (!node) continue;
                const parentId: string = parentMap.get(nodeId) || 'ROOT';
                lines.push(`${nodeLine_format(node)}  <- ${parentId}`);
            }
            return lines.join('\n');
        }

        // Tree rendering
        const renderTree = (nodeId: string, prefix: string, isLast: boolean, isRoot: boolean): void => {
            const node: DAGNode | undefined = definition.nodes.get(nodeId);
            if (!node) return;

            if (isRoot) {
                lines.push(nodeLine_format(node));
            } else {
                const branch: string = isLast ? '└─ ' : '├─ ';
                lines.push(`${prefix}${branch}${nodeLine_format(node)}`);
            }

            const children: string[] = childrenPrimaryMap.get(nodeId) || [];
            const nextPrefix: string = isRoot
                ? ''
                : `${prefix}${isLast ? '   ' : '│  '}`;
            children.forEach((childId: string, index: number): void => {
                renderTree(childId, nextPrefix, index === children.length - 1, false);
            });
        };

        roots.forEach((rootId: string, index: number): void => {
            renderTree(rootId, '', index === roots.length - 1, true);
            if (index !== roots.length - 1) {
                lines.push('');
            }
        });

        return lines.join('\n');
    }
}
