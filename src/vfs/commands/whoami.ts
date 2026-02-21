/**
 * `whoami` builtin implementation.
 *
 * Supported flags:
 * - `-u`: print numeric UID (simulated).
 * - `-h`, `--help`: print usage.
 */

import type { BuiltinCommand } from './types.js';

export const command: BuiltinCommand = {
    name: 'whoami',
    create: () => async (args, shell) => {
        let numeric = false;
        for (const arg of args) {
            if (arg === '-u') {
                numeric = true;
                continue;
            }
            if (arg === '-h' || arg === '--help') {
                return { stdout: 'usage: whoami [-u]', stderr: '', exitCode: 0 };
            }
            return { stdout: '', stderr: `whoami: invalid option '${arg}'`, exitCode: 1 };
        }

        if (numeric) {
            return { stdout: '1000', stderr: '', exitCode: 0 };
        }
        return { stdout: shell.env_get('USER') || 'user', stderr: '', exitCode: 0 };
    }
};
