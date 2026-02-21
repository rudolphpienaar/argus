import type { BuiltinCommand } from './types.js';

export const command: BuiltinCommand = {
    name: 'env',
    create: () => async (_args, shell) => {
        const env: Record<string, string> = shell.env_snapshot();
        const lines: string[] = Object.entries(env).map(([key, value]: [string, string]): string => `${key}=${value}`);
        return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
    }
};
