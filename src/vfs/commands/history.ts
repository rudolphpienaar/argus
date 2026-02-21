/**
 * `history` builtin implementation.
 *
 * Supported flags:
 * - `-c`: clear history list.
 * - `-n COUNT`: show only the last COUNT entries.
 * - `-h`, `--help`: print usage.
 *
 * A bare numeric positional argument is treated as COUNT for parity.
 */

import type { BuiltinCommand } from './types.js';
import { argIsOption_check } from './_shared.js';

interface HistoryOptions {
    clear: boolean;
    count: number | null;
}

type HistoryParseResult =
    | { ok: true; options: HistoryOptions }
    | { ok: false; stderr: string; exitCode: number };

/**
 * Register the `history` builtin handler.
 */
export const command: BuiltinCommand = {
    name: 'history',
    create: () => async (args, shell) => {
        const parsed: HistoryParseResult = historyArgs_parse(args);
        if (!parsed.ok) {
            return {
                stdout: parsed.exitCode === 0 ? parsed.stderr : '',
                stderr: parsed.exitCode === 0 ? '' : parsed.stderr,
                exitCode: parsed.exitCode
            };
        }

        if (parsed.options.clear) {
            shell.history_clear();
            return { stdout: '', stderr: '', exitCode: 0 };
        }

        const historyItems: string[] = shell.history_get();
        const selected: string[] = parsed.options.count === null
            ? historyItems
            : historyItems.slice(Math.max(0, historyItems.length - parsed.options.count));
        const startIndex: number = historyItems.length - selected.length + 1;

        const lines: string[] = selected.map(
            (cmd: string, index: number): string => `  ${String(startIndex + index).padStart(4)}  ${cmd}`
        );
        return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
    }
};

/**
 * Parse history flags and count operands.
 *
 * @param args - Raw command arguments after `history`.
 * @returns Parsed history options or usage/error metadata.
 */
function historyArgs_parse(args: string[]): HistoryParseResult {
    let parseOptions = true;
    let clear = false;
    let count: number | null = null;

    for (let i = 0; i < args.length; i++) {
        const arg: string = args[i];
        if (parseOptions && arg === '--') {
            parseOptions = false;
            continue;
        }

        if (argIsOption_check(arg, parseOptions)) {
            if (arg === '-c') {
                clear = true;
                continue;
            }
            if (arg === '-n') {
                const next: string | undefined = args[i + 1];
                if (!next) {
                    return { ok: false, stderr: 'history: option requires an argument -- n', exitCode: 1 };
                }
                const parsedCount: number = Number(next);
                if (!Number.isInteger(parsedCount) || parsedCount < 0) {
                    return { ok: false, stderr: `history: invalid count '${next}'`, exitCode: 1 };
                }
                count = parsedCount;
                i += 1;
                continue;
            }
            if (arg === '-h' || arg === '--help') {
                return { ok: false, stderr: 'usage: history [-c] [-n COUNT] [COUNT]', exitCode: 0 };
            }
            return { ok: false, stderr: `history: invalid option '${arg}'`, exitCode: 1 };
        }

        const parsedCount: number = Number(arg);
        if (!Number.isInteger(parsedCount) || parsedCount < 0) {
            return { ok: false, stderr: `history: invalid count '${arg}'`, exitCode: 1 };
        }
        count = parsedCount;
    }

    return { ok: true, options: { clear, count } };
}
