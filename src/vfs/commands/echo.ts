/**
 * `echo` builtin implementation.
 *
 * Supported flags:
 * - `-n`: suppress trailing newline (no-op for ARGUS shell result framing, retained for parity).
 * - `-e`: enable backslash escape interpretation.
 * - `-E`: disable backslash escape interpretation (default).
 * - `-h`, `--help`: print usage.
 */

import type { BuiltinCommand } from './types.js';

/**
 * Register the `echo` builtin handler.
 */
export const command: BuiltinCommand = {
    name: 'echo',
    create: () => async (args) => {
        const parsed: EchoParseResult = echoArgs_parse(args);
        if (!parsed.ok) {
            return {
                stdout: parsed.exitCode === 0 ? parsed.message : '',
                stderr: parsed.exitCode === 0 ? '' : parsed.message,
                exitCode: parsed.exitCode
            };
        }

        const output: string = parsed.enableEscapes
            ? echoEscapes_resolve(parsed.words.join(' '))
            : parsed.words.join(' ');
        return { stdout: output, stderr: '', exitCode: 0 };
    }
};

type EchoParseResult =
    | { ok: true; words: string[]; enableEscapes: boolean }
    | { ok: false; message: string; exitCode: number };

/**
 * Parse `echo` option flags and collect payload words.
 *
 * @param args - Raw command arguments after `echo`.
 * @returns Parsed echo options and payload tokens.
 */
function echoArgs_parse(args: string[]): EchoParseResult {
    const words: string[] = [];
    let parseOptions = true;
    let enableEscapes = false;

    for (const arg of args) {
        if (parseOptions && arg === '--') {
            parseOptions = false;
            continue;
        }

        if (parseOptions && arg === '--help') {
            return { ok: false, message: 'usage: echo [-neE] [arg ...]', exitCode: 0 };
        }

        if (parseOptions && arg.startsWith('-') && arg.length > 1) {
            let recognized = true;
            for (const flag of arg.slice(1)) {
                if (flag === 'n') {
                    continue;
                }
                if (flag === 'e') {
                    enableEscapes = true;
                    continue;
                }
                if (flag === 'E') {
                    enableEscapes = false;
                    continue;
                }
                if (flag === 'h') {
                    return { ok: false, message: 'usage: echo [-neE] [arg ...]', exitCode: 0 };
                }
                recognized = false;
                break;
            }
            if (recognized) {
                continue;
            }
        }

        parseOptions = false;
        words.push(arg);
    }

    return { ok: true, words, enableEscapes };
}

/**
 * Resolve supported backslash escape sequences.
 *
 * @param input - Unescaped payload string.
 * @returns String with supported escape sequences resolved.
 */
function echoEscapes_resolve(input: string): string {
    return input.replace(/\\([ntr0\\])/g, (_match: string, code: string): string => {
        if (code === 'n') return '\n';
        if (code === 't') return '\t';
        if (code === 'r') return '\r';
        if (code === '0') return '\0';
        return '\\';
    });
}
