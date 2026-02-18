/**
 * @file PluginHost - The Argus Plugin Virtual Machine
 *
 * Responsible for dynamically loading and executing idiosyncratic workflow
 * logic from the src/plugins/ directory.
 *
 * @module lcarslm/PluginHost
 */

import type { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import type { Shell } from '../vfs/Shell.js';
import type { CalypsoStoreActions, PluginContext, PluginResult } from './types.js';
import { CalypsoStatusCode } from './types.js';
import type { FederationOrchestrator } from './federation/FederationOrchestrator.js';

/**
 * Host environment for executing Argus plugins.
 */
export class PluginHost {
    constructor(
        private vfs: VirtualFileSystem,
        private shell: Shell,
        private storeActions: CalypsoStoreActions,
        private federation: FederationOrchestrator
    ) {}

    /**
     * Load and execute a plugin by handler name.
     *
     * @param handlerName - The name of the plugin module in src/plugins/.
     * @param parameters - Configuration parameters from the manifest.
     * @param command - The canonical command verb.
     * @param args - Command arguments.
     * @returns The result from the plugin execution.
     */
    public async plugin_execute(
        handlerName: string, 
        parameters: Record<string, unknown>,
        command: string,
        args: string[]
    ): Promise<PluginResult> {
        try {
            // 1. Resolve module path (relative to this file's compiled location)
            // Note: In ESM, we use relative paths for dynamic imports.
            const modulePath: string = `../plugins/${handlerName}.js`;
            
            // 2. Dynamic import
            const module: any = await import(modulePath);
            
            if (!module || typeof module.plugin_execute !== 'function') {
                throw new Error(`Module '${handlerName}' does not export plugin_execute()`);
            }

            // 3. Construct context (The Standard Library)
            const context: PluginContext = {
                vfs: this.vfs,
                shell: this.shell,
                store: this.storeActions,
                federation: this.federation,
                parameters,
                command,
                args
            };

            // 4. Execute
            return await module.plugin_execute(context);

        } catch (e: unknown) {
            const message: string = e instanceof Error ? e.message : String(e);
            return {
                message: `>> ERROR: PLUGIN EXECUTION FAILED [${handlerName}]: ${message}`,
                statusCode: CalypsoStatusCode.ERROR
            };
        }
    }
}
