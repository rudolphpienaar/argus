/**
 * `mv` builtin implementation.
 *
 * Supported flags:
 * - `-f`, `--force`: overwrite destination if it exists.
 * - `-n`, `--no-clobber`: never overwrite destination.
 * - `-v`, `--verbose`: print move operation summary.
 * - `-h`, `--help`: print usage.
 */

import type { FileNode } from '../types.js';
import type { VirtualFileSystem } from '../VirtualFileSystem.js';
import type { BuiltinCommand } from './types.js';
import { argIsOption_check, errorMessage_get, pathBasename_get } from './_shared.js';

interface MvOptions {
    force: boolean;
    noClobber: boolean;
    verbose: boolean;
    src: string;
    dest: string;
}

type MvParseResult =
    | { ok: true; options: MvOptions }
    | { ok: false; stderr: string; exitCode: number };

export const command: BuiltinCommand = {
    name: 'mv',
    create: ({ vfs }) => async (args) => {
        const parsed: MvParseResult = mvArgs_parse(args);
        if (!parsed.ok) {
            return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
        }

        try {
            const srcResolved: string = vfs.path_resolve(parsed.options.src);
            const srcNode: FileNode | null = vfs.node_stat(srcResolved);
            if (!srcNode) {
                return {
                    stdout: '',
                    stderr: `mv: cannot stat '${parsed.options.src}': No such file or directory`,
                    exitCode: 1
                };
            }

            const finalDestPath: string = mvDestination_resolve(vfs, parsed.options.dest, srcNode);
            if (srcResolved === finalDestPath) {
                return { stdout: '', stderr: '', exitCode: 0 };
            }

            const existingDest: FileNode | null = vfs.node_stat(finalDestPath);
            if (existingDest) {
                if (parsed.options.noClobber) {
                    return { stdout: '', stderr: '', exitCode: 0 };
                }
                if (!parsed.options.force) {
                    return {
                        stdout: '',
                        stderr: `mv: cannot overwrite '${parsed.options.dest}' without -f (or use -n)`,
                        exitCode: 1
                    };
                }
                vfs.node_remove(finalDestPath, true);
            }

            vfs.node_move(parsed.options.src, finalDestPath);
            const stdout: string = parsed.options.verbose
                ? `'${parsed.options.src}' -> '${finalDestPath}'`
                : '';
            return { stdout, stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: `mv: ${errorMessage_get(error)}`, exitCode: 1 };
        }
    }
};

function mvArgs_parse(args: string[]): MvParseResult {
    let parseOptions = true;
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
                    stderr: 'usage: mv [-f|-n] [-v] [--] SOURCE DEST',
                    exitCode: 0
                };
            }
            if (arg.startsWith('--')) {
                return { ok: false, stderr: `mv: unrecognized option '${arg}'`, exitCode: 1 };
            }

            for (const flag of arg.slice(1)) {
                if (flag === 'f') {
                    force = true;
                } else if (flag === 'n') {
                    noClobber = true;
                } else if (flag === 'v') {
                    verbose = true;
                } else if (flag === 'h') {
                    return {
                        ok: false,
                        stderr: 'usage: mv [-f|-n] [-v] [--] SOURCE DEST',
                        exitCode: 0
                    };
                } else {
                    return { ok: false, stderr: `mv: invalid option -- '${flag}'`, exitCode: 1 };
                }
            }
            continue;
        }

        positionals.push(arg);
    }

    if (positionals.length < 2) {
        return { ok: false, stderr: 'mv: missing file operand', exitCode: 1 };
    }
    if (positionals.length > 2) {
        return { ok: false, stderr: 'mv: target handling supports SOURCE DEST only', exitCode: 1 };
    }

    return {
        ok: true,
        options: { force, noClobber, verbose, src: positionals[0], dest: positionals[1] }
    };
}

function mvDestination_resolve(
    vfs: VirtualFileSystem,
    destRaw: string,
    srcNode: FileNode
): string {
    const destResolved: string = vfs.path_resolve(destRaw);
    const destNode: FileNode | null = vfs.node_stat(destResolved);
    if (destNode && destNode.type === 'folder') {
        return `${destResolved}/${pathBasename_get(srcNode.path)}`;
    }
    return destResolved;
}
