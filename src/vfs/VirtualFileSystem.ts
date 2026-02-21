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
 */
type ContentResolver = (generatorKey: string, filePath: string) => string | null;
type FolderNode = FileNode & { type: 'folder'; children: FileNode[] };

/**
 * In-memory POSIX-like virtual filesystem.
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

    public reset(): void {
        const username: string = this.username_get();
        this.root = node_create('', 'folder', '/');
        this.homePath = `/home/${username}`;
        this.cwd = this.homePath;
        this.dir_create(this.homePath);
    }

    public username_get(): string {
        const segments: string[] = this.homePath.split('/').filter(Boolean);
        return segments[segments.length - 1] || 'user';
    }

    public home_get(): string {
        return this.homePath;
    }

    public node_invalidate(path: string): void {
        const resolved: string = this.path_resolve(path);
        const node: FileNode | null = this.node_at(resolved);
        if (node && node.type === 'file' && node.contentGenerator) {
            node.content = null;
        }
    }

    public contentResolver_set(resolver: ContentResolver): void {
        this.contentResolver = resolver;
    }

    public path_resolve(input: string): string {
        if (!input) return this.cwd;
        let segments: string[];

        if (input === '~' || input.startsWith('~/')) {
            const rest: string = input === '~' ? '' : input.substring(2);
            segments = this.homePath.split('/').filter(Boolean);
            if (rest) segments.push(...rest.split('/').filter(Boolean));
        } else if (input.startsWith('/')) {
            segments = input.split('/').filter(Boolean);
        } else {
            segments = this.cwd.split('/').filter(Boolean);
            segments.push(...input.split('/').filter(Boolean));
        }

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

    public cwd_get(): string { return this.cwd; }

    public cwd_set(path: string): void {
        const resolved: string = this.path_resolve(path);
        const node: FileNode | null = this.node_at(resolved);
        if (!node) throw new Error(`cd: ${path}: No such file or directory`);
        if (node.type !== 'folder') throw new Error(`cd: ${path}: Not a directory`);
        const oldPath: string = this.cwd;
        this.cwd = resolved;
        events.emit(Events.CWD_CHANGED, { oldPath, newPath: resolved });
    }

    public node_read(path: string): string | null {
        const resolved: string = this.path_resolve(path);
        const node: FileNode | null = this.node_at(resolved);
        if (!node) throw new Error(`cat: ${path}: No such file or directory`);
        if (node.type === 'folder') return null;

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

    public node_write(path: string, content: string): void {
        const resolved: string = this.path_resolve(path);
        const parentPath: string = path_parent(resolved);
        const parent: FolderNode = this.node_folderRequire(parentPath, 'Parent directory does not exist');

        let node: FileNode | null = this.node_at(resolved);
        if (node && node.type === 'folder') throw new Error(`write: ${path}: Is a directory`);

        if (!node) {
            node = node_create(path_basename(resolved), 'file', resolved);
            parent.children.push(node);
        }

        node.content = content;
        node.contentGenerator = null;
        node.size = size_format(content.length);
        node.modified = new Date();
        this.event_emit(resolved, 'write');
    }

    public node_remove(path: string, recursive: boolean = false): void {
        const resolved: string = this.path_resolve(path);
        if (resolved === '/') throw new Error('rm: cannot remove root');
        const node: FileNode | null = this.node_at(resolved);
        if (!node) throw new Error(`rm: ${path}: No such file or directory`);
        if (node.type === 'folder' && node.children && node.children.length > 0 && !recursive) {
            throw new Error(`rm: ${path}: Directory not empty`);
        }
        const parent: FolderNode = this.node_folderRequire(path_parent(resolved), `rm: ${path}: Parent directory not found`);
        parent.children = parent.children.filter((c: FileNode): boolean => c.path !== resolved);
        this.event_emit(resolved, 'remove');
    }

    public node_copy(src: string, dest: string): void {
        const srcResolved: string = this.path_resolve(src);
        const destResolved: string = this.path_resolve(dest);
        const srcNode: FileNode | null = this.node_at(srcResolved);
        if (!srcNode) throw new Error(`cp: ${src}: No such file or directory`);
        this.dir_create(path_parent(destResolved));
        const parent: FolderNode = this.node_folderRequire(path_parent(destResolved), `cp: ${dest}: Parent directory not found`);
        parent.children.push(node_cloneDeep(srcNode, destResolved));
        this.event_emit(destResolved, 'copy');
    }

    public node_move(src: string, dest: string): void {
        const srcResolved: string = this.path_resolve(src);
        const destResolved: string = this.path_resolve(dest);
        const srcNode: FileNode | null = this.node_at(srcResolved);
        if (!srcNode) throw new Error(`mv: ${src}: No such file or directory`);
        
        const oldParent: FolderNode = this.node_folderRequire(path_parent(srcResolved), `mv: ${src}: Parent directory not found`);
        oldParent.children = oldParent.children.filter((c: FileNode): boolean => c.path !== srcResolved);

        this.dir_create(path_parent(destResolved));
        const newParent: FolderNode = this.node_folderRequire(path_parent(destResolved), `mv: ${dest}: Parent directory not found`);
        srcNode.name = path_basename(destResolved);
        node_repath(srcNode, destResolved);
        newParent.children.push(srcNode);
        this.event_emit(destResolved, 'move');
    }

    public node_stat(path: string): FileNode | null {
        return this.node_at(this.path_resolve(path));
    }

    public dir_list(path: string): FileNode[] {
        const node: FileNode | null = this.node_stat(path);
        if (!node) throw new Error(`ls: ${path}: No such file or directory`);
        if (node.type !== 'folder' || !node.children) throw new Error(`ls: ${path}: Not a directory`);
        return node.children;
    }

    /** Recursive directory creation (mkdir -p) */
    public dir_create(path: string): void {
        const resolved: string = this.path_resolve(path);
        const segments: string[] = resolved.split('/').filter(Boolean);
        let current: FileNode = this.root;

        let currentPath: string = '';
        for (const seg of segments) {
            currentPath += '/' + seg;
            if (!current.children) current.children = [];
            let child: FileNode | undefined = current.children.find((c: FileNode): boolean => c.name === seg);
            if (!child) {
                child = node_create(seg, 'folder', currentPath);
                current.children.push(child);
            } else if (child.type !== 'folder') {
                throw new Error(`mkdir: ${currentPath}: Not a directory`);
            }
            current = child;
        }
        this.event_emit(resolved, 'mkdir');
    }

    /** Recursive file creation (touch -p) */
    public file_create(path: string, content?: string, generatorKey?: string): void {
        const resolved: string = this.path_resolve(path);
        this.dir_create(path_parent(resolved));
        
        const existing: FileNode | null = this.node_at(resolved);
        if (existing) {
            existing.modified = new Date();
            if (content !== undefined) {
                existing.content = content;
                existing.size = size_format(content.length);
            }
            return;
        }

        const parent: FolderNode = this.node_folderRequire(path_parent(resolved), `touch: ${path}: Parent directory not found`);
        const node: FileNode = node_create(path_basename(resolved), 'file', resolved);
        if (content !== undefined) {
            node.content = content;
            node.size = size_format(content.length);
        }
        if (generatorKey) node.contentGenerator = generatorKey;
        parent.children.push(node);
        this.event_emit(resolved, 'touch');
    }

    public tree_mount(path: string, subtree: FileNode): void {
        const resolved: string = this.path_resolve(path);
        this.dir_create(path_parent(resolved));
        const parent: FolderNode = this.node_folderRequire(path_parent(resolved), `mount: ${path}: Parent directory not found`);
        parent.children = parent.children.filter((c: FileNode): boolean => c.name !== subtree.name);
        node_repath(subtree, resolved);
        subtree.name = path_basename(resolved);
        parent.children.push(subtree);
        this.event_emit(resolved, 'mount');
    }

    public tree_clone(srcPath: string, destPath: string): void {
        const srcResolved: string = this.path_resolve(srcPath);
        const destResolved: string = this.path_resolve(destPath);
        const srcNode: FileNode | null = this.node_at(srcResolved);
        if (!srcNode) throw new Error(`tree_clone: ${srcPath}: No such file or directory`);

        if (srcNode.type === 'folder' && srcNode.children) {
            this.dir_create(destResolved);
            for (const child of srcNode.children) {
                const childDestPath = `${destResolved}/${child.name}`;
                const childClone = node_cloneDeep(child, childDestPath);
                this.tree_mount(childDestPath, childClone);
            }
        } else {
            const clone = node_cloneDeep(srcNode, destResolved);
            this.tree_mount(destResolved, clone);
        }
    }

    public tree_unmount(path: string): void {
        const resolved: string = this.path_resolve(path);
        const parent: FileNode | null = this.node_at(path_parent(resolved));
        const name: string = path_basename(resolved);
        if (parent?.children) parent.children = parent.children.filter((c: FileNode): boolean => c.name !== name);
        this.event_emit(resolved, 'unmount');
    }

    public link_create(path: string, target: string): void {
        const resolved: string = this.path_resolve(path);
        const parentPath: string = path_parent(resolved);
        this.dir_create(parentPath);
        const parent: FolderNode = this.node_folderRequire(parentPath, `ln: ${path}: Parent directory not found`);

        parent.children = parent.children.filter((c: FileNode): boolean => c.path !== resolved);
        
        const node: FileNode = node_create(path_basename(resolved), 'link', resolved);
        node.target = target;
        parent.children.push(node);
        this.event_emit(resolved, 'link');
    }

    private node_at(absolutePath: string, followLinks: boolean = true, depth: number = 0): FileNode | null {
        if (depth > 10) throw new Error('Too many symbolic links');
        if (absolutePath === '/') return this.root;
        
        const segments: string[] = absolutePath.split('/').filter(Boolean);
        let current: FileNode = this.root;

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (!current.children) return null;

            let child: FileNode | undefined = current.children.find((c: FileNode): boolean => c.name === seg);
            if (!child) return null;

            if (child.type === 'link' && (followLinks || i < segments.length - 1)) {
                const target = child.target!;
                const remaining = segments.slice(i + 1).join('/');
                const nextPath = remaining ? `${target}/${remaining}` : target;
                return this.node_at(this.path_resolve(nextPath), followLinks, depth + 1);
            }

            current = child;
        }
        return current;
    }

    /**
     * Resolve a node by absolute path, throwing if missing.
     *
     * @param absolutePath - Fully resolved path.
     * @param errorMessage - Error to throw if path is missing.
     * @returns Existing VFS node.
     */
    private node_require(absolutePath: string, errorMessage: string): FileNode {
        const node: FileNode | null = this.node_at(absolutePath);
        if (!node) {
            throw new Error(errorMessage);
        }
        return node;
    }

    /**
     * Resolve a folder node by absolute path and ensure children array exists.
     *
     * @param absolutePath - Fully resolved folder path.
     * @param errorMessage - Error to throw if path is missing or non-folder.
     * @returns Existing folder node.
     */
    private node_folderRequire(absolutePath: string, errorMessage: string): FolderNode {
        const node: FileNode = this.node_require(absolutePath, errorMessage);
        if (node.type !== 'folder') {
            throw new Error(errorMessage);
        }
        if (!node.children) {
            node.children = [];
        }
        return node as FolderNode;
    }

    private event_emit(path: string, operation: VfsChangeEvent['operation']): void {
        events.emit(Events.VFS_CHANGED, { path, operation });
    }
}

function node_create(name: string, type: 'file' | 'folder' | 'link', path: string): FileNode {
    return { 
        name, 
        type, 
        path, 
        size: type === 'file' ? '0 B' : '-', 
        content: null, 
        contentGenerator: null, 
        permissions: 'rw', 
        modified: new Date(), 
        children: type === 'folder' ? [] : null, 
        metadata: {},
        target: undefined
    };
}

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
        clone.children = node.children.map((child: FileNode): FileNode => 
            node_cloneDeep(child, newPath + '/' + child.name)
        );
    }
    return clone;
}

function node_repath(node: FileNode, newPath: string): void {
    node.path = newPath;
    if (node.children) {
        for (const child of node.children) node_repath(child, newPath + '/' + child.name);
    }
}

function path_parent(absolutePath: string): string {
    const segments: string[] = absolutePath.split('/').filter(Boolean);
    if (segments.length <= 1) return '/';
    return '/' + segments.slice(0, -1).join('/');
}

function path_basename(absolutePath: string): string {
    const segments: string[] = absolutePath.split('/').filter(Boolean);
    return segments[segments.length - 1] || '';
}

function size_format(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
