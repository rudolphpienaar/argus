/**
 * `rm` builtin implementation.
 *
 * Supported flags:
 * - `-r`, `-R`, `--recursive`: remove directories and their contents.
 * - `-f`, `--force`: ignore missing operands and never prompt.
 * - `-d`, `--dir`: remove empty directories.
 * - `-v`, `--verbose`: print each removed path.
 * - `-h`, `--help`: print usage.
 */

import type { FileNode } from '../types.js';
import type { BuiltinCommand } from './types.js';
import { argIsOption_check, errorMessage_get } from './_shared.js';

interface RmOptions {
    recursive: boolean;
    force: boolean;
    removeEmptyDirs: boolean;
    verbose: boolean;
    targets: string[];
}

type RmParseResult =
    | { ok: true; options: RmOptions }
    | { ok: false; stderr: string; exitCode: number };

/**
 * Register the `rm` builtin handler.
 */
export const command: BuiltinCommand = {
    name: 'rm',
    create: ({ vfs }) => async (args) => {
        const parsed: RmParseResult = rmArgs_parse(args);
        if (!parsed.ok) {
            return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
        }

        try {
            const messages: string[] = [];
            for (const target of parsed.options.targets) {
                const resolved: string = vfs.path_resolve(target);
                const node: FileNode | null = vfs.node_stat(resolved);
                if (!node) {
                    if (parsed.options.force) {
                        continue;
                    }
                    return { stdout: '', stderr: `rm: cannot remove '${target}': No such file or directory`, exitCode: 1 };
                }

                if (node.type === 'folder' && !parsed.options.recursive) {
                    const isEmpty: boolean = (node.children?.length ?? 0) === 0;
                    if (!parsed.options.removeEmptyDirs) {
                        return {
                            stdout: '',
                            stderr: `rm: cannot remove '${target}': Is a directory`,
                            exitCode: 1
                        };
                    }
                    if (!isEmpty) {
                        return {
                            stdout: '',
                            stderr: `rm: cannot remove '${target}': Directory not empty`,
                            exitCode: 1
                        };
                    }
                }

                vfs.node_remove(target, parsed.options.recursive);
                if (parsed.options.verbose) {
                    messages.push(`removed '${target}'`);
                }
            }
            return { stdout: messages.join('\n'), stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: `rm: ${errorMessage_get(error)}`, exitCode: 1 };
        }
    }
};

/**
 * Parse `rm` flags and positional target operands.
 *
 * @param args - Raw command arguments after `rm`.
 * @returns Parsed remove options or usage/error metadata.
 */
function rmArgs_parse(args: string[]): RmParseResult {
    let parseOptions = true;
    let recursive = false;
    let force = false;
    let removeEmptyDirs = false;
    let verbose = false;
    const targets: string[] = [];

    for (const arg of args) {
        if (parseOptions && arg === '--') {
            parseOptions = false;
            continue;
        }

        if (argIsOption_check(arg, parseOptions)) {
            if (arg === '--recursive') {
                recursive = true;
                continue;
            }
            if (arg === '--force') {
                force = true;
                continue;
            }
            if (arg === '--dir') {
                removeEmptyDirs = true;
                continue;
            }
            if (arg === '--verbose') {
                verbose = true;
                continue;
            }
            if (arg === '-h' || arg === '--help') {
                return {
                    ok: false,
                    stderr: 'usage: rm [-f] [-rR] [-d] [-v] [--] FILE...',
                    exitCode: 0
                };
            }
            if (arg.startsWith('--')) {
                return { ok: false, stderr: `rm: unrecognized option '${arg}'`, exitCode: 1 };
            }

            for (const flag of arg.slice(1)) {
                if (flag === 'r' || flag === 'R') {
                    recursive = true;
                } else if (flag === 'f') {
                    force = true;
                } else if (flag === 'd') {
                    removeEmptyDirs = true;
                } else if (flag === 'v') {
                    verbose = true;
                } else if (flag === 'h') {
                    return {
                        ok: false,
                        stderr: 'usage: rm [-f] [-rR] [-d] [-v] [--] FILE...',
                        exitCode: 0
                    };
                } else {
                    return { ok: false, stderr: `rm: invalid option -- '${flag}'`, exitCode: 1 };
                }
            }
            continue;
        }

        targets.push(arg);
    }

    if (targets.length === 0) {
        return { ok: false, stderr: 'rm: missing operand', exitCode: 1 };
    }

    return {
        ok: true,
        options: { recursive, force, removeEmptyDirs, verbose, targets }
    };
}
