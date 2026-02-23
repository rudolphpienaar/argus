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

type LsExpandResult =
    | { ok: true; targets: string[] }
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

        const expandedTargets: LsExpandResult = lsTargets_expand(vfs, parsed.targets);
        if (!expandedTargets.ok) {
            return { stdout: '', stderr: expandedTargets.error, exitCode: 1 };
        }

        const targets: string[] = expandedTargets.targets.length > 0 ? expandedTargets.targets : [vfs.cwd_get()];
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
 * Expand wildcard target operands against directory entries.
 *
 * Supports `*` and `?` in the basename segment. If a wildcard operand has no
 * matches, `ls` returns the canonical "cannot access" error.
 */
function lsTargets_expand(vfs: VirtualFileSystem, targets: string[]): LsExpandResult {
    if (targets.length === 0) {
        return { ok: true, targets: [] };
    }

    const expanded: string[] = [];
    for (const rawTarget of targets) {
        if (!lsPattern_hasMeta(rawTarget)) {
            expanded.push(rawTarget);
            continue;
        }

        const split = lsPattern_split(rawTarget);
        const dirResolved: string = vfs.path_resolve(split.dir);
        const dirNode: FileNode | null = vfs.node_stat(dirResolved);
        if (!dirNode || dirNode.type !== 'folder') {
            return { ok: false, error: `ls: cannot access '${rawTarget}': No such file or directory` };
        }

        const matcher: RegExp = lsPattern_regex(split.pattern);
        const matches: string[] = vfs
            .dir_list(dirResolved)
            .map((entry: FileNode): string => entry.name)
            .filter((name: string): boolean => {
                if (!split.pattern.startsWith('.') && name.startsWith('.')) {
                    return false;
                }
                return matcher.test(name);
            })
            .sort((left: string, right: string): number => left.localeCompare(right));

        if (matches.length === 0) {
            return { ok: false, error: `ls: cannot access '${rawTarget}': No such file or directory` };
        }

        for (const name of matches) {
            if (split.dir === '.') {
                expanded.push(name);
            } else if (split.dir === '/') {
                expanded.push(`/${name}`);
            } else {
                expanded.push(`${split.dir}/${name}`);
            }
        }
    }

    return { ok: true, targets: expanded };
}

function lsPattern_hasMeta(target: string): boolean {
    return /[*?]/.test(target);
}

function lsPattern_split(target: string): { dir: string; pattern: string } {
    const slashIndex: number = target.lastIndexOf('/');
    if (slashIndex === -1) {
        return { dir: '.', pattern: target };
    }
    if (slashIndex === 0) {
        return { dir: '/', pattern: target.slice(1) };
    }
    return {
        dir: target.slice(0, slashIndex),
        pattern: target.slice(slashIndex + 1),
    };
}

function lsPattern_regex(pattern: string): RegExp {
    const escaped: string = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const wildcarded: string = escaped
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp(`^${wildcarded}$`);
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
    const hasTrailingSlash = target.endsWith('/');
    
    // Use lstat first to see what we're dealing with
    const targetNode: FileNode | null = vfs.node_lstat(resolvedPath);
    if (!targetNode) {
        return { ok: false, error: `ls: cannot access '${target}': No such file or directory` };
    }

    // POSIX rule: if it's not a link, or it is a link but we aren't following it 
    // (no trailing slash AND not -d), then we just render the node itself if it's a file.
    if (targetNode.type === 'file' || (targetNode.type === 'link' && !hasTrailingSlash) || directoryOnly) {
        return { ok: true, output: lsEntry_render(vfs, targetNode, longFormat) };
    }

    // If we've reached here, it's either a real folder or a link we WANT to follow
    const effectiveNode: FileNode | null = vfs.node_stat(resolvedPath);
    if (!effectiveNode) {
        return { ok: false, error: `ls: cannot access '${target}': No such file or directory` };
    }

    if (effectiveNode.type !== 'folder') {
        return { ok: true, output: lsEntry_render(vfs, effectiveNode, longFormat) };
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
        const selfRef: FileNode = { ...effectiveNode, name: '.' };
        const parentRef: FileNode = { ...(vfs.node_stat(`${resolvedPath}/..`) || effectiveNode), name: '..' };
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
        const refreshed: FileNode | null = vfs.node_lstat(resolvedEntry.path);
        if (refreshed) {
            resolvedEntry = refreshed;
        }
    }

    let name: string = resolvedEntry.name;
    if (resolvedEntry.type === 'folder') {
        name = `${resolvedEntry.name}/`;
    } else if (resolvedEntry.type === 'link') {
        name = `${resolvedEntry.name}@`;
    }

    if (!longFormat) {
        let colorClass = 'file';
        if (resolvedEntry.type === 'folder') {
            colorClass = 'dir';
        } else if (resolvedEntry.type === 'link') {
            colorClass = 'keyword'; // Yellow/Prominent
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

    return `${typePrefix}${perms} ${sizeField} ${timestamp} ${name}${linkSuffix}`;
}
