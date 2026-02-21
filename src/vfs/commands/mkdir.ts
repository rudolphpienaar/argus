/**
 * `mkdir` builtin implementation.
 *
 * Supported flags:
 * - `-p`, `--parents`: create parent directories as needed and suppress existing-dir errors.
 * - `-v`, `--verbose`: print each created directory path.
 * - `-m <mode>`, `--mode <mode>`: accepted for Linux parity (mode not enforced in VFS).
 * - `-h`, `--help`: print usage.
 */

import type { FileNode } from '../types.js';
import type { BuiltinCommand } from './types.js';
import { argIsOption_check, errorMessage_get } from './_shared.js';

interface MkdirOptions {
    parents: boolean;
    verbose: boolean;
    paths: string[];
}

type MkdirParseResult =
    | { ok: true; options: MkdirOptions }
    | { ok: false; stderr: string; exitCode: number };

export const command: BuiltinCommand = {
    name: 'mkdir',
    create: ({ vfs }) => async (args) => {
        const parsed: MkdirParseResult = mkdirArgs_parse(args);
        if (!parsed.ok) {
            return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
        }

        try {
            const messages: string[] = [];
            for (const path of parsed.options.paths) {
                const resolved: string = vfs.path_resolve(path);
                const existing: FileNode | null = vfs.node_stat(resolved);
                if (existing) {
                    if (!parsed.options.parents) {
                        return { stdout: '', stderr: `mkdir: cannot create directory '${path}': File exists`, exitCode: 1 };
                    }
                    continue;
                }

                if (!parsed.options.parents) {
                    const parentPath: string = parentPath_get(resolved);
                    const parentNode: FileNode | null = vfs.node_stat(parentPath);
                    if (!parentNode || parentNode.type !== 'folder') {
                        return {
                            stdout: '',
                            stderr: `mkdir: cannot create directory '${path}': No such file or directory`,
                            exitCode: 1
                        };
                    }
                }

                vfs.dir_create(path);
                if (parsed.options.verbose) {
                    messages.push(`mkdir: created directory '${path}'`);
                }
            }
            return { stdout: messages.join('\n'), stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: `mkdir: ${errorMessage_get(error)}`, exitCode: 1 };
        }
    }
};

function mkdirArgs_parse(args: string[]): MkdirParseResult {
    let parseOptions = true;
    let parents = false;
    let verbose = false;
    const paths: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg: string = args[i];
        if (parseOptions && arg === '--') {
            parseOptions = false;
            continue;
        }

        if (argIsOption_check(arg, parseOptions)) {
            if (arg === '--parents') {
                parents = true;
                continue;
            }
            if (arg === '--verbose') {
                verbose = true;
                continue;
            }
            if (arg === '--mode') {
                if (i + 1 >= args.length) {
                    return { ok: false, stderr: 'mkdir: option requires an argument -- mode', exitCode: 1 };
                }
                i += 1;
                continue;
            }
            if (arg === '-h' || arg === '--help') {
                return { ok: false, stderr: 'usage: mkdir [-pv] [-m MODE] [--] DIRECTORY...', exitCode: 0 };
            }
            if (arg.startsWith('--')) {
                return { ok: false, stderr: `mkdir: unrecognized option '${arg}'`, exitCode: 1 };
            }

            const shortFlags: string = arg.slice(1);
            for (let j = 0; j < shortFlags.length; j++) {
                const flag: string = shortFlags[j];
                if (flag === 'p') {
                    parents = true;
                } else if (flag === 'v') {
                    verbose = true;
                } else if (flag === 'm') {
                    const inlineMode: string = shortFlags.slice(j + 1);
                    if (inlineMode.length > 0) {
                        j = shortFlags.length;
                        continue;
                    }
                    if (i + 1 >= args.length) {
                        return { ok: false, stderr: 'mkdir: option requires an argument -- m', exitCode: 1 };
                    }
                    i += 1;
                    break;
                } else if (flag === 'h') {
                    return { ok: false, stderr: 'usage: mkdir [-pv] [-m MODE] [--] DIRECTORY...', exitCode: 0 };
                } else {
                    return { ok: false, stderr: `mkdir: invalid option -- '${flag}'`, exitCode: 1 };
                }
            }
            continue;
        }

        paths.push(arg);
    }

    if (paths.length === 0) {
        return { ok: false, stderr: 'mkdir: missing operand', exitCode: 1 };
    }
    return { ok: true, options: { parents, verbose, paths } };
}

function parentPath_get(path: string): string {
    const trimmed: string = path.replace(/\/+$/, '');
    if (trimmed === '' || trimmed === '/') {
        return '/';
    }
    const index: number = trimmed.lastIndexOf('/');
    if (index <= 0) {
        return '/';
    }
    return trimmed.slice(0, index);
}
