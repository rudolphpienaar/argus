import type { BuiltinCommand } from './types.js';
import { errorMessage_get } from './_shared.js';

export const command: BuiltinCommand = {
    name: 'mv',
    create: ({ vfs }) => async (args) => {
        if (args.length < 2) {
            return { stdout: '', stderr: 'mv: missing operand', exitCode: 1 };
        }

        try {
            vfs.node_move(args[0], args[1]);
            return { stdout: '', stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: `mv: ${errorMessage_get(error)}`, exitCode: 1 };
        }
    }
};
