import type { FileNode } from '../types.js';
import type { VirtualFileSystem } from '../VirtualFileSystem.js';
import type { BuiltinCommand } from './types.js';
import { errorMessage_get } from './_shared.js';

type LsArgsParseResult =
    | { ok: true; longFormat: boolean; showAll: boolean; targets: string[] }
    | { ok: false; error: string };

type LsRenderResult =
    | { ok: true; output: string }
    | { ok: false; error: string };

export const command: BuiltinCommand = {
    name: 'ls',
    create: ({ vfs }) => async (args) => {
        const parsed: LsArgsParseResult = lsArgs_parse(args);
        if (!parsed.ok) {
            return { stdout: '', stderr: parsed.error, exitCode: 1 };
        }

        const targets: string[] = parsed.targets.length > 0 ? parsed.targets : [vfs.cwd_get()];
        const blocks: string[] = [];

        try {
            for (let i = 0; i < targets.length; i++) {
                const target: string = targets[i];
                const listing: LsRenderResult = lsTarget_render(vfs, target, parsed.longFormat, parsed.showAll);
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

function lsArgs_parse(args: string[]): LsArgsParseResult {
    let longFormat = false;
    let showAll = false;
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
            return { ok: false, error: `ls: unrecognized option '${arg}'` };
        }

        if (parseOptions && arg.startsWith('-') && arg.length > 1) {
            for (const flag of arg.slice(1)) {
                if (flag === 'l') {
                    longFormat = true;
                } else if (flag === 'a') {
                    showAll = true;
                } else {
                    return { ok: false, error: `ls: invalid option -- '${flag}'` };
                }
            }
            continue;
        }

        targets.push(arg);
    }

    return { ok: true, longFormat, showAll, targets };
}

function lsTarget_render(
    vfs: VirtualFileSystem,
    target: string,
    longFormat: boolean,
    showAll: boolean
): LsRenderResult {
    const resolvedPath: string = vfs.path_resolve(target);
    const targetNode: FileNode | null = vfs.node_stat(resolvedPath);
    if (!targetNode) {
        return { ok: false, error: `ls: cannot access '${target}': No such file or directory` };
    }

    if (targetNode.type === 'file' || targetNode.type === 'link') {
        return { ok: true, output: lsEntry_render(vfs, targetNode, longFormat) };
    }

    let children: FileNode[] = vfs
        .dir_list(resolvedPath)
        .slice()
        .sort((a: FileNode, b: FileNode): number => a.name.localeCompare(b.name));

    if (!showAll) {
        children = children.filter((child: FileNode): boolean => !child.name.startsWith('.'));
    } else {
        const selfRef: FileNode = { ...targetNode, name: '.' };
        const parentRef: FileNode = { ...(vfs.node_stat(`${resolvedPath}/..`) || targetNode), name: '..' };
        children = [selfRef, parentRef, ...children];
    }

    const lines: string[] = children.map((child: FileNode): string => lsEntry_render(vfs, child, longFormat));
    return { ok: true, output: lines.join('\n') };
}

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
