/**
 * `pwd` builtin implementation.
 *
 * Supported flags:
 * - `-L`: logical path (default).
 * - `-P`: physical path (same behavior in this VFS).
 * - `-h`, `--help`: print usage.
 */

import type { BuiltinCommand } from './types.js';

export const command: BuiltinCommand = {
    name: 'pwd',
    create: ({ vfs }) => async (args) => {
        for (const arg of args) {
            if (arg === '-L' || arg === '-P') {
                continue;
            }
            if (arg === '-h' || arg === '--help') {
                return { stdout: 'usage: pwd [-LP]', stderr: '', exitCode: 0 };
            }
            return { stdout: '', stderr: `pwd: invalid option -- '${arg.replace(/^-+/, '')}'`, exitCode: 1 };
        }
        return { stdout: vfs.cwd_get(), stderr: '', exitCode: 0 };
    }
};
