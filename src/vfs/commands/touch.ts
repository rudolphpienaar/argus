/**
 * `touch` builtin implementation.
 *
 * Supported flags:
 * - `-c`, `--no-create`: do not create files that do not exist.
 * - `-a`: compatibility flag (access-time update intent; metadata-only in VFS).
 * - `-m`: compatibility flag (modification-time update intent; metadata-only in VFS).
 * - `-h`, `--help`: print usage.
 */

import type { BuiltinCommand } from './types.js';
import { argIsOption_check, errorMessage_get } from './_shared.js';

interface TouchOptions {
    noCreate: boolean;
    targets: string[];
}

type TouchParseResult =
    | { ok: true; options: TouchOptions }
    | { ok: false; stderr: string; exitCode: number };

export const command: BuiltinCommand = {
    name: 'touch',
    create: ({ vfs }) => async (args) => {
        const parsed: TouchParseResult = touchArgs_parse(args);
        if (!parsed.ok) {
            return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
        }
        try {
            for (const target of parsed.options.targets) {
                const resolved: string = vfs.path_resolve(target);
                const existing = vfs.node_stat(resolved);
                if (!existing && parsed.options.noCreate) {
                    continue;
                }
                vfs.file_create(target);
            }
            return { stdout: '', stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: `touch: ${errorMessage_get(error)}`, exitCode: 1 };
        }
    }
};

function touchArgs_parse(args: string[]): TouchParseResult {
    let parseOptions = true;
    let noCreate = false;
    const targets: string[] = [];

    for (const arg of args) {
        if (parseOptions && arg === '--') {
            parseOptions = false;
            continue;
        }

        if (argIsOption_check(arg, parseOptions)) {
            if (arg === '--no-create') {
                noCreate = true;
                continue;
            }
            if (arg === '-h' || arg === '--help') {
                return {
                    ok: false,
                    stderr: 'usage: touch [-acm] [--no-create] [--] FILE...',
                    exitCode: 0
                };
            }
            if (arg.startsWith('--')) {
                return { ok: false, stderr: `touch: unrecognized option '${arg}'`, exitCode: 1 };
            }
            for (const flag of arg.slice(1)) {
                if (flag === 'c') {
                    noCreate = true;
                } else if (flag === 'a' || flag === 'm') {
                    // Supported for Linux parity; VFS timestamps are modeled as one modified field.
                    continue;
                } else if (flag === 'h') {
                    return {
                        ok: false,
                        stderr: 'usage: touch [-acm] [--no-create] [--] FILE...',
                        exitCode: 0
                    };
                } else {
                    return { ok: false, stderr: `touch: invalid option -- '${flag}'`, exitCode: 1 };
                }
            }
            continue;
        }

        targets.push(arg);
    }

    if (targets.length === 0) {
        return { ok: false, stderr: 'touch: missing file operand', exitCode: 1 };
    }
    return { ok: true, options: { noCreate, targets } };
}
