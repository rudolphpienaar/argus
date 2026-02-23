import { describe, it, expect, beforeEach } from 'vitest';
import { VirtualFileSystem } from '../VirtualFileSystem.js';
import { Shell } from '../Shell.js';
import { registry_create } from './index.js';
import type { ShellResult } from '../types.js';

describe('VFS Commands: ln & ls link handling', () => {
    let vfs: VirtualFileSystem;
    let shell: Shell;

    async function setup() {
        vfs = new VirtualFileSystem('fedml');
        shell = new Shell(vfs, 'fedml');
        // Ensure home exists and is CWD
        vfs.cwd_set('/home/fedml');
        return { vfs, shell };
    }

    beforeEach(async () => {
        await setup();
    });

    describe('ln', () => {
        it('should create a symbolic link', async () => {
            vfs.file_create('/home/fedml/target.txt', 'hello');
            const result: ShellResult = await shell.command_execute('ln -s target.txt link.txt');
            expect(result.exitCode).toBe(0);
            
            const node = vfs.node_lstat('/home/fedml/link.txt');
            expect(node).toBeDefined();
            expect(node?.type).toBe('link');
            expect(node?.target).toBe('target.txt');
        });

        it('should fail without -s (hard links not supported)', async () => {
            vfs.file_create('/home/fedml/target.txt', 'hello');
            const result: ShellResult = await shell.command_execute('ln target.txt link.txt');
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain('hard links are not supported');
        });

        it('should fail if destination exists and no -f', async () => {
            vfs.file_create('/home/fedml/target.txt', 'hello');
            vfs.file_create('/home/fedml/link.txt', 'already here');
            const result: ShellResult = await shell.command_execute('ln -s target.txt link.txt');
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain('File exists');
        });

        it('should overwrite existing destination with -f', async () => {
            vfs.file_create('/home/fedml/target.txt', 'hello');
            vfs.file_create('/home/fedml/link.txt', 'already here');
            const result: ShellResult = await shell.command_execute('ln -sf target.txt link.txt');
            expect(result.exitCode).toBe(0);
            
            const node = vfs.node_lstat('/home/fedml/link.txt');
            expect(node?.type).toBe('link');
            expect(node?.target).toBe('target.txt');
        });
    });

    describe('ls link handling', () => {
        it('should list link with @ suffix and keyword class', async () => {
            vfs.file_create('/home/fedml/target.txt', 'hello');
            await shell.command_execute('ln -s target.txt mylink');
            
            const result: ShellResult = await shell.command_execute('ls');
            expect(result.stdout).toContain('class="keyword"');
            expect(result.stdout).toContain('mylink@');
        });

        it('should list link itself when target is a link (no trailing slash)', async () => {
            vfs.dir_create('/home/fedml/subdir');
            vfs.file_create('/home/fedml/subdir/file.txt', 'content');
            await shell.command_execute('ln -s subdir link_to_dir');
            
            // ls link_to_dir should show the link itself
            const result: ShellResult = await shell.command_execute('ls link_to_dir');
            expect(result.stdout).toContain('link_to_dir@');
            expect(result.stdout).not.toContain('file.txt');
        });

        it('should list contents of linked directory with trailing slash', async () => {
            vfs.dir_create('/home/fedml/subdir');
            vfs.file_create('/home/fedml/subdir/file.txt', 'content');
            await shell.command_execute('ln -s subdir link_to_dir');
            
            // ls link_to_dir/ should show contents of subdir
            const result: ShellResult = await shell.command_execute('ls link_to_dir/');
            expect(result.stdout).toContain('file.txt');
            expect(result.stdout).not.toContain('link_to_dir@');
        });

        it('should list link in long format with target arrow', async () => {
            vfs.file_create('/home/fedml/target.txt', 'hello');
            await shell.command_execute('ln -s target.txt mylink');
            
            const result: ShellResult = await shell.command_execute('ls -l mylink');
            expect(result.stdout).toContain('lrw-rw-r--');
            expect(result.stdout).toContain('mylink@ -> target.txt');
        });
    });
});
