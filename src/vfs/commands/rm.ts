import type { BuiltinCommand } from './types.js';
import { errorMessage_get } from './_shared.js';

export const command: BuiltinCommand = {
    name: 'rm',
    create: ({ vfs }) => async (args) => {
        const recursive: boolean = args.includes('-r') || args.includes('-rf');
        const paths: string[] = args.filter((arg: string): boolean => !arg.startsWith('-'));
        if (paths.length === 0) {
            return { stdout: '', stderr: 'rm: missing operand', exitCode: 1 };
        }

        try {
            for (const path of paths) {
                vfs.node_remove(path, recursive);
            }
            return { stdout: '', stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: `rm: ${errorMessage_get(error)}`, exitCode: 1 };
        }
    }
};
