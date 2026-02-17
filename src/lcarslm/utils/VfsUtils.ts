/**
 * @file VFS Utilities for Calypso
 *
 * Helper functions for serializing and snapshotting the VirtualFileSystem.
 *
 * @module lcarslm/utils/vfs
 */

import type { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import type { FileNode } from '../../vfs/types.js';
import type { VfsSnapshotNode } from '../types.js';

/**
 * Take a snapshot of a VFS subtree.
 */
export function vfs_snapshot(
    vfs: VirtualFileSystem,
    rootPath: string = '/',
    includeContent: boolean = false
): VfsSnapshotNode | null {
    const resolved: string = vfs.path_resolve(rootPath);
    const node: FileNode | null = vfs.node_stat(resolved);

    if (!node) return null;
    return node_serialize(node, includeContent);
}

/**
 * Serialize a FileNode to a VfsSnapshotNode.
 */
function node_serialize(node: FileNode, includeContent: boolean): VfsSnapshotNode {
    const serialized: VfsSnapshotNode = {
        name: node.name,
        type: node.type,
        path: node.path
    };

    if (node.type === 'file') {
        serialized.size = node.size;
        if (includeContent && node.content !== null) {
            serialized.content = node.content;
        }
        if (node.contentGenerator) {
            serialized.hasGenerator = true;
        }
    }

    if (node.type === 'folder' && node.children) {
        serialized.children = node.children
            .map((child: FileNode): VfsSnapshotNode => node_serialize(child, includeContent))
            .sort((a: VfsSnapshotNode, b: VfsSnapshotNode): number => a.name.localeCompare(b.name));
    }

    return serialized;
}
