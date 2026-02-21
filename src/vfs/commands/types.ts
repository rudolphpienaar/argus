import type { VirtualFileSystem } from '../VirtualFileSystem.js';
import type { Shell } from '../Shell.js';
import type { ShellResult } from '../types.js';

/**
 * Async builtin command handler signature.
 *
 * @param args - Raw CLI args passed to the builtin.
 * @param shell - Active shell instance.
 * @returns Shell command result payload.
 */
export type BuiltinHandler = (args: string[], shell: Shell) => Promise<ShellResult>;

/**
 * Shared dependency bag injected into builtin factories.
 */
export interface BuiltinDeps {
    vfs: VirtualFileSystem;
    listCommands?: () => string[];
}

/**
 * Declarative builtin descriptor consumed by the command registry.
 */
export interface BuiltinCommand {
    name: string;
    /**
     * Create a callable builtin handler bound to shared dependencies.
     *
     * @param deps - Shared dependency bag.
     * @returns Runnable builtin handler.
     */
    create: (deps: BuiltinDeps) => BuiltinHandler;
}
