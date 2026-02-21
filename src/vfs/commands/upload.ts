/**
 * `upload` builtin implementation (browser-only).
 *
 * Supported flags:
 * - `-d PATH`, `--destination PATH`: explicit upload destination.
 * - `-r`, `--recursive`: accepted for parity (directory recursion delegated to browser picker).
 * - `-f`, `--force`: accepted for parity.
 * - `-h`, `--help`: print usage.
 */

import type { BuiltinCommand } from './types.js';
import { argIsOption_check, errorMessage_get } from './_shared.js';

interface UploadOptions {
    destination?: string;
}

type UploadParseResult =
    | { ok: true; options: UploadOptions }
    | { ok: false; stderr: string; exitCode: number };

/**
 * Register the `upload` builtin handler.
 */
export const command: BuiltinCommand = {
    name: 'upload',
    create: ({ vfs }) => async (args) => {
        try {
            const parsed: UploadParseResult = uploadArgs_parse(args);
            if (!parsed.ok) {
                return {
                    stdout: parsed.exitCode === 0 ? parsed.stderr : '',
                    stderr: parsed.exitCode === 0 ? '' : parsed.stderr,
                    exitCode: parsed.exitCode
                };
            }

            if (typeof document === 'undefined') {
                return { stdout: '', stderr: 'upload: Command only available in browser mode.', exitCode: 1 };
            }

            const { files_prompt, files_ingest } = await import('../../core/logic/FileUploader.js');
            let destination: string = vfs.cwd_get();
            if (parsed.options.destination) {
                destination = vfs.path_resolve(parsed.options.destination);
            }

            const files: File[] = await files_prompt();
            if (files.length === 0) {
                return { stdout: '<span class="dim">Upload cancelled.</span>', stderr: '', exitCode: 0 };
            }

            const count: number = await files_ingest(files, destination);
            return {
                stdout: `<span class="success">Successfully uploaded ${count} file(s) to ${destination}</span>`,
                stderr: '',
                exitCode: 0
            };
        } catch (error: unknown) {
            return { stdout: '', stderr: errorMessage_get(error), exitCode: 1 };
        }
    }
};

/**
 * Parse upload destination flags and positional operands.
 *
 * @param args - Raw command arguments after `upload`.
 * @returns Parsed upload options or usage/error metadata.
 */
function uploadArgs_parse(args: string[]): UploadParseResult {
    let parseOptions = true;
    let destination: string | undefined;
    const positionals: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg: string = args[i];
        if (parseOptions && arg === '--') {
            parseOptions = false;
            continue;
        }

        if (argIsOption_check(arg, parseOptions)) {
            if (arg === '-r' || arg === '--recursive' || arg === '-f' || arg === '--force') {
                continue;
            }
            if (arg === '-d' || arg === '--destination') {
                const next: string | undefined = args[i + 1];
                if (!next) {
                    return { ok: false, stderr: 'upload: option requires an argument -- d', exitCode: 1 };
                }
                destination = next;
                i += 1;
                continue;
            }
            if (arg.startsWith('--destination=')) {
                destination = arg.split('=', 2)[1];
                continue;
            }
            if (arg === '-h' || arg === '--help') {
                return { ok: false, stderr: 'usage: upload [-d DESTINATION] [DESTINATION]', exitCode: 0 };
            }
            return { ok: false, stderr: `upload: invalid option '${arg}'`, exitCode: 1 };
        }

        positionals.push(arg);
    }

    if (positionals.length > 1) {
        return { ok: false, stderr: 'upload: too many arguments', exitCode: 1 };
    }
    if (!destination && positionals.length === 1) {
        destination = positionals[0];
    }

    return { ok: true, options: { destination } };
}
