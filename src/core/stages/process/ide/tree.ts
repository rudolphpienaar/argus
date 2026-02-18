/**
 * @file Process IDE Tree Builder
 *
 * Builds a recursive VFS tree snapshot for the Process-stage file browser.
 *
 * @module core/stages/process/ide/tree
 */

import { store } from '../../../state/store.js';
import type { FileNode as VfsFileNode } from '../../../../vfs/types.js';

/**
 * Build a recursive IDE tree from a VFS path.
 *
 * @param rootPath - Absolute VFS path.
 * @returns Recursive file node tree or null when path is not resolvable.
 */
export function ideTree_build(rootPath: string): VfsFileNode | null {
    return treeNode_build(rootPath);
}

/**
 * Build one recursive node from path.
 */
function treeNode_build(path: string): VfsFileNode | null {
    try {
        const node: VfsFileNode | null = store.globals.vcs.node_stat(path);
        if (!node) {
            return null;
        }

        if (node.type !== 'folder') {
            return node;
        }

        return treeFolder_build(node);
    } catch {
        return null;
    }
}

/**
 * Build a folder node with recursive children.
 */
function treeFolder_build(folderNode: VfsFileNode): VfsFileNode {
    return {
        ...folderNode,
        children: folderChildren_build(folderNode.path),
    };
}

/**
 * Build all children for a folder path.
 */
function folderChildren_build(folderPath: string): VfsFileNode[] {
    const children: VfsFileNode[] = [];

    try {
        const directChildren: VfsFileNode[] = store.globals.vcs.dir_list(folderPath);
        for (const child of directChildren) {
            const builtChild: VfsFileNode | null = treeNode_build(child.path);
            if (builtChild) {
                children.push(builtChild);
            }
        }
    } catch {
        return [];
    }

    return children;
}
