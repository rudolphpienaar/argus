/**
 * `tree` builtin implementation.
 *
 * Supported flags:
 * - `-a`: include hidden entries.
 * - `-d`: list directories only.
 * - `-L N`: descend only N directory levels.
 * - `-h`, `--help`: print usage.
 */

import type { FileNode } from '../types.js';
import type { BuiltinCommand } from './types.js';
import { argIsOption_check, errorMessage_get } from './_shared.js';

interface TreeOptions {
    showAll: boolean;
    directoriesOnly: boolean;
    maxDepth: number | null;
    target: string;
}

type TreeParseResult =
    | { ok: true; options: TreeOptions }
    | { ok: false; stderr: string; exitCode: number };

/**
 * Register the `tree` builtin handler.
 */
export const command: BuiltinCommand = {
    name: 'tree',
    create: ({ vfs }) => async (args) => {
        const parsed: TreeParseResult = treeArgs_parse(args);
        if (!parsed.ok) {
            return {
                stdout: parsed.exitCode === 0 ? parsed.stderr : '',
                stderr: parsed.exitCode === 0 ? '' : parsed.stderr,
                exitCode: parsed.exitCode
            };
        }

        const target: string = parsed.options.target;
        try {
            const resolved: string = vfs.path_resolve(target);
            const root: FileNode | null = vfs.node_stat(resolved);
            if (!root) {
                return { stdout: '', stderr: `tree: '${target}': No such file or directory`, exitCode: 1 };
            }
            if (root.type !== 'folder') {
                return { stdout: root.name, stderr: '', exitCode: 0 };
            }

            const lines: string[] = [];
            let dirCount = 0;
            let fileCount = 0;

            const subtree_render = (node: FileNode, prefix: string, nodePath: string, depth: number): void => {
                if (parsed.options.maxDepth !== null && depth >= parsed.options.maxDepth) {
                    return;
                }

                let children: FileNode[] = (node.children || [])
                    .slice()
                    .sort((a: FileNode, b: FileNode): number => a.name.localeCompare(b.name));
                if (!parsed.options.showAll) {
                    children = children.filter((child: FileNode): boolean => !child.name.startsWith('.'));
                }
                if (parsed.options.directoriesOnly) {
                    children = children.filter((child: FileNode): boolean => child.type === 'folder');
                }

                for (let i = 0; i < children.length; i++) {
                    const child: FileNode = children[i];
                    const isLast: boolean = i === children.length - 1;
                    const connector: string = isLast ? '└── ' : '├── ';
                    const name: string = child.type === 'folder' ? `${child.name}/` : child.name;
                    const childPath: string = `${nodePath}/${child.name}`;

                    lines.push(`${prefix}${connector}${name}`);

                    if (child.type === 'folder') {
                        dirCount += 1;
                        const nextPrefix: string = prefix + (isLast ? '    ' : '│   ');
                        subtree_render(child, nextPrefix, childPath, depth + 1);
                    } else {
                        fileCount += 1;
                    }
                }
            };

            lines.push(`${root.name}/`);
            dirCount += 1;
            subtree_render(root, '', resolved, 0);
            lines.push('');
            lines.push(`${dirCount} director${dirCount === 1 ? 'y' : 'ies'}, ${fileCount} file${fileCount === 1 ? '' : 's'}`);

            return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: `tree: ${errorMessage_get(error)}`, exitCode: 1 };
        }
    }
};

/**
 * Parse `tree` flags and optional target operand.
 *
 * @param args - Raw command arguments after `tree`.
 * @returns Parsed tree rendering options or usage/error metadata.
 */
function treeArgs_parse(args: string[]): TreeParseResult {
    let parseOptions = true;
    let showAll = false;
    let directoriesOnly = false;
    let maxDepth: number | null = null;
    const targets: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg: string = args[i];
        if (parseOptions && arg === '--') {
            parseOptions = false;
            continue;
        }

        if (argIsOption_check(arg, parseOptions)) {
            if (arg === '--help' || arg === '-h') {
                return { ok: false, stderr: 'usage: tree [-ad] [-L level] [directory]', exitCode: 0 };
            }
            if (arg.startsWith('--')) {
                return { ok: false, stderr: `tree: unrecognized option '${arg}'`, exitCode: 1 };
            }

            const shortFlags: string = arg.slice(1);
            for (let j = 0; j < shortFlags.length; j++) {
                const flag: string = shortFlags[j];
                if (flag === 'a') {
                    showAll = true;
                } else if (flag === 'd') {
                    directoriesOnly = true;
                } else if (flag === 'L') {
                    const inline: string = shortFlags.slice(j + 1);
                    const rawDepth: string | undefined = inline.length > 0 ? inline : args[i + 1];
                    if (!rawDepth) {
                        return { ok: false, stderr: 'tree: option requires an argument -- L', exitCode: 1 };
                    }
                    const parsedDepth: number = Number(rawDepth);
                    if (!Number.isInteger(parsedDepth) || parsedDepth < 0) {
                        return { ok: false, stderr: `tree: invalid level '${rawDepth}'`, exitCode: 1 };
                    }
                    maxDepth = parsedDepth;
                    if (inline.length === 0) {
                        i += 1;
                    }
                    break;
                } else {
                    return { ok: false, stderr: `tree: invalid option -- '${flag}'`, exitCode: 1 };
                }
            }
            continue;
        }

        targets.push(arg);
    }

    if (targets.length > 1) {
        return { ok: false, stderr: 'tree: too many arguments', exitCode: 1 };
    }

    return {
        ok: true,
        options: {
            showAll,
            directoriesOnly,
            maxDepth,
            target: targets[0] || '.'
        }
    };
}
