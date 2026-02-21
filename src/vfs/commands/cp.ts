/**
 * `cp` builtin implementation.
 *
 * Supported flags:
 * - `-r`, `-R`, `--recursive`: allow directory copy.
 * - `-a`, `--archive`: compatibility alias that implies recursive copy.
 * - `-f`, `--force`: overwrite destination if it exists.
 * - `-n`, `--no-clobber`: never overwrite destination.
 * - `-v`, `--verbose`: print copy operation summary.
 * - `-h`, `--help`: print usage.
 */

import type { FileNode } from '../types.js';
import type { VirtualFileSystem } from '../VirtualFileSystem.js';
import type { BuiltinCommand } from './types.js';
import { argIsOption_check, errorMessage_get, pathBasename_get } from './_shared.js';

interface CpOptions {
    recursive: boolean;
    force: boolean;
    noClobber: boolean;
    verbose: boolean;
    src: string;
    dest: string;
}

type CpParseResult =
    | { ok: true; options: CpOptions }
    | { ok: false; stderr: string; exitCode: number };

/**
 * Register the `cp` builtin handler.
 */
export const command: BuiltinCommand = {
    name: 'cp',
    create: ({ vfs }) => async (args) => {
        const parsed: CpParseResult = cpArgs_parse(args);
        if (!parsed.ok) {
            return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
        }

        try {
            const srcResolved: string = vfs.path_resolve(parsed.options.src);
            const srcNode: FileNode | null = vfs.node_stat(srcResolved);
            if (!srcNode) {
                return {
                    stdout: '',
                    stderr: `cp: cannot stat '${parsed.options.src}': No such file or directory`,
                    exitCode: 1
                };
            }

            if (srcNode.type === 'folder' && !parsed.options.recursive) {
                return {
                    stdout: '',
                    stderr: `cp: -r not specified; omitting directory '${parsed.options.src}'`,
                    exitCode: 1
                };
            }

            const finalDestPath: string = cpDestination_resolve(vfs, parsed.options.dest, srcNode);
            const existingDest: FileNode | null = vfs.node_stat(finalDestPath);
            if (existingDest) {
                if (parsed.options.noClobber) {
                    return { stdout: '', stderr: '', exitCode: 0 };
                }
                if (!parsed.options.force) {
                    return {
                        stdout: '',
                        stderr: `cp: cannot overwrite '${parsed.options.dest}' without -f (or use -n)`,
                        exitCode: 1
                    };
                }
                vfs.node_remove(finalDestPath, true);
            }

            vfs.node_copy(parsed.options.src, finalDestPath);
            const stdout: string = parsed.options.verbose
                ? `'${parsed.options.src}' -> '${finalDestPath}'`
                : '';
            return { stdout, stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: `cp: ${errorMessage_get(error)}`, exitCode: 1 };
        }
    }
};

/**
 * Parse `cp` flags and enforce SOURCE/DEST positional form.
 *
 * @param args - Raw command arguments after `cp`.
 * @returns Parsed copy options or usage/error metadata.
 */
function cpArgs_parse(args: string[]): CpParseResult {
    let parseOptions = true;
    let recursive = false;
    let force = false;
    let noClobber = false;
    let verbose = false;
    const positionals: string[] = [];

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
            if (arg === '--archive') {
                recursive = true;
                continue;
            }
            if (arg === '--force') {
                force = true;
                continue;
            }
            if (arg === '--no-clobber') {
                noClobber = true;
                continue;
            }
            if (arg === '--verbose') {
                verbose = true;
                continue;
            }
            if (arg === '-h' || arg === '--help') {
                return {
                    ok: false,
                    stderr: 'usage: cp [-aRr] [-f|-n] [-v] [--] SOURCE DEST',
                    exitCode: 0
                };
            }
            if (arg.startsWith('--')) {
                return { ok: false, stderr: `cp: unrecognized option '${arg}'`, exitCode: 1 };
            }

            for (const flag of arg.slice(1)) {
                if (flag === 'r' || flag === 'R' || flag === 'a') {
                    recursive = true;
                } else if (flag === 'f') {
                    force = true;
                } else if (flag === 'n') {
                    noClobber = true;
                } else if (flag === 'v') {
                    verbose = true;
                } else if (flag === 'h') {
                    return {
                        ok: false,
                        stderr: 'usage: cp [-aRr] [-f|-n] [-v] [--] SOURCE DEST',
                        exitCode: 0
                    };
                } else {
                    return { ok: false, stderr: `cp: invalid option -- '${flag}'`, exitCode: 1 };
                }
            }
            continue;
        }
        positionals.push(arg);
    }

    if (positionals.length < 2) {
        return { ok: false, stderr: 'cp: missing file operand', exitCode: 1 };
    }
    if (positionals.length > 2) {
        return { ok: false, stderr: 'cp: target handling supports SOURCE DEST only', exitCode: 1 };
    }

    return {
        ok: true,
        options: {
            recursive,
            force,
            noClobber,
            verbose,
            src: positionals[0],
            dest: positionals[1]
        }
    };
}

/**
 * Resolve copy destination path, appending source basename when target is a directory.
 *
 * @param vfs - Active virtual filesystem instance.
 * @param destRaw - Raw destination operand from CLI input.
 * @param srcNode - Resolved source node metadata.
 * @returns Absolute destination path where the source should be copied.
 */
function cpDestination_resolve(vfs: VirtualFileSystem, destRaw: string, srcNode: FileNode): string {
    const destResolved: string = vfs.path_resolve(destRaw);
    const destNode: FileNode | null = vfs.node_stat(destResolved);
    if (destNode && destNode.type === 'folder') {
        const baseName: string = pathBasename_get(srcNode.path);
        return `${destResolved}/${baseName}`;
    }
    return destResolved;
}
