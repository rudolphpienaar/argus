import type { BuiltinCommand } from './types.js';

export const command: BuiltinCommand = {
    name: 'date',
    create: () => async () => {
        return { stdout: new Date().toString(), stderr: '', exitCode: 0 };
    }
};
