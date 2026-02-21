import type { BuiltinCommand } from './types.js';
import { errorMessage_get } from './_shared.js';

export const command: BuiltinCommand = {
    name: 'touch',
    create: ({ vfs }) => async (args) => {
        if (args.length === 0) {
            return { stdout: '', stderr: 'touch: missing file operand', exitCode: 1 };
        }
        try {
            vfs.file_create(args[0]);
            return { stdout: '', stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: `touch: ${errorMessage_get(error)}`, exitCode: 1 };
        }
    }
};
