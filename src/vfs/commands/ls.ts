/**
 * `ls` builtin implementation.
 *
 * Supported flags:
 * - `-l`, `--long`: long-list format.
 * - `-a`, `--all`: include hidden entries and synthetic `.`/`..`.
 * - `-A`, `--almost-all`: include hidden entries, excluding `.` and `..`.
 * - `-d`, `--directory`: list directory entries themselves, not their contents.
 * - `-1`: force one-entry-per-line output.
 * - `-h`, `--human-readable`: accepted for compatibility (sizes are already humanized).
 * - `-h` is overloaded by GNU `ls`; here use `--help` for usage output.
 */

import type { FileNode } from '../types.js';
import type { VirtualFileSystem } from '../VirtualFileSystem.js';
import type { BuiltinCommand } from './types.js';
import { errorMessage_get } from './_shared.js';

type LsArgsParseResult =
    | {
        ok: true;
        longFormat: boolean;
        showAll: boolean;
        almostAll: boolean;
        directoryOnly: boolean;
        forceOnePerLine: boolean;
        targets: string[];
    }
    | { ok: false; error: string; exitCode: number };

type LsRenderResult =
    | { ok: true; output: string }
    | { ok: false; error: string };

/**
 * Register the `ls` builtin handler.
 */
export const command: BuiltinCommand = {
    name: 'ls',
    create: ({ vfs }) => async (args) => {
        const parsed: LsArgsParseResult = lsArgs_parse(args);
        if (!parsed.ok) {
            return {
                stdout: parsed.exitCode === 0 ? parsed.error : '',
                stderr: parsed.exitCode === 0 ? '' : parsed.error,
                exitCode: parsed.exitCode
            };
        }

        const targets: string[] = parsed.targets.length > 0 ? parsed.targets : [vfs.cwd_get()];
        const blocks: string[] = [];

        try {
            for (let i = 0; i < targets.length; i++) {
                const target: string = targets[i];
                const listing: LsRenderResult = lsTarget_render(
                    vfs,
                    target,
                    parsed.longFormat,
                    parsed.showAll,
                    parsed.almostAll,
                    parsed.directoryOnly,
                    parsed.forceOnePerLine
                );
                if (!listing.ok) {
                    return { stdout: '', stderr: listing.error, exitCode: 1 };
                }

                if (targets.length > 1) {
                    blocks.push(`${target}:`);
                }
                blocks.push(listing.output);
                if (i < targets.length - 1) {
                    blocks.push('');
                }
            }

            return { stdout: blocks.join('\n'), stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: `ls: ${errorMessage_get(error)}`, exitCode: 1 };
        }
    }
};

/**
 * Parse `ls` options and collect target operands.
 *
 * @param args - Raw command arguments after `ls`.
 * @returns Parsed listing options or usage/error metadata.
 */
function lsArgs_parse(args: string[]): LsArgsParseResult {
    let longFormat = false;
    let showAll = false;
    let almostAll = false;
    let directoryOnly = false;
    let forceOnePerLine = false;
    const targets: string[] = [];
    let parseOptions = true;

    for (const arg of args) {
        if (parseOptions && arg === '--') {
            parseOptions = false;
            continue;
        }

        if (parseOptions && arg.startsWith('--')) {
            if (arg === '--long') {
                longFormat = true;
                continue;
            }
            if (arg === '--all') {
                showAll = true;
                continue;
            }
            if (arg === '--almost-all') {
                almostAll = true;
                continue;
            }
            if (arg === '--directory') {
                directoryOnly = true;
                continue;
            }
            if (arg === '--human-readable') {
                continue;
            }
            if (arg === '--help') {
                return { ok: false, error: 'usage: ls [-1Aadhl] [--] [FILE...]', exitCode: 0 };
            }
            return { ok: false, error: `ls: unrecognized option '${arg}'`, exitCode: 1 };
        }

        if (parseOptions && arg.startsWith('-') && arg.length > 1) {
            for (const flag of arg.slice(1)) {
                if (flag === 'l') {
                    longFormat = true;
                } else if (flag === 'a') {
                    showAll = true;
                } else if (flag === 'A') {
                    almostAll = true;
                } else if (flag === 'd') {
                    directoryOnly = true;
                } else if (flag === '1') {
                    forceOnePerLine = true;
                } else if (flag === 'h') {
                    continue;
                } else {
                    return { ok: false, error: `ls: invalid option -- '${flag}'`, exitCode: 1 };
                }
            }
            continue;
        }

        targets.push(arg);
    }

    return { ok: true, longFormat, showAll, almostAll, directoryOnly, forceOnePerLine, targets };
}

/**
 * Render one `ls` target (single file/link or directory listing).
 *
 * @param vfs - Active virtual filesystem instance.
 * @param target - Raw target operand from CLI.
 * @param longFormat - Whether long-list format is enabled.
 * @param showAll - Whether hidden entries plus `.`/`..` are included.
 * @param almostAll - Whether hidden entries are included excluding `.`/`..`.
 * @param directoryOnly - Whether to render directory entries instead of children.
 * @param _forceOnePerLine - Reserved parity flag for one-entry-per-line mode.
 * @returns Rendered target output or an error payload.
 */
function lsTarget_render(
    vfs: VirtualFileSystem,
    target: string,
    longFormat: boolean,
    showAll: boolean,
    almostAll: boolean,
    directoryOnly: boolean,
    _forceOnePerLine: boolean
): LsRenderResult {
    const resolvedPath: string = vfs.path_resolve(target);
    const targetNode: FileNode | null = vfs.node_stat(resolvedPath);
    if (!targetNode) {
        return { ok: false, error: `ls: cannot access '${target}': No such file or directory` };
    }

    if (targetNode.type === 'file' || targetNode.type === 'link' || directoryOnly) {
        return { ok: true, output: lsEntry_render(vfs, targetNode, longFormat) };
    }

    let children: FileNode[] = vfs
        .dir_list(resolvedPath)
        .slice()
        .sort((a: FileNode, b: FileNode): number => a.name.localeCompare(b.name));

    if (!showAll) {
        if (!almostAll) {
            children = children.filter((child: FileNode): boolean => !child.name.startsWith('.'));
        }
    } else {
        const selfRef: FileNode = { ...targetNode, name: '.' };
        const parentRef: FileNode = { ...(vfs.node_stat(`${resolvedPath}/..`) || targetNode), name: '..' };
        children = [selfRef, parentRef, ...children];
    }

    const lines: string[] = children.map((child: FileNode): string => lsEntry_render(vfs, child, longFormat));
    return { ok: true, output: lines.join('\n') };
}

/**
 * Render one `ls` entry in short or long format.
 *
 * @param vfs - Active virtual filesystem instance.
 * @param entry - Node metadata to render.
 * @param longFormat - Whether to render long listing fields.
 * @returns HTML/plain-text compatible listing line for one entry.
 */
function lsEntry_render(
    vfs: VirtualFileSystem,
    entry: FileNode,
    longFormat: boolean
): string {
    let resolvedEntry: FileNode = entry;
    if (resolvedEntry.type === 'file' && resolvedEntry.content === null && resolvedEntry.contentGenerator) {
        vfs.node_read(resolvedEntry.path);
        const refreshed: FileNode | null = vfs.node_stat(resolvedEntry.path);
        if (refreshed) {
            resolvedEntry = refreshed;
        }
    }

    const name: string = resolvedEntry.type === 'folder' ? `${resolvedEntry.name}/` : resolvedEntry.name;

    if (!longFormat) {
        let colorClass = 'file';
        if (resolvedEntry.type === 'folder') {
            colorClass = 'dir';
        } else if (resolvedEntry.type === 'link') {
            colorClass = 'dim';
        } else if (resolvedEntry.name.endsWith('.py') || resolvedEntry.name.endsWith('.sh')) {
            colorClass = 'exec';
        }
        const size: string = resolvedEntry.size || '0 B';
        return `<span class="${colorClass}">${name.padEnd(24)}</span> <span class="size-highlight">${size}</span>`;
    }

    const typePrefix: string = resolvedEntry.type === 'folder' ? 'd' : resolvedEntry.type === 'link' ? 'l' : '-';
    const perms: string = resolvedEntry.permissions === 'rw' ? 'rw-rw-r--' : 'r--r--r--';
    const timestamp: string = resolvedEntry.modified.toISOString().replace('T', ' ').slice(0, 16);
    const sizeField: string = (resolvedEntry.size || '0 B').padStart(8);
    const linkSuffix: string = resolvedEntry.type === 'link' && resolvedEntry.target ? ` -> ${resolvedEntry.target}` : '';
    const plainName: string = resolvedEntry.type === 'folder' ? `${resolvedEntry.name}/` : resolvedEntry.name;

    return `${typePrefix}${perms} ${sizeField} ${timestamp} ${plainName}${linkSuffix}`;
}
