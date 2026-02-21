/**
 * `date` builtin implementation.
 *
 * Supported flags:
 * - `-u`, `--utc`: print UTC time.
 * - `-R`, `--rfc-2822`: print RFC 2822 timestamp.
 * - `-I`, `--iso-8601[=date|seconds]`: print ISO date/time.
 * - `-h`, `--help`: print usage.
 */

import type { BuiltinCommand } from './types.js';
import { argIsOption_check } from './_shared.js';

interface DateOptions {
    utc: boolean;
    rfc2822: boolean;
    iso8601: 'date' | 'seconds' | null;
}

type DateParseResult =
    | { ok: true; options: DateOptions }
    | { ok: false; stderr: string; exitCode: number };

/**
 * Register the `date` builtin handler.
 */
export const command: BuiltinCommand = {
    name: 'date',
    create: () => async (args) => {
        const parsed: DateParseResult = dateArgs_parse(args);
        if (!parsed.ok) {
            return { stdout: parsed.exitCode === 0 ? parsed.stderr : '', stderr: parsed.exitCode === 0 ? '' : parsed.stderr, exitCode: parsed.exitCode };
        }

        const now: Date = new Date();
        if (parsed.options.iso8601) {
            const iso: string = now.toISOString();
            if (parsed.options.iso8601 === 'date') {
                return { stdout: iso.slice(0, 10), stderr: '', exitCode: 0 };
            }
            return { stdout: iso.slice(0, 19) + 'Z', stderr: '', exitCode: 0 };
        }
        if (parsed.options.rfc2822) {
            return { stdout: now.toUTCString(), stderr: '', exitCode: 0 };
        }
        if (parsed.options.utc) {
            return { stdout: now.toUTCString(), stderr: '', exitCode: 0 };
        }
        return { stdout: now.toString(), stderr: '', exitCode: 0 };
    }
};

/**
 * Parse `date` flags and normalize output mode selection.
 *
 * @param args - Raw command arguments after `date`.
 * @returns Parsed date-output options or usage/error metadata.
 */
function dateArgs_parse(args: string[]): DateParseResult {
    let parseOptions = true;
    const options: DateOptions = { utc: false, rfc2822: false, iso8601: null };

    for (const arg of args) {
        if (parseOptions && arg === '--') {
            parseOptions = false;
            continue;
        }

        if (!argIsOption_check(arg, parseOptions)) {
            return { ok: false, stderr: `date: extra operand '${arg}'`, exitCode: 1 };
        }

        if (arg.startsWith('-I=')) {
            const timespec: string = arg.slice(3);
            if (timespec === 'date') {
                options.iso8601 = 'date';
                continue;
            }
            if (timespec === 'seconds') {
                options.iso8601 = 'seconds';
                continue;
            }
            return { ok: false, stderr: `date: invalid argument '${timespec}' for -I`, exitCode: 1 };
        }

        if (arg === '--utc') {
            options.utc = true;
            continue;
        }
        if (arg === '--rfc-2822') {
            options.rfc2822 = true;
            continue;
        }
        if (arg === '--iso-8601') {
            options.iso8601 = 'date';
            continue;
        }
        if (arg.startsWith('--iso-8601=')) {
            const timespec: string = arg.split('=', 2)[1];
            if (timespec === 'date') {
                options.iso8601 = 'date';
                continue;
            }
            if (timespec === 'seconds') {
                options.iso8601 = 'seconds';
                continue;
            }
            return { ok: false, stderr: `date: invalid argument '${timespec}' for --iso-8601`, exitCode: 1 };
        }
        if (arg === '-h' || arg === '--help') {
            return { ok: false, stderr: 'usage: date [-uR] [-I[=date|seconds]]', exitCode: 0 };
        }
        if (arg.startsWith('--')) {
            return { ok: false, stderr: `date: unrecognized option '${arg}'`, exitCode: 1 };
        }

        for (const flag of arg.slice(1)) {
            if (flag === 'u') {
                options.utc = true;
            } else if (flag === 'R') {
                options.rfc2822 = true;
            } else if (flag === 'I') {
                options.iso8601 = 'date';
            } else if (flag === 'h') {
                return { ok: false, stderr: 'usage: date [-uR] [-I[=date|seconds]]', exitCode: 0 };
            } else {
                return { ok: false, stderr: `date: invalid option -- '${flag}'`, exitCode: 1 };
            }
        }
    }

    return { ok: true, options };
}
