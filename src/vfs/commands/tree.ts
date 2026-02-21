import type { FileNode } from '../types.js';
import type { BuiltinCommand } from './types.js';
import { errorMessage_get } from './_shared.js';

export const command: BuiltinCommand = {
    name: 'tree',
    create: ({ vfs }) => async (args) => {
        const target: string = args[0] || '.';
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

            const subtree_render = (node: FileNode, prefix: string, nodePath: string): void => {
                const children: FileNode[] = (node.children || [])
                    .slice()
                    .sort((a: FileNode, b: FileNode): number => a.name.localeCompare(b.name));

                for (let i = 0; i < children.length; i++) {
                    const child: FileNode = children[i];
                    const isLast: boolean = i === children.length - 1;
                    const connector: string = isLast ? '└── ' : '├── ';
                    const name: string = child.type === 'folder' ? `${child.name}/` : child.name;
                    const childPath: string = `${nodePath}/${child.name}`;

                    if (child.type === 'file' && child.content === null && child.contentGenerator) {
                        vfs.node_read(childPath);
                    }

                    lines.push(`${prefix}${connector}${name}`);

                    if (child.type === 'folder') {
                        dirCount += 1;
                        const nextPrefix: string = prefix + (isLast ? '    ' : '│   ');
                        subtree_render(child, nextPrefix, childPath);
                    } else {
                        fileCount += 1;
                    }
                }
            };

            lines.push(`${root.name}/`);
            dirCount += 1;
            subtree_render(root, '', resolved);
            lines.push('');
            lines.push(`${dirCount} director${dirCount === 1 ? 'y' : 'ies'}, ${fileCount} file${fileCount === 1 ? '' : 's'}`);

            return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: `tree: ${errorMessage_get(error)}`, exitCode: 1 };
        }
    }
};
