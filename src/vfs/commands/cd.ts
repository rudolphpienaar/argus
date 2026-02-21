import type { BuiltinCommand } from './types.js';

export const command: BuiltinCommand = {
    name: 'cd',
    create: ({ vfs }) => async (args, shell) => {
        const target: string = args[0] || shell.env_get('HOME') || '/';
        try {
            vfs.cwd_set(target);
            const newCwd: string = vfs.cwd_get();
            shell.env_set('PWD', newCwd);
            shell.cwd_didChange(newCwd);
            return { stdout: '', stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return {
                stdout: '',
                stderr: `cd: ${error instanceof Error ? error.message : String(error)}`,
                exitCode: 1
            };
        }
    }
};
