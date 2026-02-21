/**
 * `export` builtin implementation.
 *
 * Supported flags:
 * - `-p`: print exported variables.
 * - `-n NAME...`: unset variables from the shell environment.
 * - `-h`, `--help`: print usage.
 *
 * Assignment syntax:
 * - `export KEY=VALUE [KEY2=VALUE2 ...]`
 */

import type { BuiltinCommand } from './types.js';
import { argIsOption_check } from './_shared.js';

interface ExportOptions {
    print: boolean;
    unsetKeys: string[];
    assignments: Array<{ key: string; value: string }>;
}

type ExportParseResult =
    | { ok: true; options: ExportOptions }
    | { ok: false; stderr: string; exitCode: number };

export const command: BuiltinCommand = {
    name: 'export',
    create: () => async (args, shell) => {
        const parsed: ExportParseResult = exportArgs_parse(args);
        if (!parsed.ok) {
            return {
                stdout: parsed.exitCode === 0 ? parsed.stderr : '',
                stderr: parsed.exitCode === 0 ? '' : parsed.stderr,
                exitCode: parsed.exitCode
            };
        }

        for (const key of parsed.options.unsetKeys) {
            shell.env_unset(key);
        }

        for (const assignment of parsed.options.assignments) {
            shell.env_set(assignment.key, assignment.value);
        }

        if (parsed.options.print || (args.length === 0 && parsed.options.assignments.length === 0 && parsed.options.unsetKeys.length === 0)) {
            const env: Record<string, string> = shell.env_snapshot();
            const lines: string[] = Object.entries(env)
                .sort(([a], [b]): number => a.localeCompare(b))
                .map(([key, value]: [string, string]): string => `declare -x ${key}="${value.replaceAll('"', '\\"')}"`);
            return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
        }

        return { stdout: '', stderr: '', exitCode: 0 };
    }
};

function exportArgs_parse(args: string[]): ExportParseResult {
    const options: ExportOptions = { print: false, unsetKeys: [], assignments: [] };
    let parseOptions = true;

    for (let i = 0; i < args.length; i++) {
        const arg: string = args[i];
        if (parseOptions && arg === '--') {
            parseOptions = false;
            continue;
        }

        if (argIsOption_check(arg, parseOptions)) {
            if (arg === '-p') {
                options.print = true;
                continue;
            }
            if (arg === '-h' || arg === '--help') {
                return { ok: false, stderr: 'usage: export [-p] [-n NAME ...] [NAME=VALUE ...]', exitCode: 0 };
            }
            if (arg === '-n') {
                const next: string | undefined = args[i + 1];
                if (!next) {
                    return { ok: false, stderr: 'export: option requires an argument -- n', exitCode: 1 };
                }
                options.unsetKeys.push(next);
                i += 1;
                continue;
            }
            return { ok: false, stderr: `export: invalid option '${arg}'`, exitCode: 1 };
        }

        const equalIndex: number = arg.indexOf('=');
        if (equalIndex <= 0) {
            return { ok: false, stderr: 'export: invalid format. Use: export KEY=VALUE', exitCode: 1 };
        }
        options.assignments.push({
            key: arg.slice(0, equalIndex),
            value: arg.slice(equalIndex + 1)
        });
    }

    return { ok: true, options };
}
