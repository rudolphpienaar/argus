/**
 * @file VirtualFileSystem — Core VCS Component
 *
 * In-memory POSIX-like filesystem with content support, path resolution,
 * lazy content generation, and event emission.
 *
 * All methods follow the RPN naming convention: <subject>_<verb>.
 *
 * @module
 */

import type { FileNode, VfsChangeEvent, CwdChangeEvent } from './types.js';
import { events, Events } from '../core/state/events.js';

/**
 * Callback signature for content generators used by the ContentRegistry.
 * The VFS holds a reference to a generator resolver function injected at construction.
 */
type ContentResolver = (generatorKey: string, filePath: string) => string | null;

/**
 * In-memory POSIX-like virtual filesystem.
 *
 * Provides tree storage, content storage, CWD management, path resolution
 * (with ~ expansion and .. normalization), lazy content generation via an
 * injectable ContentResolver, and event emission through the application EventBus.
 *
 * @example
 * ```typescript
 * const vfs = new VirtualFileSystem('user');
 * vfs.dir_create('~/projects/my-study/src');
 * vfs.file_create('~/projects/my-study/src/train.py', '# training script');
 * const content: string | null = vfs.node_read('~/projects/my-study/src/train.py');
 * ```
 */
export class VirtualFileSystem {
    private root: FileNode;
    private cwd: string;
    private homePath: string;
    private contentResolver: ContentResolver | null = null;

    constructor(username: string = 'user') {
        this.homePath = `/home/${username}`;
        this.cwd = this.homePath;
        this.root = node_create('', 'folder', '/');
        // Bootstrap minimal structure: /home/<username>
        this.dir_create(this.homePath);
    }

    // ─── Content Resolver ───────────────────────────────────────

    /**
     * Injects the content resolver function. Called by the ContentRegistry
     * after both VFS and registry are initialized.
     *
     * @param resolver - Function that maps a generator key + file path to content.
     */
    public contentResolver_set(resolver: ContentResolver): void {
        this.contentResolver = resolver;
    }

    // ─── Path Resolution ────────────────────────────────────────

    /**
     * Resolves a user-facing path string to an absolute path.
     * Handles ~, ., .., and relative paths against $PWD.
     *
     * @param input - Raw path string (absolute, relative, or tilde-prefixed).
     * @returns Normalized absolute path.
     */
    public path_resolve(input: string): string {
        if (!input) return this.cwd;

        let segments: string[];

        if (input === '~' || input.startsWith('~/')) {
            // Tilde expansion
            const rest: string = input === '~' ? '' : input.substring(2);
            segments = this.homePath.split('/').filter(Boolean);
            if (rest) {
                segments.push(...rest.split('/').filter(Boolean));
            }
        } else if (input.startsWith('/')) {
            // Absolute path
            segments = input.split('/').filter(Boolean);
        } else {
            // Relative path
            segments = this.cwd.split('/').filter(Boolean);
            segments.push(...input.split('/').filter(Boolean));
        }

        // Normalize . and ..
        const normalized: string[] = [];
        for (const seg of segments) {
            if (seg === '.') continue;
            if (seg === '..') {
                if (normalized.length > 0) normalized.pop();
            } else {
                normalized.push(seg);
            }
        }

        return '/' + normalized.join('/');
    }

    // ─── CWD ────────────────────────────────────────────────────

    /**
     * Returns the current working directory as an absolute path.
     *
     * @returns Absolute path of $PWD.
     */
    public cwd_get(): string {
        return this.cwd;
    }

    /**
     * Changes the current working directory.
     * Throws if the path does not exist or is not a folder.
     * Emits CWD_CHANGED.
     *
     * @param path - Target directory (absolute, relative, or tilde-prefixed).
     */
    public cwd_set(path: string): void {
        const resolved: string = this.path_resolve(path);
        const node: FileNode | null = this.node_at(resolved);
        if (!node) {
            throw new Error(`cd: ${path}: No such file or directory`);
        }
        if (node.type !== 'folder') {
            throw new Error(`cd: ${path}: Not a directory`);
        }
        const oldPath: string = this.cwd;
        this.cwd = resolved;
        events.emit(Events.CWD_CHANGED, { oldPath, newPath: resolved });
    }

    /**
     * Returns the absolute path of $HOME for the current user.
     *
     * @returns Absolute home directory path (e.g., '/home/developer').
     */
    public home_get(): string {
        return this.homePath;
    }

    // ─── Node Operations ────────────────────────────────────────

    /**
     * Reads file content. Triggers lazy generation if contentGenerator is set.
     * Returns null for folders. Throws if path does not exist.
     *
     * @param path - File path to read.
     * @returns File content string, or null if the file is a folder or has no content.
     */
    public node_read(path: string): string | null {
        const resolved: string = this.path_resolve(path);
        const node: FileNode | null = this.node_at(resolved);
        if (!node) {
            throw new Error(`cat: ${path}: No such file or directory`);
        }
        if (node.type === 'folder') return null;

        // Lazy content generation
        if (node.content === null && node.contentGenerator && this.contentResolver) {
            const generated: string | null = this.contentResolver(node.contentGenerator, resolved);
            if (generated !== null) {
                node.content = generated;
                node.size = size_format(generated.length);
                node.modified = new Date();
            }
        }

        return node.content;
    }

    /**
     * Writes content to a file. Creates the file if it doesn't exist
     * (parent must exist). Emits VFS_CHANGED.
     *
     * @param path - File path to write.
     * @param content - String content to write.
     */
    public node_write(path: string, content: string): void {
        const resolved: string = this.path_resolve(path);
        let node: FileNode | null = this.node_at(resolved);

        if (node && node.type === 'folder') {
            throw new Error(`write: ${path}: Is a directory`);
        }

        if (!node) {
            // Create the file — parent must exist
            const parentPath: string = path_parent(resolved);
            const parent: FileNode | null = this.node_at(parentPath);
            if (!parent || parent.type !== 'folder') {
                throw new Error(`write: ${path}: Parent directory does not exist`);
            }
            const name: string = path_basename(resolved);
            node = node_create(name, 'file', resolved);
            parent.children!.push(node);
        }

        node.content = content;
        node.contentGenerator = null; // Content is now explicit
        node.size = size_format(content.length);
        node.modified = new Date();

        this.event_emit(resolved, 'write');
    }

    /**
     * Removes a file or folder. Throws if folder is not empty unless recursive.
     * Emits VFS_CHANGED.
     *
     * @param path - Path to remove.
     * @param recursive - If true, removes non-empty directories.
     */
    public node_remove(path: string, recursive: boolean = false): void {
        const resolved: string = this.path_resolve(path);
        if (resolved === '/') {
            throw new Error('rm: cannot remove root');
        }

        const node: FileNode | null = this.node_at(resolved);
        if (!node) {
            throw new Error(`rm: ${path}: No such file or directory`);
        }

        if (node.type === 'folder' && node.children && node.children.length > 0 && !recursive) {
            throw new Error(`rm: ${path}: Directory not empty`);
        }

        const parentPath: string = path_parent(resolved);
        const parent: FileNode | null = this.node_at(parentPath);
        if (parent && parent.children) {
            parent.children = parent.children.filter((c: FileNode): boolean => c.path !== resolved);
        }

        this.event_emit(resolved, 'remove');
    }

    /**
     * Copies a file or folder tree (deep copy). Emits VFS_CHANGED.
     *
     * @param src - Source path to copy from.
     * @param dest - Destination path to copy to.
     */
    public node_copy(src: string, dest: string): void {
        const srcResolved: string = this.path_resolve(src);
        const destResolved: string = this.path_resolve(dest);
        const srcNode: FileNode | null = this.node_at(srcResolved);

        if (!srcNode) {
            throw new Error(`cp: ${src}: No such file or directory`);
        }

        const destParent: string = this.path_resolve(path_parent(destResolved));
        const parent: FileNode | null = this.node_at(destParent);
        if (!parent || parent.type !== 'folder') {
            throw new Error(`cp: ${dest}: Parent directory does not exist`);
        }

        const clone: FileNode = node_cloneDeep(srcNode, destResolved);
        parent.children!.push(clone);

        this.event_emit(destResolved, 'copy');
    }

    /**
     * Moves/renames a file or folder. Reparents and updates paths recursively.
     * Emits VFS_CHANGED.
     *
     * @param src - Source path to move from.
     * @param dest - Destination path to move to.
     */
    public node_move(src: string, dest: string): void {
        const srcResolved: string = this.path_resolve(src);
        const destResolved: string = this.path_resolve(dest);
        const srcNode: FileNode | null = this.node_at(srcResolved);

        if (!srcNode) {
            throw new Error(`mv: ${src}: No such file or directory`);
        }

        // Remove from old parent
        const oldParentPath: string = path_parent(srcResolved);
        const oldParent: FileNode | null = this.node_at(oldParentPath);
        if (oldParent && oldParent.children) {
            oldParent.children = oldParent.children.filter((c: FileNode): boolean => c.path !== srcResolved);
        }

        // Add to new parent
        const newParentPath: string = path_parent(destResolved);
        const newParent: FileNode | null = this.node_at(newParentPath);
        if (!newParent || newParent.type !== 'folder') {
            throw new Error(`mv: ${dest}: Parent directory does not exist`);
        }

        srcNode.name = path_basename(destResolved);
        node_repath(srcNode, destResolved);
        newParent.children!.push(srcNode);

        this.event_emit(destResolved, 'move');
    }

    /**
     * Returns the FileNode at the given path without reading content.
     * Returns null if the path does not exist.
     *
     * @param path - Path to stat.
     * @returns The FileNode, or null if not found.
     */
    public node_stat(path: string): FileNode | null {
        const resolved: string = this.path_resolve(path);
        return this.node_at(resolved);
    }

    /**
     * Returns the children of a directory.
     * Throws if path does not exist or is not a folder.
     *
     * @param path - Directory path to list.
     * @returns Array of child FileNodes.
     */
    public dir_list(path: string): FileNode[] {
        const resolved: string = this.path_resolve(path);
        const node: FileNode | null = this.node_at(resolved);
        if (!node) {
            throw new Error(`ls: ${path}: No such file or directory`);
        }
        if (node.type !== 'folder' || !node.children) {
            throw new Error(`ls: ${path}: Not a directory`);
        }
        return node.children;
    }

    /**
     * Creates a directory. Creates intermediate directories (like mkdir -p).
     * Emits VFS_CHANGED.
     *
     * @param path - Directory path to create.
     */
    public dir_create(path: string): void {
        const resolved: string = this.path_resolve(path);
        const segments: string[] = resolved.split('/').filter(Boolean);
        let current: FileNode = this.root;

        for (let i: number = 0; i < segments.length; i++) {
            const seg: string = segments[i];
            const childPath: string = '/' + segments.slice(0, i + 1).join('/');

            if (!current.children) {
                current.children = [];
            }

            let child: FileNode | undefined = current.children.find((c: FileNode): boolean => c.name === seg);
            if (!child) {
                child = node_create(seg, 'folder', childPath);
                current.children.push(child);
            } else if (child.type !== 'folder') {
                throw new Error(`mkdir: ${childPath}: Not a directory`);
            }
            current = child;
        }

        this.event_emit(resolved, 'mkdir');
    }

    /**
     * Creates an empty file (like touch). Optionally with initial content
     * or a content generator key for lazy evaluation.
     * Emits VFS_CHANGED.
     *
     * @param path - File path to create.
     * @param content - Optional initial content string.
     * @param generatorKey - Optional ContentRegistry key for lazy generation.
     */
    public file_create(path: string, content?: string, generatorKey?: string): void {
        const resolved: string = this.path_resolve(path);

        // Ensure parent exists
        const parentPath: string = path_parent(resolved);
        const parent: FileNode | null = this.node_at(parentPath);
        if (!parent || parent.type !== 'folder') {
            throw new Error(`touch: ${path}: Parent directory does not exist`);
        }

        // Skip if already exists
        const existing: FileNode | null = this.node_at(resolved);
        if (existing) {
            existing.modified = new Date();
            return;
        }

        const name: string = path_basename(resolved);
        const node: FileNode = node_create(name, 'file', resolved);
        if (content !== undefined) {
            node.content = content;
            node.size = size_format(content.length);
        }
        if (generatorKey) {
            node.contentGenerator = generatorKey;
        }
        parent.children!.push(node);

        this.event_emit(resolved, 'touch');
    }

    /**
     * Invalidates cached content, forcing regeneration on next read.
     * Only affects files with a contentGenerator key.
     *
     * @param path - File path to invalidate.
     */
    public node_invalidate(path: string): void {
        const resolved: string = this.path_resolve(path);
        const node: FileNode | null = this.node_at(resolved);
        if (node && node.type === 'file' && node.contentGenerator) {
            node.content = null;
        }
    }

    // ─── Mount / Unmount ────────────────────────────────────────

    /**
     * Mounts a subtree at the given path. Used by Providers to attach
     * generated filesystem trees. Creates the parent directory if needed.
     * Emits VFS_CHANGED.
     *
     * @param path - Absolute mount point path.
     * @param subtree - Root FileNode of the subtree to mount.
     */
    public tree_mount(path: string, subtree: FileNode): void {
        const resolved: string = this.path_resolve(path);
        const parentPath: string = path_parent(resolved);

        // Ensure parent directory exists
        this.dir_create(parentPath);
        const parent: FileNode | null = this.node_at(parentPath);
        if (!parent || parent.type !== 'folder') {
            throw new Error(`mount: ${path}: Cannot mount — parent is not a directory`);
        }

        // Remove existing node at this path if any
        if (parent.children) {
            parent.children = parent.children.filter((c: FileNode): boolean => c.name !== subtree.name);
        }

        // Repath the subtree to match the mount point
        node_repath(subtree, resolved);
        subtree.name = path_basename(resolved);
        parent.children!.push(subtree);

        this.event_emit(resolved, 'mount');
    }

    /**
     * Removes a previously mounted subtree. Emits VFS_CHANGED.
     *
     * @param path - Absolute path of the subtree to unmount.
     */
    public tree_unmount(path: string): void {
        const resolved: string = this.path_resolve(path);
        const parentPath: string = path_parent(resolved);
        const parent: FileNode | null = this.node_at(parentPath);
        const name: string = path_basename(resolved);

        if (parent && parent.children) {
            parent.children = parent.children.filter((c: FileNode): boolean => c.name !== name);
        }

        this.event_emit(resolved, 'unmount');
    }

    // ─── Internal Helpers ───────────────────────────────────────

    /**
     * Traverses the tree to find a node by absolute path.
     *
     * @param absolutePath - Normalized absolute path (no ~ or ..).
     * @returns The FileNode at that path, or null if not found.
     */
    private node_at(absolutePath: string): FileNode | null {
        if (absolutePath === '/') return this.root;

        const segments: string[] = absolutePath.split('/').filter(Boolean);
        let current: FileNode = this.root;

        for (const seg of segments) {
            if (!current.children) return null;
            const child: FileNode | undefined = current.children.find((c: FileNode): boolean => c.name === seg);
            if (!child) return null;
            current = child;
        }

        return current;
    }

    /**
     * Emits a VFS_CHANGED event through the application EventBus.
     *
     * @param path - Path that was affected.
     * @param operation - The mutation type.
     */
    private event_emit(path: string, operation: VfsChangeEvent['operation']): void {
        events.emit(Events.VFS_CHANGED, { path, operation });
    }
}

// ─── Pure Helper Functions ──────────────────────────────────────

/**
 * Creates a new FileNode with sensible defaults.
 *
 * @param name - Node name (filename or directory name).
 * @param type - 'file' or 'folder'.
 * @param path - Absolute path for this node.
 * @returns A new FileNode instance.
 */
function node_create(name: string, type: 'file' | 'folder', path: string): FileNode {
    return {
        name,
        type,
        path,
        size: type === 'folder' ? '-' : '0 B',
        content: null,
        contentGenerator: null,
        permissions: 'rw',
        modified: new Date(),
        children: type === 'folder' ? [] : null,
        metadata: {}
    };
}

/**
 * Deep-clones a FileNode and all its descendants, assigning new paths.
 *
 * @param node - The source node to clone.
 * @param newPath - The absolute path for the cloned root.
 * @returns A deep copy of the node tree rooted at newPath.
 */
function node_cloneDeep(node: FileNode, newPath: string): FileNode {
    const clone: FileNode = {
        ...node,
        path: newPath,
        name: path_basename(newPath),
        modified: new Date(),
        metadata: { ...node.metadata },
        children: null
    };

    if (node.children) {
        clone.children = node.children.map((child: FileNode): FileNode => {
            const childPath: string = newPath + '/' + child.name;
            return node_cloneDeep(child, childPath);
        });
    }

    return clone;
}

/**
 * Recursively updates the path of a node and all its descendants.
 *
 * @param node - The node to repath.
 * @param newPath - The new absolute path for this node.
 */
function node_repath(node: FileNode, newPath: string): void {
    node.path = newPath;
    if (node.children) {
        for (const child of node.children) {
            node_repath(child, newPath + '/' + child.name);
        }
    }
}

/**
 * Returns the parent directory of an absolute path.
 *
 * @param absolutePath - An absolute path (e.g., '/home/developer/src').
 * @returns The parent path (e.g., '/home/developer').
 */
function path_parent(absolutePath: string): string {
    const segments: string[] = absolutePath.split('/').filter(Boolean);
    if (segments.length <= 1) return '/';
    return '/' + segments.slice(0, -1).join('/');
}

/**
 * Returns the final segment (basename) of an absolute path.
 *
 * @param absolutePath - An absolute path (e.g., '/home/developer/train.py').
 * @returns The basename (e.g., 'train.py').
 */
function path_basename(absolutePath: string): string {
    const segments: string[] = absolutePath.split('/').filter(Boolean);
    return segments[segments.length - 1] || '';
}

/**
 * Formats a byte count into a human-readable size string.
 *
 * @param bytes - Number of bytes.
 * @returns Formatted string (e.g., '4.2 KB').
 */
function size_format(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

