/**
 * @file Calypso Factory
 *
 * Wiring engine for the Calypso kernel. Assembles the complex dependency 
 * graph of services required by the domain-agnostic execution kernel.
 *
 * @module lcarslm/CalypsoFactory
 */

import type { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import type { Shell } from '../vfs/Shell.js';
import { LCARSEngine } from './engine.js';
import type { 
    CalypsoCoreConfig, 
    CalypsoStoreActions, 
    CalypsoResponse 
} from './types.js';
import { SearchProvider } from './SearchProvider.js';
import { StatusProvider } from './StatusProvider.js';
import { LLMProvider } from './LLMProvider.js';
import { IntentParser } from './routing/IntentParser.js';
import { PluginHost } from './PluginHost.js';
import { TelemetryBus } from './TelemetryBus.js';
import { MerkleEngine } from './MerkleEngine.js';
import { WorkflowAdapter } from '../dag/bridge/WorkflowAdapter.js';
import { WorkflowSession } from '../dag/bridge/WorkflowSession.js';
import { SettingsService } from '../config/settings.js';
import { ScriptRuntime } from './scripts/ScriptRuntime.js';
import { SystemCommandRegistry, register_defaultHandlers } from './routing/SystemCommandRegistry.js';
import { WorkflowController } from './routing/WorkflowController.js';
import { SessionManager } from './SessionManager.js';
import { BootOrchestrator } from './BootOrchestrator.js';

/**
 * Container for all pre-wired Calypso services.
 */
export interface CalypsoServiceBag {
    searchProvider: SearchProvider;
    statusProvider: StatusProvider;
    llmProvider: LLMProvider;
    workflowAdapter: WorkflowAdapter;
    workflowSession: WorkflowSession;
    scripts: ScriptRuntime;
    intentParser: IntentParser;
    pluginHost: PluginHost;
    merkleEngine: MerkleEngine;
    telemetryBus: TelemetryBus;
    settingsService: SettingsService;
    systemCommands: SystemCommandRegistry;
    workflowController: WorkflowController;
    sessionManager: SessionManager;
    bootOrchestrator: BootOrchestrator;
    sessionPath: string;
    engine: LCARSEngine | null;
}

/**
 * Assemble the kernel dependency graph.
 */
export async function calypso_assemble(
    vfs: VirtualFileSystem,
    shell: Shell,
    storeActions: CalypsoStoreActions,
    config: CalypsoCoreConfig,
    commandExecutor: (cmd: string) => Promise<CalypsoResponse>
): Promise<CalypsoServiceBag> {
    const telemetryBus = config.telemetryBus || new TelemetryBus();
    const settingsService = config.settingsService || SettingsService.instance_get();
    const searchProvider = new SearchProvider(vfs, shell, storeActions);

    const workflowId = workflowId_resolve(shell, config);
    const workflowAdapter = WorkflowAdapter.definition_load(workflowId);
    const statusProvider = new StatusProvider(vfs, storeActions, workflowAdapter);

    let engine: LCARSEngine | null = null;
    if (config.llmConfig) {
        engine = new LCARSEngine(config.llmConfig, config.knowledge);
    }

    const projectName = projectName_resolve(storeActions, shell, config.projectName);
    const sessionPath = sessionPath_resolve(storeActions, shell, projectName);
    
    const workflowSession = new WorkflowSession(vfs, workflowAdapter, sessionPath);

    const intentParser = new IntentParser(searchProvider, storeActions, {
        activeStageId_get: () => workflowSession.activeStageId_get(),
        stage_forCommand: (cmd) => workflowAdapter.stage_forCommand(cmd),
        commands_list: () => workflowAdapter.commandVerbs_list()
    });

    const pluginHost = new PluginHost(
        vfs, 
        shell, 
        storeActions, 
        searchProvider, 
        telemetryBus,
        workflowAdapter,
        sessionPath
    );

    const merkleEngine = new MerkleEngine(vfs, workflowAdapter, sessionPath);

    const scripts = new ScriptRuntime(
        storeActions,
        workflowAdapter,
        commandExecutor
    );

    const systemCommands = new SystemCommandRegistry();
    register_defaultHandlers(systemCommands);

    const workflowController = new WorkflowController();

    const sessionManager = new SessionManager({
        vfs,
        shell,
        storeActions,
        workflowSession,
        merkleEngine,
        pluginHost
    });
    sessionManager.session_init(sessionPath);

    const bootOrchestrator = new BootOrchestrator({
        vfs,
        shell,
        storeActions,
        workflowAdapter,
        workflowSession,
        telemetryBus,
        sessionManager,
        adapter_update: () => {}, // Handled by host instance
        session_update: () => {}  // Handled by host instance
    });

    const llmProvider = new LLMProvider(
        engine,
        statusProvider,
        searchProvider,
        storeActions,
        intentParser,
        (msg, act, succ) => ({ 
            message: msg, 
            actions: act, 
            success: succ, 
            statusCode: 0 // Placeholder
        } as any),
        commandExecutor,
        {
            status_emit: (m) => telemetryBus.emit({ type: 'status', message: m }),
            log_emit: (m) => telemetryBus.emit({ type: 'log', message: m })
        }
    );

    return {
        searchProvider,
        statusProvider,
        llmProvider,
        workflowAdapter,
        workflowSession,
        scripts,
        intentParser,
        pluginHost,
        merkleEngine,
        telemetryBus,
        settingsService,
        systemCommands,
        workflowController,
        sessionManager,
        bootOrchestrator,
        sessionPath,
        engine
    };
}

function workflowId_resolve(shell: Shell, config: CalypsoCoreConfig): string {
    const configured: string = (config.workflowId || '').trim();
    if (configured) return configured;
    const env = (shell.env_get('PERSONA') || '').trim();
    if (env) return env;
    const available = WorkflowAdapter.workflows_list();
    if (available.length === 0) throw new Error('No workflows available.');
    return available[0];
}

function projectName_resolve(store: CalypsoStoreActions, shell: Shell, configuredProjectName?: string): string | null {
    const activeProject = store.project_getActive();
    if (activeProject?.name) return activeProject.name;
    const configured = (configuredProjectName || '').trim();
    if (configured) return configured;
    const env = (shell.env_get('PROJECT') || '').trim();
    if (env) return env;
    return null;
}

function sessionPath_resolve(store: CalypsoStoreActions, shell: Shell, projectName: string | null): string {
    const username = shell.env_get('USER') || 'user';
    const persona = shell.env_get('PERSONA') || 'fedml';
    const sessionId = store.sessionId_get();
    if (sessionId) return `/home/${username}/projects/${persona}/${sessionId}/provenance`;
    return `/home/${username}/projects/${projectName || 'bootstrap'}/data`;
}
