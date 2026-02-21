import type { BuiltinCommand } from './types.js';

export const command: BuiltinCommand = {
    name: 'whoami',
    create: () => async (_args, shell) => {
        return { stdout: shell.env_get('USER') || 'user', stderr: '', exitCode: 0 };
    }
};
