/**
 * @file Gather Stage VFS Tree Helpers
 *
 * Utilities for projecting VirtualFileSystem state into UI-friendly trees.
 *
 * Responsibilities:
 * - Build recursive `VcsFileNode` snapshots rooted at a path.
 * - Compute aggregate leaf-file counts for selection/cost summaries.
 *
 * These helpers are intentionally side-effect free with respect to stage
 * orchestration and only read from the active VFS singleton.
 *
 * @module core/stages/gather/utils/tree
 */

import { store } from '../../../state/store.js';
import type { FileNode as VcsFileNode } from '../../../../vfs/types.js';

/**
 * Recursively builds a VFS-backed tree node rooted at `path`.
 */
export function vfsTree_build(path: string): VcsFileNode | null {
    try {
        const node: VcsFileNode | null = store.globals.vcs.node_stat(path);
        if (!node) {
            return null;
        }

        if (node.type !== 'folder') {
            return node;
        }

        const children: VcsFileNode[] = store.globals.vcs.dir_list(path);
        const populatedChildren: VcsFileNode[] = children
            .map((child: VcsFileNode): VcsFileNode | null => vfsTree_build(child.path))
            .filter((resolvedNode: VcsFileNode | null): resolvedNode is VcsFileNode => resolvedNode !== null);

        return {
            ...node,
            children: populatedChildren,
        };
    } catch {
        return null;
    }
}

/**
 * Count total leaf files in a `VcsFileNode` tree.
 */
export function fileCount_total(node: VcsFileNode): number {
    if (!node.children) {
        return 1;
    }

    let count: number = 0;
    for (const child of node.children) {
        count += fileCount_total(child);
    }
    return count;
}
