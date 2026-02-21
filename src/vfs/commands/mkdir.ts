import type { BuiltinCommand } from './types.js';
import { errorMessage_get } from './_shared.js';

export const command: BuiltinCommand = {
    name: 'mkdir',
    create: ({ vfs }) => async (args) => {
        if (args.length === 0) {
            return { stdout: '', stderr: 'mkdir: missing operand', exitCode: 1 };
        }
        try {
            vfs.dir_create(args[0]);
            return { stdout: '', stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: `mkdir: ${errorMessage_get(error)}`, exitCode: 1 };
        }
    }
};
