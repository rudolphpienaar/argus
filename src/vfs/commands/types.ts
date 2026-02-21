import type { VirtualFileSystem } from '../VirtualFileSystem.js';
import type { Shell } from '../Shell.js';
import type { ShellResult } from '../types.js';

export type BuiltinHandler = (args: string[], shell: Shell) => Promise<ShellResult>;

export interface BuiltinDeps {
    vfs: VirtualFileSystem;
    listCommands?: () => string[];
}

export interface BuiltinCommand {
    name: string;
    create: (deps: BuiltinDeps) => BuiltinHandler;
}
