import type { BuiltinCommand } from './types.js';

export const command: BuiltinCommand = {
    name: 'export',
    create: () => async (args, shell) => {
        if (args.length === 0) {
            const env: Record<string, string> = shell.env_snapshot();
            const lines: string[] = Object.entries(env).map(([key, value]: [string, string]): string => `${key}=${value}`);
            return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
        }

        const parts: string[] = args[0].split('=');
        if (parts.length !== 2) {
            return { stdout: '', stderr: 'export: invalid format. Use: export KEY=VALUE', exitCode: 1 };
        }
        shell.env_set(parts[0], parts[1]);
        return { stdout: '', stderr: '', exitCode: 0 };
    }
};
