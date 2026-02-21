/**
 * `cat` builtin implementation.
 *
 * Supported flags:
 * - `-n`, `--number`: number output lines.
 * - `-s`, `--squeeze-blank`: collapse multiple adjacent blank lines.
 * - `-E`, `--show-ends`: append `$` to the end of each line.
 * - `-h`, `--help`: print usage.
 */

import type { BuiltinCommand } from './types.js';
import { argIsOption_check, errorMessage_get } from './_shared.js';

interface CatOptions {
    numberLines: boolean;
    squeezeBlank: boolean;
    showEnds: boolean;
    files: string[];
}

type CatParseResult =
    | { ok: true; options: CatOptions }
    | { ok: false; stderr: string; exitCode: number };

/**
 * Register the `cat` builtin handler.
 */
export const command: BuiltinCommand = {
    name: 'cat',
    create: ({ vfs }) => async (args) => {
        const parsed: CatParseResult = catArgs_parse(args);
        if (!parsed.ok) {
            return { stdout: '', stderr: parsed.stderr, exitCode: parsed.exitCode };
        }

        try {
            const renderedBlocks: string[] = [];
            let lineCounter = 1;
            for (const filePath of parsed.options.files) {
                const content: string | null = vfs.node_read(filePath);
                if (content === null) {
                    return { stdout: '', stderr: `cat: ${filePath}: Is a directory`, exitCode: 1 };
                }
                const rendered = catContent_render(content, parsed.options, lineCounter);
                renderedBlocks.push(rendered.output);
                lineCounter = rendered.nextLineCounter;
            }
            return { stdout: renderedBlocks.join(''), stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: `cat: ${errorMessage_get(error)}`, exitCode: 1 };
        }
    }
};

/**
 * Parse `cat` CLI flags and positional file operands.
 *
 * @param args - Raw command arguments after `cat`.
 * @returns Parsed options on success, or usage/error metadata on failure.
 */
function catArgs_parse(args: string[]): CatParseResult {
    const options: CatOptions = {
        numberLines: false,
        squeezeBlank: false,
        showEnds: false,
        files: []
    };

    let parseOptions = true;
    for (const arg of args) {
        if (parseOptions && arg === '--') {
            parseOptions = false;
            continue;
        }

        if (argIsOption_check(arg, parseOptions)) {
            if (arg === '--number') {
                options.numberLines = true;
                continue;
            }
            if (arg === '--squeeze-blank') {
                options.squeezeBlank = true;
                continue;
            }
            if (arg === '--show-ends') {
                options.showEnds = true;
                continue;
            }
            if (arg === '-h' || arg === '--help') {
                return {
                    ok: false,
                    stderr: 'usage: cat [-n] [-s] [-E] [--] FILE...',
                    exitCode: 0
                };
            }
            if (arg.startsWith('--')) {
                return { ok: false, stderr: `cat: unrecognized option '${arg}'`, exitCode: 1 };
            }

            for (const flag of arg.slice(1)) {
                if (flag === 'n') {
                    options.numberLines = true;
                } else if (flag === 's') {
                    options.squeezeBlank = true;
                } else if (flag === 'E') {
                    options.showEnds = true;
                } else if (flag === 'h') {
                    return {
                        ok: false,
                        stderr: 'usage: cat [-n] [-s] [-E] [--] FILE...',
                        exitCode: 0
                    };
                } else {
                    return { ok: false, stderr: `cat: invalid option -- '${flag}'`, exitCode: 1 };
                }
            }
            continue;
        }

        options.files.push(arg);
    }

    if (options.files.length === 0) {
        return { ok: false, stderr: 'cat: missing operand', exitCode: 1 };
    }

    return { ok: true, options };
}

/**
 * Render cat output for one file payload according to active flags.
 *
 * @param content - File payload read from VFS.
 * @param options - Parsed `cat` options.
 * @param lineCounterStart - Starting display line number for `-n`.
 * @returns Rendered output block and next line number seed.
 */
function catContent_render(
    content: string,
    options: CatOptions,
    lineCounterStart: number
): { output: string; nextLineCounter: number } {
    const sourceLines: string[] = content.split('\n');
    const lines: string[] = [];
    let previousBlank = false;
    let lineCounter = lineCounterStart;

    for (let i = 0; i < sourceLines.length; i++) {
        const line: string = sourceLines[i];
        const isLast = i === sourceLines.length - 1;
        const originalHadTrailingNewline: boolean = content.endsWith('\n');
        const isVirtualLastEmpty = isLast && line === '' && originalHadTrailingNewline;
        if (isVirtualLastEmpty) {
            continue;
        }

        const isBlank: boolean = line.length === 0;
        if (options.squeezeBlank && isBlank && previousBlank) {
            continue;
        }
        previousBlank = isBlank;

        const numberedPrefix: string = options.numberLines ? `${String(lineCounter).padStart(6)}\t` : '';
        const payload: string = options.showEnds ? `${line}$` : line;
        lines.push(`${numberedPrefix}${payload}`);
        lineCounter += 1;
    }

    return { output: lines.join('\n'), nextLineCounter: lineCounter };
}
