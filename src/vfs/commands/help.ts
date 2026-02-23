/**
 * `help` builtin implementation.
 *
 * Supported flags:
 * - `-s`: short mode (command names only).
 * - `-a`: show all command summaries (default when no topic is passed).
 * - `-h`, `--help`: print help usage.
 *
 * Positional arguments are interpreted as command topics.
 */

import type { BuiltinCommand } from './types.js';
import { argIsOption_check } from './_shared.js';

interface HelpOptions {
    short: boolean;
    topics: string[];
}

const HELP_TOPICS: Record<string, string> = {
    cat: 'cat [-n] [-s] [-E] FILE...  # print file contents',
    cd: 'cd [-L|-P] [dir]             # change shell working directory',
    cp: 'cp [-aRr] [-f|-n] [-v] SRC DEST',
    date: 'date [-uR] [-I[=date|seconds]]',
    echo: 'echo [-neE] [arg ...]',
    env: 'env [-0i] [-u NAME] [NAME=VALUE ...]',
    export: 'export [-p] [-n NAME ...] [NAME=VALUE ...]',
    help: 'help [-s] [command ...]',
    history: 'history [-c] [-n COUNT]',
    ls: 'ls [-1Aadhl] [FILE ...]',
    mkdir: 'mkdir [-pv] [-m MODE] DIRECTORY...',
    mv: 'mv [-f|-n] [-v] SOURCE DEST',
    pwd: 'pwd [-LP]',
    python: 'python [python-flags] SCRIPT.py [args ...]',
    rm: 'rm [-f] [-rR] [-d] [-v] FILE...',
    touch: 'touch [-acm] [--no-create] FILE...',
    tree: 'tree [-a] [-d] [-L N] [path]',
    upload: 'upload [-d DEST] [DEST]',
    wc: 'wc [-clmwL] FILE...',
    whoami: 'whoami [-u]'
};

/**
 * Register the `help` builtin handler.
 */
export const command: BuiltinCommand = {
    name: 'help',
    create: ({ listCommands }) => async (args) => {
        const parsed: HelpParseResult = helpArgs_parse(args);
        if (!parsed.ok) {
            return {
                stdout: parsed.exitCode === 0 ? parsed.stderr : '',
                stderr: parsed.exitCode === 0 ? '' : parsed.stderr,
                exitCode: parsed.exitCode
            };
        }

        const commands: string[] = (listCommands ? listCommands() : []).slice().sort();
        if (parsed.options.short) {
            return { stdout: commands.join('\n'), stderr: '', exitCode: 0 };
        }

        if (parsed.options.topics.length > 0) {
            const lines: string[] = [];
            for (const topic of parsed.options.topics) {
                const key: string = topic.toLowerCase();
                const entry: string | undefined = HELP_TOPICS[key];
                if (!entry) {
                    return { stdout: '', stderr: `help: no help topics match '${topic}'`, exitCode: 1 };
                }
                lines.push(entry);
            }
            return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
        }

        const lines: string[] = commands.map((name: string): string => HELP_TOPICS[name] || `${name}`);
        return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
    }
};

type HelpParseResult =
    | { ok: true; options: HelpOptions }
    | { ok: false; stderr: string; exitCode: number };

/**
 * Parse help flags and optional topic operands.
 *
 * @param args - Raw command arguments after `help`.
 * @returns Parsed help options or usage/error metadata.
 */
function helpArgs_parse(args: string[]): HelpParseResult {
    const options: HelpOptions = { short: false, topics: [] };
    let parseOptions = true;

    for (const arg of args) {
        if (parseOptions && arg === '--') {
            parseOptions = false;
            continue;
        }

        if (argIsOption_check(arg, parseOptions)) {
            if (arg === '-s') {
                options.short = true;
                continue;
            }
            if (arg === '-a') {
                continue;
            }
            if (arg === '-h' || arg === '--help') {
                return { ok: false, stderr: 'usage: help [-s] [command ...]', exitCode: 0 };
            }
            return { ok: false, stderr: `help: invalid option '${arg}'`, exitCode: 1 };
        }

        options.topics.push(arg);
    }

    return { ok: true, options };
}
