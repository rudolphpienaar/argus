/**
 * `ln` builtin implementation.
 *
 * Supported flags:
 * - `-s`, `--symbolic`: create symbolic links instead of hard links (VFS only supports symbolic).
 * - `-f`, `--force`: remove existing destination files.
 * - `-v`, `--verbose`: print name of each linked file.
 * - `-h`, `--help`: print usage.
 */

import type { VirtualFileSystem } from '../VirtualFileSystem.js';
import type { BuiltinCommand } from './types.js';
import { argIsOption_check, errorMessage_get } from './_shared.js';

interface LnOptions {
    symbolic: boolean;
    force: boolean;
    verbose: boolean;
    target: string;
    linkName: string;
}

type LnParseResult =
    | { ok: true; options: LnOptions }
    | { ok: false; stderr: string; exitCode: number };

/**
 * Register the `ln` builtin handler.
 */
export const command: BuiltinCommand = {
    name: 'ln',
    create: ({ vfs }) => async (args) => {
        const parsed: LnParseResult = lnArgs_parse(args);
        if (!parsed.ok) {
            return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
        }

        const { symbolic, force, verbose, target, linkName } = parsed.options;

        if (!symbolic) {
            return { stdout: '', stderr: 'ln: hard links are not supported in VFS; use -s for symbolic links', exitCode: 1 };
        }

        try {
            const resolvedLinkName: string = vfs.path_resolve(linkName);
            const existing = vfs.node_lstat(resolvedLinkName);

            if (existing) {
                if (force) {
                    vfs.node_remove(resolvedLinkName);
                } else {
                    return { stdout: '', stderr: `ln: failed to create symbolic link '${linkName}': File exists`, exitCode: 1 };
                }
            }

            // Note: In VFS, link_create takes (path, target)
            // target in ln is the existing file, linkName is the new link.
            vfs.link_create(linkName, target);

            if (verbose) {
                return { stdout: `'${linkName}' -> '${target}'`, stderr: '', exitCode: 0 };
            }
            return { stdout: '', stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: `ln: ${errorMessage_get(error)}`, exitCode: 1 };
        }
    }
};

/**
 * Parse `ln` flags and operands.
 *
 * @param args - Raw command arguments after `ln`.
 * @returns Parsed ln options or usage/error metadata.
 */
function lnArgs_parse(args: string[]): LnParseResult {
    let parseOptions = true;
    let symbolic = false;
    let force = false;
    let verbose = false;
    const operands: string[] = [];

    for (const arg of args) {
        if (parseOptions && arg === '--') {
            parseOptions = false;
            continue;
        }

        if (argIsOption_check(arg, parseOptions)) {
            if (arg === '--symbolic') {
                symbolic = true;
                continue;
            }
            if (arg === '--force') {
                force = true;
                continue;
            }
            if (arg === '--verbose') {
                verbose = true;
                continue;
            }
            if (arg === '-h' || arg === '--help') {
                return {
                    ok: false,
                    stderr: 'usage: ln [-sfv] [--symbolic] [--force] [--verbose] TARGET LINK_NAME',
                    exitCode: 0
                };
            }
            if (arg.startsWith('--')) {
                return { ok: false, stderr: `ln: unrecognized option '${arg}'`, exitCode: 1 };
            }
            for (const flag of arg.slice(1)) {
                if (flag === 's') {
                    symbolic = true;
                } else if (flag === 'f') {
                    force = true;
                } else if (flag === 'v') {
                    verbose = true;
                } else if (flag === 'h') {
                    return {
                        ok: false,
                        stderr: 'usage: ln [-sfv] [--symbolic] [--force] [--verbose] TARGET LINK_NAME',
                        exitCode: 0
                    };
                } else {
                    return { ok: false, stderr: `ln: invalid option -- '${flag}'`, exitCode: 1 };
                }
            }
            continue;
        }

        operands.push(arg);
    }

    if (operands.length < 2) {
        return { ok: false, stderr: 'ln: missing file operand', exitCode: 1 };
    }
    if (operands.length > 2) {
        return { ok: false, stderr: `ln: extra operand '${operands[2]}'`, exitCode: 1 };
    }

    return {
        ok: true,
        options: {
            symbolic,
            force,
            verbose,
            target: operands[0],
            linkName: operands[1]
        }
    };
}
