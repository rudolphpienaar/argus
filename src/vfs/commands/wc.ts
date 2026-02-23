/**
 * `wc` builtin implementation.
 *
 * Supported flags:
 * - `-l`, `--lines`: print newline counts.
 * - `-w`, `--words`: print word counts.
 * - `-c`, `--bytes`: print byte counts.
 * - `-m`, `--chars`: print character counts.
 * - `-L`, `--max-line-length`: print maximum line length.
 * - `-h`, `--help`: print usage.
 */

import type { BuiltinCommand } from './types.js';
import type { FileNode } from '../types.js';
import { argIsOption_check, errorMessage_get } from './_shared.js';

interface WcOptions {
    lines: boolean;
    words: boolean;
    bytes: boolean;
    chars: boolean;
    maxLineLength: boolean;
    files: string[];
}

interface WcCounts {
    lines: number;
    words: number;
    bytes: number;
    chars: number;
    maxLineLength: number;
}

type WcParseResult =
    | { ok: true; options: WcOptions }
    | { ok: false; stderr: string; exitCode: number };

const WC_FIELD_ORDER: Array<keyof WcCounts> = ['lines', 'words', 'chars', 'bytes', 'maxLineLength'];

/**
 * Register the `wc` builtin handler.
 */
export const command: BuiltinCommand = {
    name: 'wc',
    create: ({ vfs }) => async (args) => {
        const parsed: WcParseResult = wcArgs_parse(args);
        if (!parsed.ok) {
            return {
                stdout: parsed.exitCode === 0 ? parsed.stderr : '',
                stderr: parsed.exitCode === 0 ? '' : parsed.stderr,
                exitCode: parsed.exitCode,
            };
        }

        const selectedFields: Array<keyof WcCounts> = wcFields_selected(parsed.options);
        const rows: Array<{ label: string; counts: WcCounts }> = [];

        try {
            for (const file of parsed.options.files) {
                const node: FileNode | null = vfs.node_stat(file);
                if (!node) {
                    return { stdout: '', stderr: `wc: ${file}: No such file or directory`, exitCode: 1 };
                }
                if (node.type === 'folder') {
                    return { stdout: '', stderr: `wc: ${file}: Is a directory`, exitCode: 1 };
                }

                const content: string | null = vfs.node_read(file);
                if (content === null) {
                    return { stdout: '', stderr: `wc: ${file}: Is a directory`, exitCode: 1 };
                }

                rows.push({
                    label: file,
                    counts: wcCounts_measure(content),
                });
            }
        } catch (error: unknown) {
            return { stdout: '', stderr: `wc: ${errorMessage_get(error)}`, exitCode: 1 };
        }

        const totals: WcCounts | null = rows.length > 1 ? wcCounts_total(rows.map((row) => row.counts)) : null;
        const width: number = wcWidth_resolve(selectedFields, rows, totals);
        const lines: string[] = rows.map((row) => wcRow_render(selectedFields, row.counts, row.label, width));

        if (totals) {
            lines.push(wcRow_render(selectedFields, totals, 'total', width));
        }

        return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
    },
};

/**
 * Parse `wc` flags and positional file operands.
 */
function wcArgs_parse(args: string[]): WcParseResult {
    const options: WcOptions = {
        lines: false,
        words: false,
        bytes: false,
        chars: false,
        maxLineLength: false,
        files: [],
    };

    let parseOptions = true;
    for (const arg of args) {
        if (parseOptions && arg === '--') {
            parseOptions = false;
            continue;
        }

        if (argIsOption_check(arg, parseOptions)) {
            if (arg === '--lines') {
                options.lines = true;
                continue;
            }
            if (arg === '--words') {
                options.words = true;
                continue;
            }
            if (arg === '--bytes') {
                options.bytes = true;
                continue;
            }
            if (arg === '--chars') {
                options.chars = true;
                continue;
            }
            if (arg === '--max-line-length') {
                options.maxLineLength = true;
                continue;
            }
            if (arg === '-h' || arg === '--help') {
                return {
                    ok: false,
                    stderr: 'usage: wc [-clmwL] [--] FILE...',
                    exitCode: 0,
                };
            }
            if (arg.startsWith('--')) {
                return { ok: false, stderr: `wc: unrecognized option '${arg}'`, exitCode: 1 };
            }

            for (const flag of arg.slice(1)) {
                if (flag === 'l') {
                    options.lines = true;
                } else if (flag === 'w') {
                    options.words = true;
                } else if (flag === 'c') {
                    options.bytes = true;
                } else if (flag === 'm') {
                    options.chars = true;
                } else if (flag === 'L') {
                    options.maxLineLength = true;
                } else if (flag === 'h') {
                    return {
                        ok: false,
                        stderr: 'usage: wc [-clmwL] [--] FILE...',
                        exitCode: 0,
                    };
                } else {
                    return { ok: false, stderr: `wc: invalid option -- '${flag}'`, exitCode: 1 };
                }
            }
            continue;
        }

        options.files.push(arg);
    }

    if (options.files.length === 0) {
        return { ok: false, stderr: 'wc: missing operand', exitCode: 1 };
    }

    return { ok: true, options };
}

function wcFields_selected(options: WcOptions): Array<keyof WcCounts> {
    if (!options.lines && !options.words && !options.bytes && !options.chars && !options.maxLineLength) {
        return ['lines', 'words', 'bytes'];
    }
    return WC_FIELD_ORDER.filter((field: keyof WcCounts): boolean => {
        if (field === 'lines') return options.lines;
        if (field === 'words') return options.words;
        if (field === 'bytes') return options.bytes;
        if (field === 'chars') return options.chars;
        return options.maxLineLength;
    });
}

function wcCounts_measure(content: string): WcCounts {
    const lines: number = Array.from(content).reduce(
        (count: number, ch: string): number => (ch === '\n' ? count + 1 : count),
        0
    );
    const words: number = content.trim().length === 0 ? 0 : (content.trim().match(/\S+/g) || []).length;
    const bytes: number = Buffer.byteLength(content, 'utf8');
    const chars: number = Array.from(content).length;
    const maxLineLength: number = content
        .split('\n')
        .reduce((max: number, line: string): number => Math.max(max, Array.from(line).length), 0);

    return { lines, words, bytes, chars, maxLineLength };
}

function wcCounts_total(counts: WcCounts[]): WcCounts {
    return counts.reduce(
        (total: WcCounts, next: WcCounts): WcCounts => ({
            lines: total.lines + next.lines,
            words: total.words + next.words,
            bytes: total.bytes + next.bytes,
            chars: total.chars + next.chars,
            maxLineLength: Math.max(total.maxLineLength, next.maxLineLength),
        }),
        { lines: 0, words: 0, bytes: 0, chars: 0, maxLineLength: 0 }
    );
}

function wcWidth_resolve(
    fields: Array<keyof WcCounts>,
    rows: Array<{ label: string; counts: WcCounts }>,
    totals: WcCounts | null
): number {
    let width = 1;
    const expand = (counts: WcCounts): void => {
        for (const field of fields) {
            width = Math.max(width, String(counts[field]).length);
        }
    };
    rows.forEach((row) => expand(row.counts));
    if (totals) {
        expand(totals);
    }
    return width;
}

function wcRow_render(fields: Array<keyof WcCounts>, counts: WcCounts, label: string, width: number): string {
    const metrics: string = fields
        .map((field: keyof WcCounts): string => String(counts[field]).padStart(width))
        .join(' ');
    return `${metrics} ${label}`;
}
