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
import type { PluginHandlerName } from '../plugins/registry.js';
import { pluginHandler_isKnown } from '../plugins/registry.js';
import { TelemetryBus } from './TelemetryBus.js';
import { PluginCommsRuntime } from './PluginComms.js';

/**
 * Contract for plugin modules dynamically loaded by the host.
 */
interface PluginModule {
    plugin_execute(context: PluginContext): Promise<PluginResult>;
}

import type { SearchProvider } from './SearchProvider.js';

/**
 * Host environment for executing Argus plugins.
 */
export class PluginHost {
    private readonly comms: PluginCommsRuntime;

    constructor(
        private readonly vfs: VirtualFileSystem,
        private readonly shell: Shell,
        private readonly storeActions: CalypsoStoreActions,
        private readonly searchProvider: SearchProvider,
        private readonly telemetryBus: TelemetryBus
    ) {
        this.comms = new PluginCommsRuntime(this.searchProvider);
    }

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
        args: string[],
        dataDir: string
    ): Promise<PluginResult> {
        try {
            const knownHandler: PluginHandlerName = this.handler_requireKnown(handlerName);
            const module: PluginModule = await this.module_load(knownHandler);
            const context: PluginContext = this.context_create(parameters, command, args, dataDir);
            return await module.plugin_execute(context);

        } catch (e: unknown) {
            const message: string = e instanceof Error ? e.message : String(e);
            return {
                message: `>> ERROR: PLUGIN EXECUTION FAILED [${handlerName}]: ${message}`,
                statusCode: CalypsoStatusCode.ERROR
            };
        }
    }

    /**
     * Validate and normalize handler names before module load.
     */
    private handler_requireKnown(handlerName: string): PluginHandlerName {
        const normalizedHandler: string = handlerName.trim();
        if (!pluginHandler_isKnown(normalizedHandler)) {
            throw new Error(`Unknown plugin handler '${handlerName}'`);
        }
        return normalizedHandler;
    }

    /**
     * Load a plugin module from the plugin directory by handler convention.
     */
    private async module_load(handlerName: PluginHandlerName): Promise<PluginModule> {
        const moduleSpecifier: string = `../plugins/${handlerName}.js`;
        let module: unknown;
        try {
            module = await import(moduleSpecifier);
        } catch {
            throw new Error(`Unknown plugin handler '${handlerName}'`);
        }
        const pluginModule: Partial<PluginModule> = module as Partial<PluginModule>;

        if (typeof pluginModule.plugin_execute !== 'function') {
            throw new Error(`Plugin handler '${handlerName}' does not export plugin_execute`);
        }

        return pluginModule as PluginModule;
    }

    /**
     * Construct the standard plugin execution context.
     */
    private context_create(
        parameters: Record<string, unknown>,
        command: string,
        args: string[],
        dataDir: string
    ): PluginContext {
        return {
            vfs: this.vfs,
            shell: this.shell,
            search: this.searchProvider,
            comms: this.comms,
            store: this.storeActions,
            ui: this.telemetryBus.context_create(),
            parameters,
            command,
            args,
            dataDir
        };
    }
}
