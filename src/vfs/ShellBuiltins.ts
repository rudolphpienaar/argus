/**
 * @file Shell Builtins
 *
 * Thin registry wrapper for modularized shell command implementations.
 *
 * @module vfs/builtins
 */

import type { VirtualFileSystem } from './VirtualFileSystem.js';
import { registry_create } from './commands/index.js';
import type { BuiltinHandler } from './commands/types.js';

export type { BuiltinHandler } from './commands/types.js';

export class ShellBuiltins {
    public readonly REGISTRY: Record<string, BuiltinHandler>;

    constructor(vfs: VirtualFileSystem) {
        const registry: Record<string, BuiltinHandler> = {};
        const builtins = registry_create({
            vfs,
            listCommands: (): string[] => Object.keys(registry)
        });
        Object.assign(registry, builtins);
        this.REGISTRY = registry;
    }
}
