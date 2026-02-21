import type { BuiltinCommand } from './types.js';

export const command: BuiltinCommand = {
    name: 'help',
    create: ({ listCommands }) => async () => {
        const commands: string = (listCommands ? listCommands() : []).sort().join(', ');
        return { stdout: `Available commands: ${commands}`, stderr: '', exitCode: 0 };
    }
};
