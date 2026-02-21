import type { BuiltinCommand } from './types.js';
import { errorMessage_get } from './_shared.js';

export const command: BuiltinCommand = {
    name: 'cat',
    create: ({ vfs }) => async (args) => {
        if (args.length === 0) {
            return { stdout: '', stderr: 'cat: missing operand', exitCode: 1 };
        }

        try {
            const content: string | null = vfs.node_read(args[0]);
            if (content === null) {
                return { stdout: '', stderr: `cat: ${args[0]}: Is a directory or has no content`, exitCode: 1 };
            }
            return { stdout: content, stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: `cat: ${errorMessage_get(error)}`, exitCode: 1 };
        }
    }
};
