import type { BuiltinCommand } from './types.js';

export const command: BuiltinCommand = {
    name: 'history',
    create: () => async (_args, shell) => {
        const lines: string[] = shell
            .history_get()
            .map((cmd: string, index: number): string => `  ${String(index + 1).padStart(4)}  ${cmd}`);
        return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
    }
};
