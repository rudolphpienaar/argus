/**
 * @file Shell Unit Tests
 *
 * Covers command parsing, builtins (cd, ls, cat, mkdir, touch, rm, cp, mv,
 * echo, env, export, whoami, date, history, help), environment variables,
 * prompt generation, stage transitions, and external handler delegation.
 *
 * @module
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VirtualFileSystem } from './VirtualFileSystem.js';
import { Shell } from './Shell.js';
import type { ShellResult } from './types.js';

describe('Shell', () => {
    let vfs: VirtualFileSystem;
    let shell: Shell;

    beforeEach(() => {
        vfs = new VirtualFileSystem('fedml');
        shell = new Shell(vfs, 'fedml');
    });

    // ─── Environment Variables ──────────────────────────────────

    describe('environment variables', () => {
        it('should initialize default env vars', () => {
            expect(shell.env_get('HOME')).toBe('/home/fedml');
            expect(shell.env_get('USER')).toBe('fedml');
            expect(shell.env_get('PERSONA')).toBe('fedml');
            expect(shell.env_get('STAGE')).toBe('search');
            expect(shell.env_get('PATH')).toBe('/bin:/usr/bin:/home/fedml/bin');
            expect(shell.env_get('PS1')).toBe('$USER@argus:$PWD $ ');
        });

        it('should return synced $PWD from VFS', () => {
            vfs.dir_create('/home/fedml/src');
            vfs.cwd_set('/home/fedml/src');
            expect(shell.env_get('PWD')).toBe('/home/fedml/src');
        });

        it('should set and get custom vars', () => {
            shell.env_set('CUSTOM', 'value');
            expect(shell.env_get('CUSTOM')).toBe('value');
        });

        it('should return all vars via env_all()', () => {
            const all: Map<string, string> = shell.env_all();
            expect(all.get('HOME')).toBe('/home/fedml');
            expect(all.get('PWD')).toBe('/home/fedml');
        });
    });

    // ─── Prompt Generation ──────────────────────────────────────

    describe('prompt_render', () => {
        it('should render default prompt with ~ substitution', () => {
            const prompt: string = shell.prompt_render();
            expect(prompt).toBe('fedml@argus:~ $ ');
        });

        it('should render prompt with subdirectory', () => {
            vfs.dir_create('/home/fedml/src/project');
            vfs.cwd_set('/home/fedml/src/project');
            const prompt: string = shell.prompt_render();
            expect(prompt).toBe('fedml@argus:~/src/project $ ');
        });

        it('should render absolute path outside $HOME', () => {
            vfs.dir_create('/tmp');
            vfs.cwd_set('/tmp');
            const prompt: string = shell.prompt_render();
            expect(prompt).toBe('fedml@argus:/tmp $ ');
        });

        it('should reflect custom $PS1', () => {
            shell.env_set('PS1', '[$USER] $ ');
            const prompt: string = shell.prompt_render();
            expect(prompt).toBe('[fedml] $ ');
        });
    });

    // ─── Command Parsing ────────────────────────────────────────

    describe('command_execute', () => {
        it('should return empty result for blank input', async () => {
            const result: ShellResult = await shell.command_execute('');
            expect(result.exitCode).toBe(0);
            expect(result.stdout).toBe('');
        });

        it('should return error for unknown command', async () => {
            const result: ShellResult = await shell.command_execute('foobar');
            expect(result.exitCode).toBe(127);
            expect(result.stderr).toContain('command not found');
        });

        it('should record commands in history', async () => {
            await shell.command_execute('pwd');
            await shell.command_execute('ls');
            const history: string[] = shell.history_get();
            expect(history).toEqual(['pwd', 'ls']);
        });
    });

    // ─── Builtin: cd ────────────────────────────────────────────

    describe('cd', () => {
        it('should change to $HOME with no args', async () => {
            vfs.dir_create('/tmp');
            vfs.cwd_set('/tmp');
            const result: ShellResult = await shell.command_execute('cd');
            expect(result.exitCode).toBe(0);
            expect(vfs.cwd_get()).toBe('/home/fedml');
        });

        it('should change to specified path', async () => {
            vfs.dir_create('/home/fedml/src');
            const result: ShellResult = await shell.command_execute('cd ~/src');
            expect(result.exitCode).toBe(0);
            expect(vfs.cwd_get()).toBe('/home/fedml/src');
        });

        it('should update $PWD', async () => {
            vfs.dir_create('/home/fedml/src');
            await shell.command_execute('cd ~/src');
            expect(shell.env_get('PWD')).toBe('/home/fedml/src');
        });

        it('should return error for non-existent path', async () => {
            const result: ShellResult = await shell.command_execute('cd /nonexistent');
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain('No such file or directory');
        });

        it('should fire onCwdChange callback after cd', async () => {
            let captured: string | null = null;
            shell.onCwdChange_set((newCwd: string): void => { captured = newCwd; });
            vfs.dir_create('/home/fedml/src');
            await shell.command_execute('cd ~/src');
            expect(captured).toBe('/home/fedml/src');
        });

        it('should not fire onCwdChange on cd failure', async () => {
            let fired = false;
            shell.onCwdChange_set((): void => { fired = true; });
            await shell.command_execute('cd /nonexistent');
            expect(fired).toBe(false);
        });

        it('should clear onCwdChange with null', async () => {
            let count = 0;
            shell.onCwdChange_set((): void => { count++; });
            vfs.dir_create('/home/fedml/src');
            await shell.command_execute('cd ~/src');
            expect(count).toBe(1);
            shell.onCwdChange_set(null);
            await shell.command_execute('cd ~');
            expect(count).toBe(1);
        });
    });

    // ─── Builtin: pwd ───────────────────────────────────────────

    describe('pwd', () => {
        it('should print working directory', async () => {
            const result: ShellResult = await shell.command_execute('pwd');
            expect(result.stdout).toBe('/home/fedml');
        });
    });

    // ─── Builtin: ls ────────────────────────────────────────────

    describe('ls', () => {
        it('should list CWD contents', async () => {
            vfs.file_create('/home/fedml/test.txt');
            vfs.dir_create('/home/fedml/subdir');
            const result: ShellResult = await shell.command_execute('ls');
            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('test.txt');
            expect(result.stdout).toContain('subdir/');
        });

        it('should list specified directory', async () => {
            vfs.dir_create('/home/fedml/mydir');
            vfs.file_create('/home/fedml/mydir/inner.py');
            const result: ShellResult = await shell.command_execute('ls ~/mydir');
            expect(result.stdout).toContain('inner.py');
        });

        it('should return error for non-existent path', async () => {
            const result: ShellResult = await shell.command_execute('ls /nonexistent');
            expect(result.exitCode).toBe(1);
        });

        it('should list a file path without treating it as a directory', async () => {
            vfs.file_create('/home/fedml/node.py', 'print("ok")');
            const result: ShellResult = await shell.command_execute('ls ~/node.py');
            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('node.py');
            expect(result.stderr).toBe('');
        });
    });

    // ─── Builtin: cat ───────────────────────────────────────────

    describe('cat', () => {
        it('should print file content', async () => {
            vfs.file_create('/home/fedml/hello.txt', 'Hello World');
            const result: ShellResult = await shell.command_execute('cat hello.txt');
            expect(result.stdout).toBe('Hello World');
        });

        it('should return error for missing operand', async () => {
            const result: ShellResult = await shell.command_execute('cat');
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain('missing operand');
        });

        it('should return error for directory', async () => {
            const result: ShellResult = await shell.command_execute('cat .');
            expect(result.exitCode).toBe(1);
        });

        it('should return error for non-existent file', async () => {
            const result: ShellResult = await shell.command_execute('cat nope.txt');
            expect(result.exitCode).toBe(1);
        });
    });

    // ─── Builtin: mkdir ─────────────────────────────────────────

    describe('mkdir', () => {
        it('should create a directory', async () => {
            const result: ShellResult = await shell.command_execute('mkdir newdir');
            expect(result.exitCode).toBe(0);
            expect(vfs.node_stat('/home/fedml/newdir')).not.toBeNull();
        });

        it('should return error for missing operand', async () => {
            const result: ShellResult = await shell.command_execute('mkdir');
            expect(result.exitCode).toBe(1);
        });
    });

    // ─── Builtin: touch ─────────────────────────────────────────

    describe('touch', () => {
        it('should create an empty file', async () => {
            const result: ShellResult = await shell.command_execute('touch newfile.txt');
            expect(result.exitCode).toBe(0);
            expect(vfs.node_stat('/home/fedml/newfile.txt')).not.toBeNull();
        });

        it('should return error for missing operand', async () => {
            const result: ShellResult = await shell.command_execute('touch');
            expect(result.exitCode).toBe(1);
        });
    });

    // ─── Builtin: rm ────────────────────────────────────────────

    describe('rm', () => {
        it('should remove a file', async () => {
            vfs.file_create('/home/fedml/del.txt');
            const result: ShellResult = await shell.command_execute('rm del.txt');
            expect(result.exitCode).toBe(0);
            expect(vfs.node_stat('/home/fedml/del.txt')).toBeNull();
        });

        it('should fail on non-empty dir without -r', async () => {
            vfs.dir_create('/home/fedml/full');
            vfs.file_create('/home/fedml/full/inner.txt');
            const result: ShellResult = await shell.command_execute('rm full');
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain('not empty');
        });

        it('should remove non-empty dir with -r', async () => {
            vfs.dir_create('/home/fedml/full');
            vfs.file_create('/home/fedml/full/inner.txt');
            const result: ShellResult = await shell.command_execute('rm -r full');
            expect(result.exitCode).toBe(0);
            expect(vfs.node_stat('/home/fedml/full')).toBeNull();
        });
    });

    // ─── Builtin: cp ────────────────────────────────────────────

    describe('cp', () => {
        it('should copy a file', async () => {
            vfs.file_create('/home/fedml/src.txt', 'data');
            const result: ShellResult = await shell.command_execute('cp src.txt dst.txt');
            expect(result.exitCode).toBe(0);
            expect(vfs.node_read('/home/fedml/dst.txt')).toBe('data');
        });

        it('should return error for missing operand', async () => {
            const result: ShellResult = await shell.command_execute('cp src.txt');
            expect(result.exitCode).toBe(1);
        });
    });

    // ─── Builtin: mv ────────────────────────────────────────────

    describe('mv', () => {
        it('should move a file', async () => {
            vfs.file_create('/home/fedml/old.txt', 'data');
            const result: ShellResult = await shell.command_execute('mv old.txt new.txt');
            expect(result.exitCode).toBe(0);
            expect(vfs.node_stat('/home/fedml/old.txt')).toBeNull();
            expect(vfs.node_read('/home/fedml/new.txt')).toBe('data');
        });

        it('should return error for missing operand', async () => {
            const result: ShellResult = await shell.command_execute('mv old.txt');
            expect(result.exitCode).toBe(1);
        });
    });

    // ─── Builtin: echo ──────────────────────────────────────────

    describe('echo', () => {
        it('should print text', async () => {
            const result: ShellResult = await shell.command_execute('echo hello world');
            expect(result.stdout).toBe('hello world');
        });

        it('should expand $VARIABLE references', async () => {
            const result: ShellResult = await shell.command_execute('echo $USER@$HOME');
            expect(result.stdout).toBe('fedml@/home/fedml');
        });

        it('should leave unknown variables as-is', async () => {
            const result: ShellResult = await shell.command_execute('echo $UNDEFINED');
            expect(result.stdout).toBe('$UNDEFINED');
        });
    });

    // ─── Builtin: env ───────────────────────────────────────────

    describe('env', () => {
        it('should print all environment variables', async () => {
            const result: ShellResult = await shell.command_execute('env');
            expect(result.stdout).toContain('HOME=/home/fedml');
            expect(result.stdout).toContain('USER=fedml');
            expect(result.stdout).toContain('PWD=');
        });
    });

    // ─── Builtin: export ────────────────────────────────────────

    describe('export', () => {
        it('should set a variable', async () => {
            const result: ShellResult = await shell.command_execute('export FOO=bar');
            expect(result.exitCode).toBe(0);
            expect(shell.env_get('FOO')).toBe('bar');
        });

        it('should return error for invalid format', async () => {
            const result: ShellResult = await shell.command_execute('export invalid');
            expect(result.exitCode).toBe(1);
        });
    });

    // ─── Builtin: whoami ────────────────────────────────────────

    describe('whoami', () => {
        it('should print username', async () => {
            const result: ShellResult = await shell.command_execute('whoami');
            expect(result.stdout).toBe('fedml');
        });
    });

    // ─── Builtin: date ──────────────────────────────────────────

    describe('date', () => {
        it('should print a date string', async () => {
            const result: ShellResult = await shell.command_execute('date');
            expect(result.exitCode).toBe(0);
            expect(result.stdout.length).toBeGreaterThan(0);
        });
    });

    // ─── Builtin: history ───────────────────────────────────────

    describe('history', () => {
        it('should show command history', async () => {
            await shell.command_execute('pwd');
            await shell.command_execute('ls');
            const result: ShellResult = await shell.command_execute('history');
            expect(result.stdout).toContain('pwd');
            expect(result.stdout).toContain('ls');
            expect(result.stdout).toContain('history');
        });
    });

    // ─── Builtin: help ──────────────────────────────────────────

    describe('help', () => {
        it('should list all builtins', async () => {
            const result: ShellResult = await shell.command_execute('help');
            expect(result.stdout).toContain('cd');
            expect(result.stdout).toContain('ls');
            expect(result.stdout).toContain('cat');
            expect(result.stdout).toContain('rm');
            expect(result.stdout).toContain('cp');
            expect(result.stdout).toContain('mv');
        });
    });

    // ─── Stage Transitions ──────────────────────────────────────

    describe('stage_enter', () => {
        it('should update $STAGE', () => {
            shell.stage_enter('process');
            expect(shell.env_get('STAGE')).toBe('process');
        });

        it('should cd to ~/projects for process stage without $PROJECT', () => {
            shell.stage_enter('process');
            expect(vfs.cwd_get()).toBe('/home/fedml/projects');
        });

        it('should cd to $HOME for gather stage without $PROJECT', () => {
            shell.stage_enter('gather');
            expect(vfs.cwd_get()).toBe('/home/fedml');
        });

        it('should cd to project src for process stage with $PROJECT', () => {
            shell.env_set('PROJECT', 'study-01');
            vfs.dir_create('/home/fedml/projects/study-01/src');
            shell.stage_enter('process');
            expect(vfs.cwd_get()).toBe('/home/fedml/projects/study-01/src');
        });

        it('should cd to project input for gather stage with $PROJECT', () => {
            shell.env_set('PROJECT', 'study-01');
            vfs.dir_create('/home/fedml/projects/study-01/input');
            shell.stage_enter('gather');
            expect(vfs.cwd_get()).toBe('/home/fedml/projects/study-01/input');
        });

        it('should cd to project src for monitor stage with $PROJECT', () => {
            shell.env_set('PROJECT', 'study-01');
            vfs.dir_create('/home/fedml/projects/study-01/src');
            shell.stage_enter('monitor');
            expect(vfs.cwd_get()).toBe('/home/fedml/projects/study-01/src');
        });

        it('should cd to post landing directory', () => {
            shell.stage_enter('post');
            expect(vfs.cwd_get()).toBe('/home/fedml/results');
        });

        it('should cd to $HOME for search stage', () => {
            vfs.dir_create('/tmp');
            vfs.cwd_set('/tmp');
            shell.stage_enter('search');
            expect(vfs.cwd_get()).toBe('/home/fedml');
        });
    });

    // ─── Builtin: python ────────────────────────────────────────

    describe('python', () => {
        it('should execute a python script', async () => {
            vfs.file_create('/home/fedml/script.py', 'print("hello")');
            const result: ShellResult = await shell.command_execute('python script.py');
            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('[LOCAL EXECUTION: script.py]');
        });

        it('should materialize training artifacts at project root when run from src', async () => {
            vfs.dir_create('/home/fedml/projects/exp1/src');
            vfs.cwd_set('/home/fedml/projects/exp1/src');
            shell.env_set('PROJECT', 'exp1');
            vfs.file_create('/home/fedml/projects/exp1/src/train.py', 'print("train")');

            const result: ShellResult = await shell.command_execute('python train.py');

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('Found 1,240 images in ../input/');
            expect(vfs.node_stat('/home/fedml/projects/exp1/output/model.pth')).not.toBeNull();
            expect(vfs.node_stat('/home/fedml/projects/exp1/output/stats.json')).not.toBeNull();
            expect(vfs.node_stat('/home/fedml/projects/exp1/.local_pass')).not.toBeNull();
            expect(vfs.node_stat('/home/fedml/projects/exp1/src/.local_pass')).toBeNull();
        });

        it('should report input path as ./input when run from project root', async () => {
            vfs.dir_create('/home/fedml/projects/exp1');
            vfs.cwd_set('/home/fedml/projects/exp1');
            shell.env_set('PROJECT', 'exp1');
            vfs.file_create('/home/fedml/projects/exp1/train.py', 'print("train")');

            const result: ShellResult = await shell.command_execute('python train.py');

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('Found 1,240 images in ./input/');
        });

        it('should create .test_pass when running a ChRIS main.py validation', async () => {
            vfs.dir_create('/home/fedml/projects/chris-app/src');
            vfs.cwd_set('/home/fedml/projects/chris-app/src');
            shell.env_set('PROJECT', 'chris-app');
            vfs.file_create('/home/fedml/projects/chris-app/src/main.py', 'print("plugin")');

            const result: ShellResult = await shell.command_execute('python main.py --help');

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('LOCAL PLUGIN TEST COMPLETE');
            expect(vfs.node_stat('/home/fedml/projects/chris-app/.test_pass')).not.toBeNull();
            expect(vfs.node_stat('/home/fedml/projects/chris-app/.local_pass')).toBeNull();
        });

        it('should fail if script missing', async () => {
            const result: ShellResult = await shell.command_execute('python missing.py');
            expect(result.exitCode).toBe(2);
            expect(result.stderr).toContain('No such file');
        });
    });

    // ─── External Handler ───────────────────────────────────────

    describe('externalHandler', () => {
        it('should delegate to external handler for unknown commands', async () => {
            shell.externalHandler_set((cmd: string, _args: string[]): ShellResult | null => {
                if (cmd === 'federate') {
                    return { stdout: 'federating...', stderr: '', exitCode: 0 };
                }
                return null;
            });
            const result: ShellResult = await shell.command_execute('federate train.py');
            expect(result.stdout).toBe('federating...');
        });

        it('should return command-not-found if handler returns null', async () => {
            shell.externalHandler_set((_cmd: string, _args: string[]): ShellResult | null => null);
            const result: ShellResult = await shell.command_execute('unknown');
            expect(result.exitCode).toBe(127);
        });
    });
});
