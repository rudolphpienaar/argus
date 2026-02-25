/**
 * @file Plugin Host
 *
 * Execution environment for atomic workflow plugins.
 * Provides the standard library context (VM) to guest plugins.
 *
 * @module lcarslm/PluginHost
 */

import type { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import type { Shell } from '../vfs/Shell.js';
import type { CalypsoStoreActions } from './types.js';
import type { TelemetryBus } from './TelemetryBus.js';
import type { SearchProvider } from './SearchProvider.js';
import type { WorkflowAdapter } from '../dag/bridge/WorkflowAdapter.js';
import type {
    PluginContext,
    PluginResult,
    PluginModule,
    PluginComms
} from './types.js';
import { CalypsoStatusCode } from './types.js';
import { PluginCommsRuntime } from './PluginComms.js';

/**
 * Host for executing guest workflow plugins.
 */
export class PluginHost {
    private readonly comms: PluginComms;
    private sessionPath: string;

    constructor(
        private readonly vfs: VirtualFileSystem,
        private readonly shell: Shell,
        private readonly storeActions: CalypsoStoreActions,
        private readonly searchProvider: SearchProvider,
        private readonly telemetryBus: TelemetryBus,
        private readonly workflowAdapter: WorkflowAdapter,
        sessionPath: string
    ) {
        this.comms = new PluginCommsRuntime(this.searchProvider);
        this.sessionPath = sessionPath;
    }

    /**
     * Update the active session path.
     */
    public session_setPath(path: string): void {
        this.sessionPath = path;
    }

    /**
     * Execute a plugin handler with the provided parameters and command context.
     * 
     * @param handlerName - The name of the plugin module to load.
     * @param parameters - Configuration from the manifest.
     * @param command - The triggering protocol command.
     * @param args - Arguments passed to the command.
     * @param dataDir - Physical directory for materialization.
     * @param stageId - Unique identifier for the current workflow stage.
     * @returns Result of the plugin execution.
     */
    public async plugin_execute(
        handlerName: string,
        parameters: Record<string, unknown>,
        command: string,
        args: string[],
        dataDir: string,
        stageId: string
    ): Promise<PluginResult> {
        let plugin: PluginModule;
        try {
            plugin = await this.module_load(handlerName);
        } catch (e) {
            return {
                message: e instanceof Error ? e.message : `Unknown plugin handler '${handlerName}'`,
                statusCode: CalypsoStatusCode.ERROR
            };
        }
        const context: PluginContext = this.context_create(parameters, command, args, dataDir, stageId);

        return await plugin.plugin_execute(context);
    }

    /**
     * Load a plugin module dynamically.
     * 
     * @param handlerName - Module identifier.
     * @returns Loaded plugin module.
     */
    private async module_load(handlerName: string): Promise<PluginModule> {
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
        dataDir: string,
        stageId: string
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
            dataDir,
            stageId
        };
    }
}
