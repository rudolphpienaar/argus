/**
 * `env` builtin implementation.
 *
 * Supported flags:
 * - `-0`: end each output line with NUL instead of newline.
 * - `-i`, `--ignore-environment`: start with an empty environment.
 * - `-u NAME`, `--unset=NAME`: remove a variable from the output scope.
 * - `-h`, `--help`: print usage.
 *
 * Command execution after environment construction is intentionally not
 * supported in this VFS shell; only environment projection is implemented.
 */

import type { BuiltinCommand } from './types.js';
import { argIsOption_check } from './_shared.js';

interface EnvOptions {
    nullDelim: boolean;
    ignoreEnvironment: boolean;
    unsetKeys: string[];
    assignments: Record<string, string>;
}

type EnvParseResult =
    | { ok: true; options: EnvOptions }
    | { ok: false; stderr: string; exitCode: number };

/**
 * Register the `env` builtin handler.
 */
export const command: BuiltinCommand = {
    name: 'env',
    create: () => async (args, shell) => {
        const parsed: EnvParseResult = envArgs_parse(args);
        if (!parsed.ok) {
            return {
                stdout: parsed.exitCode === 0 ? parsed.stderr : '',
                stderr: parsed.exitCode === 0 ? '' : parsed.stderr,
                exitCode: parsed.exitCode
            };
        }

        const envMap: Record<string, string> = parsed.options.ignoreEnvironment ? {} : shell.env_snapshot();
        for (const key of parsed.options.unsetKeys) {
            delete envMap[key];
        }
        for (const [key, value] of Object.entries(parsed.options.assignments)) {
            envMap[key] = value;
        }

        const entries: string[] = Object.entries(envMap)
            .sort(([a], [b]): number => a.localeCompare(b))
            .map(([key, value]: [string, string]): string => `${key}=${value}`);
        const delim: string = parsed.options.nullDelim ? '\0' : '\n';
        return { stdout: entries.join(delim), stderr: '', exitCode: 0 };
    }
};

/**
 * Parse `env` flags and variable assignment operands.
 *
 * @param args - Raw command arguments after `env`.
 * @returns Parsed environment projection options or usage/error metadata.
 */
function envArgs_parse(args: string[]): EnvParseResult {
    let parseOptions = true;
    const options: EnvOptions = {
        nullDelim: false,
        ignoreEnvironment: false,
        unsetKeys: [],
        assignments: {}
    };

    for (let i = 0; i < args.length; i++) {
        const arg: string = args[i];
        if (parseOptions && arg === '--') {
            parseOptions = false;
            continue;
        }

        if (argIsOption_check(arg, parseOptions)) {
            if (arg === '-0') {
                options.nullDelim = true;
                continue;
            }
            if (arg === '-i' || arg === '--ignore-environment') {
                options.ignoreEnvironment = true;
                continue;
            }
            if (arg === '-h' || arg === '--help') {
                return {
                    ok: false,
                    stderr: 'usage: env [-0i] [-u NAME] [NAME=VALUE ...]',
                    exitCode: 0
                };
            }
            if (arg.startsWith('--unset=')) {
                options.unsetKeys.push(arg.split('=', 2)[1]);
                continue;
            }
            if (arg === '-u' || arg === '--unset') {
                const key: string | undefined = args[i + 1];
                if (!key) {
                    return { ok: false, stderr: 'env: option requires an argument -- u', exitCode: 1 };
                }
                options.unsetKeys.push(key);
                i += 1;
                continue;
            }
            return { ok: false, stderr: `env: unrecognized option '${arg}'`, exitCode: 1 };
        }

        const equalIndex: number = arg.indexOf('=');
        if (equalIndex <= 0) {
            return {
                ok: false,
                stderr: `env: command execution is not supported in VFS shell: '${arg}'`,
                exitCode: 1
            };
        }
        const key: string = arg.slice(0, equalIndex);
        const value: string = arg.slice(equalIndex + 1);
        options.assignments[key] = value;
    }

    return { ok: true, options };
}
