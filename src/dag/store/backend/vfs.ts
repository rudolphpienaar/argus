/**
 * @file VFS Storage Backend
 *
 * Implements StorageBackend against the in-memory VirtualFileSystem.
 * All methods are async for interface compatibility, but the underlying
 * VFS operations are synchronous.
 *
 * @module dag/store/backend
 * @see docs/dag-engine.adoc
 */

import type { StorageBackend } from '../types.js';
import type { VirtualFileSystem } from '../../../vfs/VirtualFileSystem.js';

/**
 * VFS-backed StorageBackend.
 *
 * Wraps the existing VirtualFileSystem with the async StorageBackend
 * interface. VFS has no real symlinks, so link_create writes a JSON
 * reference file instead.
 */
export class VfsBackend implements StorageBackend {
    constructor(private readonly vfs: VirtualFileSystem) {}

    async artifact_write(path: string, data: string): Promise<void> {
        // Ensure parent directory exists
        const parentPath = path.substring(0, path.lastIndexOf('/'));
        if (parentPath) {
            this.vfs.dir_create(parentPath);
        }
        // Create file if it doesn't exist, then write content
        const stat = this.vfs.node_stat(path);
        if (!stat) {
            this.vfs.file_create(path);
        }
        this.vfs.node_write(path, data);
    }

    async artifact_read(path: string): Promise<string | null> {
        const stat = this.vfs.node_stat(path);
        if (!stat || stat.type !== 'file') return null;
        return this.vfs.node_read(path);
    }

    async path_exists(path: string): Promise<boolean> {
        return this.vfs.node_stat(path) !== null;
    }

    async link_create(source: string, target: string): Promise<void> {
        // VFS has no symlinks — write a JSON reference file
        const linkContent = JSON.stringify({ __link: true, target });
        await this.artifact_write(source, linkContent);
    }

    async children_list(path: string): Promise<string[]> {
        const stat = this.vfs.node_stat(path);
        if (!stat || stat.type !== 'folder') return [];
        const children = this.vfs.dir_list(path);
        return children.map(child => child.name);
    }

    async dir_create(path: string): Promise<void> {
        this.vfs.dir_create(path);
    }
}
