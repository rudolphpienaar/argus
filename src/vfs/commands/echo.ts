import type { BuiltinCommand } from './types.js';

export const command: BuiltinCommand = {
    name: 'echo',
    create: () => async (args) => {
        return { stdout: args.join(' '), stderr: '', exitCode: 0 };
    }
};
