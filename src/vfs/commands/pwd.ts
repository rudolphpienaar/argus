import type { BuiltinCommand } from './types.js';

export const command: BuiltinCommand = {
    name: 'pwd',
    create: ({ vfs }) => async () => {
        return { stdout: vfs.cwd_get(), stderr: '', exitCode: 0 };
    }
};
