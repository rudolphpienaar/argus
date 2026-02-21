/**
 * `cd` builtin implementation.
 *
 * Supported flags:
 * - `-L`: logical path resolution (default, accepted for compatibility).
 * - `-P`: physical path resolution (accepted for compatibility).
 * - `-h`, `--help`: print usage.
 *
 * Also supports `cd -` to jump to `$OLDPWD` and print the destination.
 */

import type { BuiltinCommand } from './types.js';
import { argIsOption_check } from './_shared.js';

interface CdOptions {
    target?: string;
    printTarget: boolean;
}

type CdParseResult =
    | { ok: true; options: CdOptions }
    | { ok: false; stderr: string; exitCode: number };

/**
 * Register the `cd` builtin handler.
 */
export const command: BuiltinCommand = {
    name: 'cd',
    create: ({ vfs }) => async (args, shell) => {
        const parsed: CdParseResult = cdArgs_parse(args, shell.env_get('OLDPWD'));
        if (!parsed.ok) {
            return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
        }

        const target: string = parsed.options.target || shell.env_get('HOME') || '/';
        const previousCwd: string = vfs.cwd_get();
        try {
            vfs.cwd_set(target);
            const newCwd: string = vfs.cwd_get();
            shell.env_set('OLDPWD', previousCwd);
            shell.env_set('PWD', newCwd);
            shell.cwd_didChange(newCwd);
            return { stdout: parsed.options.printTarget ? newCwd : '', stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return {
                stdout: '',
                stderr: `cd: ${error instanceof Error ? error.message : String(error)}`,
                exitCode: 1
            };
        }
    }
};

/**
 * Parse `cd` flags/arguments and resolve `cd -` semantics.
 *
 * @param args - Raw command arguments after `cd`.
 * @param oldPwd - Current shell `OLDPWD` value, if defined.
 * @returns Parsed target semantics or usage/error metadata.
 */
function cdArgs_parse(args: string[], oldPwd: string | undefined): CdParseResult {
    let parseOptions = true;
    const positionals: string[] = [];

    for (const arg of args) {
        if (parseOptions && arg === '-') {
            positionals.push(arg);
            continue;
        }

        if (parseOptions && arg === '--') {
            parseOptions = false;
            continue;
        }

        if (argIsOption_check(arg, parseOptions)) {
            if (arg === '-L' || arg === '-P') {
                continue;
            }
            if (arg === '-h' || arg === '--help') {
                return { ok: false, stderr: 'usage: cd [-L|-P] [dir]', exitCode: 0 };
            }
            if (arg.startsWith('--')) {
                return { ok: false, stderr: `cd: unrecognized option '${arg}'`, exitCode: 1 };
            }
            for (const flag of arg.slice(1)) {
                if (flag === 'L' || flag === 'P') {
                    continue;
                }
                if (flag === 'h') {
                    return { ok: false, stderr: 'usage: cd [-L|-P] [dir]', exitCode: 0 };
                }
                return { ok: false, stderr: `cd: invalid option -- '${flag}'`, exitCode: 1 };
            }
            continue;
        }

        positionals.push(arg);
    }

    if (positionals.length > 1) {
        return { ok: false, stderr: 'cd: too many arguments', exitCode: 1 };
    }

    if (positionals[0] === '-') {
        if (!oldPwd) {
            return { ok: false, stderr: 'cd: OLDPWD not set', exitCode: 1 };
        }
        return { ok: true, options: { target: oldPwd, printTarget: true } };
    }

    return { ok: true, options: { target: positionals[0], printTarget: false } };
}
