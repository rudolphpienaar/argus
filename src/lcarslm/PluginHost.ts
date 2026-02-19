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
import type { PluginHandlerName } from '../plugins/registry.js';
import { pluginHandler_isKnown } from '../plugins/registry.js';
import { TelemetryBus } from './TelemetryBus.js';

/**
 * Contract for plugin modules dynamically loaded by the host.
 */
interface PluginModule {
    plugin_execute(context: PluginContext): Promise<PluginResult>;
}

const PLUGIN_MODULE_LOADERS: Record<PluginHandlerName, () => Promise<PluginModule>> = {
    search: async (): Promise<PluginModule> => import('../plugins/search.js'),
    gather: async (): Promise<PluginModule> => import('../plugins/gather.js'),
    rename: async (): Promise<PluginModule> => import('../plugins/rename.js'),
    harmonize: async (): Promise<PluginModule> => import('../plugins/harmonize.js'),
    scaffold: async (): Promise<PluginModule> => import('../plugins/scaffold.js'),
    train: async (): Promise<PluginModule> => import('../plugins/train.js'),
    federation: async (): Promise<PluginModule> => import('../plugins/federation.js'),
    publish: async (): Promise<PluginModule> => import('../plugins/publish.js'),
};

/**
 * Host environment for executing Argus plugins.
 */
export class PluginHost {
    constructor(
        private readonly vfs: VirtualFileSystem,
        private readonly shell: Shell,
        private readonly storeActions: CalypsoStoreActions,
        private readonly federation: FederationOrchestrator,
        private readonly telemetryBus: TelemetryBus
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
            const knownHandler: PluginHandlerName = this.handler_requireKnown(handlerName);
            const module: PluginModule = await this.module_load(knownHandler);
            const context: PluginContext = this.context_create(parameters, command, args);
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
     * Load a plugin module from the static registry.
     */
    private async module_load(handlerName: PluginHandlerName): Promise<PluginModule> {
        const loader: () => Promise<PluginModule> = PLUGIN_MODULE_LOADERS[handlerName];
        return loader();
    }

    /**
     * Construct the standard plugin execution context.
     */
    private context_create(
        parameters: Record<string, unknown>,
        command: string,
        args: string[],
    ): PluginContext {
        return {
            vfs: this.vfs,
            shell: this.shell,
            store: this.storeActions,
            federation: this.federation,
            ui: this.telemetryBus.context_create(),
            sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
            parameters,
            command,
            args,
        };
    }
}
