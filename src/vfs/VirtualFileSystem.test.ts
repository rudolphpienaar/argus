/**
 * @file VirtualFileSystem Unit Tests
 *
 * Covers path resolution, CWD management, node CRUD operations,
 * mount/unmount, lazy content generation, and event emission.
 *
 * @module
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VirtualFileSystem } from './VirtualFileSystem.js';
import { events, Events } from '../core/state/events.js';
import type { FileNode } from './types.js';

/**
 * Helper: creates a minimal folder FileNode tree for mounting.
 *
 * @param name - Root folder name.
 * @param children - Optional child nodes.
 * @returns A FileNode folder.
 */
function folder_create(name: string, children: FileNode[] = []): FileNode {
    return {
        name,
        type: 'folder',
        path: '',
        size: '-',
        content: null,
        contentGenerator: null,
        permissions: 'rw',
        modified: new Date(),
        children,
        metadata: {}
    };
}

/**
 * Helper: creates a minimal file FileNode.
 *
 * @param name - File name.
 * @param content - Optional content string.
 * @returns A FileNode file.
 */
function file_createHelper(name: string, content: string | null = null): FileNode {
    return {
        name,
        type: 'file',
        path: '',
        size: content ? `${content.length} B` : '0 B',
        content,
        contentGenerator: null,
        permissions: 'rw',
        modified: new Date(),
        children: null,
        metadata: {}
    };
}

describe('VirtualFileSystem', () => {
    let vfs: VirtualFileSystem;

    beforeEach(() => {
        vfs = new VirtualFileSystem('developer');
    });

    // ─── Construction ───────────────────────────────────────────

    describe('constructor', () => {
        it('should bootstrap /home/<username> on creation', () => {
            const home: FileNode | null = vfs.node_stat('/home/developer');
            expect(home).not.toBeNull();
            expect(home!.type).toBe('folder');
        });

        it('should set CWD to $HOME', () => {
            const cwd: string = vfs.cwd_get();
            expect(cwd).toBe('/home/developer');
        });

        it('should set home path', () => {
            const home: string = vfs.home_get();
            expect(home).toBe('/home/developer');
        });

        it('should support custom username', () => {
            const customVfs: VirtualFileSystem = new VirtualFileSystem('annotator');
            expect(customVfs.home_get()).toBe('/home/annotator');
            expect(customVfs.cwd_get()).toBe('/home/annotator');
        });
    });

    // ─── Path Resolution ────────────────────────────────────────

    describe('path_resolve', () => {
        it('should return CWD for empty input', () => {
            const resolved: string = vfs.path_resolve('');
            expect(resolved).toBe('/home/developer');
        });

        it('should resolve absolute paths as-is', () => {
            const resolved: string = vfs.path_resolve('/etc/config');
            expect(resolved).toBe('/etc/config');
        });

        it('should expand ~ to $HOME', () => {
            const resolved: string = vfs.path_resolve('~');
            expect(resolved).toBe('/home/developer');
        });

        it('should expand ~/subpath', () => {
            const resolved: string = vfs.path_resolve('~/src/project');
            expect(resolved).toBe('/home/developer/src/project');
        });

        it('should resolve relative paths against CWD', () => {
            const resolved: string = vfs.path_resolve('src/project');
            expect(resolved).toBe('/home/developer/src/project');
        });

        it('should normalize . segments', () => {
            const resolved: string = vfs.path_resolve('/home/./developer/./src');
            expect(resolved).toBe('/home/developer/src');
        });

        it('should normalize .. segments', () => {
            const resolved: string = vfs.path_resolve('/home/developer/src/../data');
            expect(resolved).toBe('/home/developer/data');
        });

        it('should clamp .. at root', () => {
            const resolved: string = vfs.path_resolve('/home/../../..');
            expect(resolved).toBe('/');
        });
    });

    // ─── CWD ────────────────────────────────────────────────────

    describe('cwd_set / cwd_get', () => {
        it('should change CWD to an existing folder', () => {
            vfs.dir_create('/home/developer/src');
            vfs.cwd_set('/home/developer/src');
            expect(vfs.cwd_get()).toBe('/home/developer/src');
        });

        it('should support tilde in cwd_set', () => {
            vfs.dir_create('~/src');
            vfs.cwd_set('~/src');
            expect(vfs.cwd_get()).toBe('/home/developer/src');
        });

        it('should throw for non-existent path', () => {
            expect(() => vfs.cwd_set('/nonexistent')).toThrow('No such file or directory');
        });

        it('should throw for file path', () => {
            vfs.file_create('~/test.txt');
            expect(() => vfs.cwd_set('~/test.txt')).toThrow('Not a directory');
        });

        it('should emit CWD_CHANGED event', () => {
            vfs.dir_create('~/src');
            const handler = vi.fn();
            events.on(Events.CWD_CHANGED, handler);

            vfs.cwd_set('~/src');

            expect(handler).toHaveBeenCalledWith({
                oldPath: '/home/developer',
                newPath: '/home/developer/src'
            });

            events.off(Events.CWD_CHANGED, handler);
        });
    });

    // ─── dir_create ─────────────────────────────────────────────

    describe('dir_create', () => {
        it('should create a single directory', () => {
            vfs.dir_create('/tmp');
            const node: FileNode | null = vfs.node_stat('/tmp');
            expect(node).not.toBeNull();
            expect(node!.type).toBe('folder');
        });

        it('should create intermediate directories (mkdir -p)', () => {
            vfs.dir_create('/home/developer/src/project/lib');
            const lib: FileNode | null = vfs.node_stat('/home/developer/src/project/lib');
            expect(lib).not.toBeNull();
            expect(lib!.type).toBe('folder');

            const src: FileNode | null = vfs.node_stat('/home/developer/src');
            expect(src).not.toBeNull();
        });

        it('should be idempotent for existing directories', () => {
            vfs.dir_create('/tmp');
            vfs.dir_create('/tmp');
            const node: FileNode | null = vfs.node_stat('/tmp');
            expect(node).not.toBeNull();
        });

        it('should throw if path segment is a file', () => {
            vfs.file_create('/home/developer/block', 'data');
            expect(() => vfs.dir_create('/home/developer/block/sub')).toThrow('Not a directory');
        });
    });

    // ─── file_create ────────────────────────────────────────────

    describe('file_create', () => {
        it('should create an empty file', () => {
            vfs.file_create('~/readme.txt');
            const node: FileNode | null = vfs.node_stat('~/readme.txt');
            expect(node).not.toBeNull();
            expect(node!.type).toBe('file');
            expect(node!.content).toBeNull();
        });

        it('should create a file with content', () => {
            vfs.file_create('~/readme.txt', 'Hello World');
            const node: FileNode | null = vfs.node_stat('~/readme.txt');
            expect(node!.content).toBe('Hello World');
            expect(node!.size).toBe('11 B');
        });

        it('should create a file with a generator key', () => {
            vfs.file_create('~/train.py', undefined, 'template:train');
            const node: FileNode | null = vfs.node_stat('~/train.py');
            expect(node!.content).toBeNull();
            expect(node!.contentGenerator).toBe('template:train');
        });

        it('should update modified timestamp if file exists', () => {
            vfs.file_create('~/test.txt');
            const first: Date = vfs.node_stat('~/test.txt')!.modified;

            // Small delay to ensure timestamp changes
            vfs.file_create('~/test.txt');
            const second: Date = vfs.node_stat('~/test.txt')!.modified;

            expect(second.getTime()).toBeGreaterThanOrEqual(first.getTime());
        });

        it('should throw if parent does not exist', () => {
            expect(() => vfs.file_create('/nonexistent/dir/file.txt')).toThrow('Parent directory does not exist');
        });
    });

    // ─── node_read ──────────────────────────────────────────────

    describe('node_read', () => {
        it('should return file content', () => {
            vfs.file_create('~/data.txt', 'some data');
            const content: string | null = vfs.node_read('~/data.txt');
            expect(content).toBe('some data');
        });

        it('should return null for folders', () => {
            const content: string | null = vfs.node_read('~');
            expect(content).toBeNull();
        });

        it('should throw for non-existent path', () => {
            expect(() => vfs.node_read('~/nope.txt')).toThrow('No such file or directory');
        });

        it('should invoke content resolver for lazy generation', () => {
            const resolver = vi.fn((_key: string, _path: string): string | null => 'generated content');
            vfs.contentResolver_set(resolver);

            vfs.file_create('~/lazy.py', undefined, 'template:train');
            const content: string | null = vfs.node_read('~/lazy.py');

            expect(content).toBe('generated content');
            expect(resolver).toHaveBeenCalledWith('template:train', '/home/developer/lazy.py');
        });

        it('should cache generated content on subsequent reads', () => {
            const resolver = vi.fn((_key: string, _path: string): string | null => 'generated');
            vfs.contentResolver_set(resolver);

            vfs.file_create('~/lazy.py', undefined, 'template:train');
            vfs.node_read('~/lazy.py');
            vfs.node_read('~/lazy.py');

            expect(resolver).toHaveBeenCalledTimes(1);
        });

        it('should return null if resolver returns null', () => {
            const resolver = vi.fn((_key: string, _path: string): string | null => null);
            vfs.contentResolver_set(resolver);

            vfs.file_create('~/lazy.py', undefined, 'template:train');
            const content: string | null = vfs.node_read('~/lazy.py');
            expect(content).toBeNull();
        });
    });

    // ─── node_write ─────────────────────────────────────────────

    describe('node_write', () => {
        it('should write content to an existing file', () => {
            vfs.file_create('~/test.txt');
            vfs.node_write('~/test.txt', 'new content');
            expect(vfs.node_read('~/test.txt')).toBe('new content');
        });

        it('should create a new file if it does not exist', () => {
            vfs.node_write('~/auto.txt', 'auto created');
            expect(vfs.node_read('~/auto.txt')).toBe('auto created');
        });

        it('should clear contentGenerator on write', () => {
            vfs.file_create('~/gen.py', undefined, 'template:train');
            vfs.node_write('~/gen.py', 'manual content');
            const node: FileNode | null = vfs.node_stat('~/gen.py');
            expect(node!.contentGenerator).toBeNull();
            expect(node!.content).toBe('manual content');
        });

        it('should throw when writing to a directory', () => {
            expect(() => vfs.node_write('~', 'data')).toThrow('Is a directory');
        });

        it('should throw when parent does not exist', () => {
            expect(() => vfs.node_write('/no/parent/file.txt', 'data')).toThrow('Parent directory does not exist');
        });
    });

    // ─── node_remove ────────────────────────────────────────────

    describe('node_remove', () => {
        it('should remove a file', () => {
            vfs.file_create('~/tmp.txt');
            vfs.node_remove('~/tmp.txt');
            expect(vfs.node_stat('~/tmp.txt')).toBeNull();
        });

        it('should remove an empty folder', () => {
            vfs.dir_create('~/empty');
            vfs.node_remove('~/empty');
            expect(vfs.node_stat('~/empty')).toBeNull();
        });

        it('should throw for non-empty folder without recursive', () => {
            vfs.dir_create('~/full');
            vfs.file_create('~/full/file.txt');
            expect(() => vfs.node_remove('~/full')).toThrow('Directory not empty');
        });

        it('should remove non-empty folder with recursive', () => {
            vfs.dir_create('~/full');
            vfs.file_create('~/full/file.txt');
            vfs.node_remove('~/full', true);
            expect(vfs.node_stat('~/full')).toBeNull();
        });

        it('should throw for non-existent path', () => {
            expect(() => vfs.node_remove('~/nope')).toThrow('No such file or directory');
        });

        it('should throw when removing root', () => {
            expect(() => vfs.node_remove('/')).toThrow('cannot remove root');
        });
    });

    // ─── node_copy ──────────────────────────────────────────────

    describe('node_copy', () => {
        it('should deep-copy a file', () => {
            vfs.file_create('~/src.txt', 'original');
            vfs.node_copy('~/src.txt', '~/dst.txt');

            expect(vfs.node_read('~/dst.txt')).toBe('original');
            // Verify independence
            vfs.node_write('~/src.txt', 'modified');
            expect(vfs.node_read('~/dst.txt')).toBe('original');
        });

        it('should deep-copy a folder tree', () => {
            vfs.dir_create('~/project');
            vfs.file_create('~/project/main.py', 'code');
            vfs.node_copy('~/project', '~/backup');

            expect(vfs.node_stat('~/backup')).not.toBeNull();
            expect(vfs.node_read('~/backup/main.py')).toBe('code');
        });

        it('should throw for non-existent source', () => {
            expect(() => vfs.node_copy('~/nope', '~/dst')).toThrow('No such file or directory');
        });
    });

    // ─── node_move ──────────────────────────────────────────────

    describe('node_move', () => {
        it('should move a file', () => {
            vfs.file_create('~/old.txt', 'data');
            vfs.node_move('~/old.txt', '~/new.txt');

            expect(vfs.node_stat('~/old.txt')).toBeNull();
            expect(vfs.node_read('~/new.txt')).toBe('data');
        });

        it('should move a folder', () => {
            vfs.dir_create('~/olddir');
            vfs.file_create('~/olddir/f.txt', 'inner');
            vfs.node_move('~/olddir', '~/newdir');

            expect(vfs.node_stat('~/olddir')).toBeNull();
            expect(vfs.node_read('~/newdir/f.txt')).toBe('inner');
        });

        it('should throw for non-existent source', () => {
            expect(() => vfs.node_move('~/nope', '~/dst')).toThrow('No such file or directory');
        });
    });

    // ─── node_stat ──────────────────────────────────────────────

    describe('node_stat', () => {
        it('should return node without reading content', () => {
            vfs.file_create('~/test.txt', 'data');
            const node: FileNode | null = vfs.node_stat('~/test.txt');
            expect(node).not.toBeNull();
            expect(node!.name).toBe('test.txt');
        });

        it('should return null for non-existent path', () => {
            expect(vfs.node_stat('~/nope')).toBeNull();
        });
    });

    // ─── dir_list ───────────────────────────────────────────────

    describe('dir_list', () => {
        it('should list children of a directory', () => {
            vfs.file_create('~/a.txt');
            vfs.file_create('~/b.txt');
            vfs.dir_create('~/subdir');

            const children: FileNode[] = vfs.dir_list('~');
            const names: string[] = children.map(c => c.name);
            expect(names).toContain('a.txt');
            expect(names).toContain('b.txt');
            expect(names).toContain('subdir');
        });

        it('should throw for non-existent path', () => {
            expect(() => vfs.dir_list('/nonexistent')).toThrow('No such file or directory');
        });

        it('should throw for file path', () => {
            vfs.file_create('~/file.txt');
            expect(() => vfs.dir_list('~/file.txt')).toThrow('Not a directory');
        });
    });

    // ─── node_invalidate ────────────────────────────────────────

    describe('node_invalidate', () => {
        it('should clear cached content for regeneration', () => {
            let callCount: number = 0;
            const resolver = (_key: string, _path: string): string | null => {
                callCount++;
                return `generated-${callCount}`;
            };
            vfs.contentResolver_set(resolver);

            vfs.file_create('~/lazy.py', undefined, 'template:train');
            expect(vfs.node_read('~/lazy.py')).toBe('generated-1');

            vfs.node_invalidate('~/lazy.py');
            expect(vfs.node_read('~/lazy.py')).toBe('generated-2');
        });

        it('should not affect files without a generator', () => {
            vfs.file_create('~/static.txt', 'fixed');
            vfs.node_invalidate('~/static.txt');
            expect(vfs.node_read('~/static.txt')).toBe('fixed');
        });
    });

    // ─── tree_mount / tree_unmount ──────────────────────────────

    describe('tree_mount / tree_unmount', () => {
        it('should mount a subtree at a path', () => {
            const subtree: FileNode = folder_create('project', [
                file_createHelper('main.py', 'print("hello")')
            ]);

            vfs.tree_mount('/home/developer/projects/myproj', subtree);

            const mounted: FileNode | null = vfs.node_stat('/home/developer/projects/myproj');
            expect(mounted).not.toBeNull();
            expect(mounted!.type).toBe('folder');

            const mainPy: FileNode | null = vfs.node_stat('/home/developer/projects/myproj/main.py');
            expect(mainPy).not.toBeNull();
            expect(mainPy!.content).toBe('print("hello")');
        });

        it('should create parent directories if needed', () => {
            const subtree: FileNode = folder_create('data', []);
            vfs.tree_mount('/opt/atlas/data', subtree);

            expect(vfs.node_stat('/opt/atlas')).not.toBeNull();
            expect(vfs.node_stat('/opt/atlas/data')).not.toBeNull();
        });

        it('should replace existing node at mount path', () => {
            const first: FileNode = folder_create('proj', [file_createHelper('v1.txt', 'v1')]);
            const second: FileNode = folder_create('proj', [file_createHelper('v2.txt', 'v2')]);

            vfs.tree_mount('~/projects/proj', first);
            vfs.tree_mount('~/projects/proj', second);

            expect(vfs.node_stat('~/projects/proj/v1.txt')).toBeNull();
            expect(vfs.node_stat('~/projects/proj/v2.txt')).not.toBeNull();
        });

        it('should unmount a subtree', () => {
            const subtree: FileNode = folder_create('proj', []);
            vfs.tree_mount('~/projects/proj', subtree);
            vfs.tree_unmount('~/projects/proj');

            expect(vfs.node_stat('~/projects/proj')).toBeNull();
        });

        it('should repath mounted nodes to match mount point', () => {
            const subtree: FileNode = folder_create('orig', [
                file_createHelper('f.txt')
            ]);

            vfs.tree_mount('~/mounted', subtree);

            const node: FileNode | null = vfs.node_stat('~/mounted/f.txt');
            expect(node).not.toBeNull();
            expect(node!.path).toBe('/home/developer/mounted/f.txt');
        });
    });

    // ─── Event Emission ─────────────────────────────────────────

    describe('event emission', () => {
        it('should emit VFS_CHANGED on node_write', () => {
            const handler = vi.fn();
            events.on(Events.VFS_CHANGED, handler);

            vfs.file_create('~/test.txt');
            vfs.node_write('~/test.txt', 'data');

            const writeCalls = handler.mock.calls.filter(
                (c: any[]) => c[0].operation === 'write'
            );
            expect(writeCalls.length).toBe(1);

            events.off(Events.VFS_CHANGED, handler);
        });

        it('should emit VFS_CHANGED on node_remove', () => {
            const handler = vi.fn();
            vfs.file_create('~/rm.txt');
            events.on(Events.VFS_CHANGED, handler);

            vfs.node_remove('~/rm.txt');

            const removeCalls = handler.mock.calls.filter(
                (c: any[]) => c[0].operation === 'remove'
            );
            expect(removeCalls.length).toBe(1);

            events.off(Events.VFS_CHANGED, handler);
        });

        it('should emit VFS_CHANGED on tree_mount', () => {
            const handler = vi.fn();
            events.on(Events.VFS_CHANGED, handler);

            const subtree: FileNode = folder_create('mnt', []);
            vfs.tree_mount('~/mnt', subtree);

            const mountCalls = handler.mock.calls.filter(
                (c: any[]) => c[0].operation === 'mount'
            );
            expect(mountCalls.length).toBe(1);

            events.off(Events.VFS_CHANGED, handler);
        });
    });
});
