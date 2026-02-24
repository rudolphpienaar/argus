/**
 * @file CalypsoCore - DOM-Free AI Orchestrator
 *
 * The headless core of Calypso that can run in Node.js without a browser.
 * Receives natural language input, classifies intent, executes deterministic
 * operations against VFS/Store, and returns structured responses.
 *
 * @module
 * @see docs/calypso.adoc
 * @see docs/oracle.adoc
 */

import type { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import type { Shell } from '../vfs/Shell.js';
import type { FileNode } from '../vfs/types.js';
import { LCARSEngine } from './kernel/LCARSEngine.js';
import type {
    CalypsoResponse,
    CalypsoAction,
    CalypsoCoreConfig,
    CalypsoStoreActions,
    CalypsoIntent,
    PluginResult,
} from './types.js';
import { CalypsoStatusCode } from './types.js';
import type { AppState } from '../core/models/types.js';
import { ScriptRuntime } from './scripts/ScriptRuntime.js';
import { scripts_list } from './scripts/Catalog.js';
import { controlPlaneIntent_resolve } from './routing/ControlPlaneRouter.js';
import { SearchProvider } from './SearchProvider.js';
import { StatusProvider } from './kernel/StatusProvider.js';
import { LLMProvider } from './LLMProvider.js';
import { IntentParser } from './kernel/IntentParser.js';
import { PluginHost } from './PluginHost.js';
import { TelemetryBus } from './TelemetryBus.js';
import { MerkleEngine } from './MerkleEngine.js';
import { WorkflowAdapter, type WorkflowSummary } from '../dag/bridge/WorkflowAdapter.js';
import type { WorkflowPosition, DAGNode } from '../dag/graph/types.js';
import type { ArtifactEnvelope } from '../dag/store/types.js';
import { WorkflowSession, type CommandResolution } from '../dag/bridge/WorkflowSession.js';
import { CalypsoPresenter } from './CalypsoPresenter.js';
import { SettingsService } from '../config/settings.js';
import { SystemCommandRegistry, register_defaultHandlers } from './routing/SystemCommandRegistry.js';
import { WorkflowController } from './routing/WorkflowController.js';
import { SessionManager } from './SessionManager.js';
import { BootOrchestrator } from './BootOrchestrator.js';
import { IntentGuard, IntentGuardMode } from './kernel/IntentGuard.js';
import { CalypsoKernel, CalypsoOperationMode } from './kernel/CalypsoKernel.js';

interface ParsedCommandInput {
    trimmed: string;
    parts: string[];
    primary: string;
}

/**
 * DOM-free AI orchestrator for the ARGUS system.
 */
export class CalypsoCore {
    private engine: LCARSEngine | null;
    
    private searchProvider: SearchProvider;
    private statusProvider: StatusProvider;
    private llmProvider: LLMProvider;

    private storeActions: CalypsoStoreActions;
    private workflowAdapter: WorkflowAdapter;
    private sessionPath: string;
    private workflowSession: WorkflowSession;
    private scripts: ScriptRuntime;
    private intentParser: IntentParser;
    private pluginHost: PluginHost;
    private merkleEngine: MerkleEngine;
    private telemetryBus: TelemetryBus;
    private settingsService: SettingsService;
    private systemCommands: SystemCommandRegistry;
    private workflowController: WorkflowController;
    private sessionManager: SessionManager;
    private bootOrchestrator: BootOrchestrator;
    private intentGuard: IntentGuard;
    private kernel: CalypsoKernel;

    private readonly config: CalypsoCoreConfig;

    constructor(
        private vfs: VirtualFileSystem,
        private shell: Shell,
        storeActions: CalypsoStoreActions,
        config: CalypsoCoreConfig = {}
    ) {
        this.storeActions = storeActions;
        this.config = config;
        this.bag_assemble();
    }

    /**
     * Assemble the kernel dependency graph.
     */
    private bag_assemble(): void {
        // v11.0: Lazy-initialization of singletons to preserve state during refreshes
        this.telemetryBus = this.telemetryBus || this.config.telemetryBus || new TelemetryBus();
        this.settingsService = this.settingsService || this.config.settingsService || SettingsService.instance_get();
        this.systemCommands = this.systemCommands || new SystemCommandRegistry();
        this.workflowController = this.workflowController || new WorkflowController();

        this.searchProvider = new SearchProvider(this.vfs, this.shell, this.storeActions);

        const workflowId = this.workflowId_resolve(this.config);
        this.workflowAdapter = WorkflowAdapter.definition_load(workflowId);
        this.statusProvider = new StatusProvider(this.vfs, this.storeActions, this.workflowAdapter);

        if (this.config.llmConfig) {
            this.engine = new LCARSEngine(this.config.llmConfig, this.config.knowledge);
        } else {
            this.engine = this.engine || null;
        }

        const projectName = this.projectName_resolve(this.config.projectName);
        this.sessionPath = this.sessionPath_resolve(projectName);
        
        this.workflowSession = new WorkflowSession(this.vfs, this.workflowAdapter, this.sessionPath);

        const guardMode = (this.config.enableIntentGuardrails !== false) 
            ? IntentGuardMode.STRICT 
            : IntentGuardMode.EXPERIMENTAL;
        this.intentGuard = new IntentGuard({ mode: guardMode });

        const parserContext = {
            activeStageId_get: () => this.workflowSession.activeStageId_get(),
            stage_forCommand: (cmd: string) => this.workflowAdapter.stage_forCommand(cmd),
            commands_list: () => this.workflowAdapter.commandVerbs_list(),
            systemCommands_list: () => this.systemCommands.commands_list(),
            readyCommands_list: () => this.workflowAdapter.position_resolve(this.vfs, this.sessionPath).availableCommands,
            workflow_nextStep: () => this.workflow_nextStep(),
            workflow_dispatch: (i: string, r: CommandResolution, c: boolean) => this.workflow_dispatch(i, r, c),
            vfs: this.vfs,
            workflowAdapter: this.workflowAdapter,
            workflowSession: this.workflowSession
        };

        this.intentParser = new IntentParser(this.searchProvider, this.storeActions, this.intentGuard, parserContext);

        // v11.0: The Central Nervous System
        const kernelMode = (this.config.mode as CalypsoOperationMode) || CalypsoOperationMode.STRICT;
        this.kernel = new CalypsoKernel(
            this.engine,
            this.searchProvider,
            this.storeActions,
            parserContext,
            { mode: kernelMode }
        );

        this.pluginHost = new PluginHost(
            this.vfs, 
            this.shell, 
            this.storeActions, 
            this.searchProvider, 
            this.telemetryBus,
            this.workflowAdapter,
            this.sessionPath
        );

        this.merkleEngine = new MerkleEngine(this.vfs, this.workflowAdapter, this.sessionPath);

        this.scripts = new ScriptRuntime(
            this.storeActions,
            this.workflowAdapter,
            (cmd: string): Promise<CalypsoResponse> => this.command_execute(cmd)
        );

        // v11.0: Register default handlers ONLY ONCE
        if (this.systemCommands.commands_list().length === 0) {
            register_defaultHandlers(this.systemCommands);
        }

        this.sessionManager = new SessionManager({
            vfs: this.vfs,
            shell: this.shell,
            storeActions: this.storeActions,
            workflowSession: this.workflowSession,
            merkleEngine: this.merkleEngine,
            pluginHost: this.pluginHost
        });
        this.sessionManager.session_init(this.sessionPath);

        this.bootOrchestrator = new BootOrchestrator({
            vfs: this.vfs,
            shell: this.shell,
            storeActions: this.storeActions,
            workflowAdapter: this.workflowAdapter,
            workflowSession: this.workflowSession,
            telemetryBus: this.telemetryBus,
            sessionManager: this.sessionManager,
            adapter_update: (a) => { this.workflowAdapter = a; },
            session_update: (s) => { this.workflowSession = s; }
        });

        this.llmProvider = this.llmProvider_create();
    }

    // ─── Lifecycle & Boot ───────────────────────────────────────────────────

    public async boot(): Promise<void> {
        return await this.bootOrchestrator.boot();
    }

    /**
     * Set the active workflow persona and perform session genesis.
     * 
     * @param workflowId - The ID of the manifest to load.
     * @returns Success status.
     */
    public async workflow_set(workflowId: string | null): Promise<boolean> {
        const success = await this.bootOrchestrator.workflow_set(workflowId);
        if (success) {
            this.bag_assemble();
        }
        return success;
    }

    // ─── Command Execution ──────────────────────────────────────────────────

    /**
     * Primary command execution pipeline (v11.0 CNS-Driven).
     *
     * @param input - Raw user command line.
     * @returns Calypso Response.
     */
    public async command_execute(input: string): Promise<CalypsoResponse> {
        const parsed: ParsedCommandInput = this.commandInput_parse(input);
        if (!parsed.trimmed) {
            return this.response_create('', [], true, CalypsoStatusCode.OK);
        }

        await this.session_realign();
        await this.workflowSession.sync();

        // 1. SYSTEM COMMAND PRECEDENCE
        if (parsed.trimmed.startsWith('/')) {
            return await this.special_handle(parsed.trimmed);
        }

        // 2. CNS RESOLUTION (Intelligence Mediator)
        // The Kernel handles Guidance, FastPath, RAG, and LLM orchestration.
        const response = await this.kernel.resolve(parsed.trimmed, this.sessionPath);

        // 3. DISPATCH: Determine if the response contains a deterministic intent to execute
        if (response.message === '__DET_INTENT__') {
            const intent: CalypsoIntent = (response.state as any).intent;
            return await this.intent_dispatch(intent, parsed);
        }

        // 4. FALLBACK: Shell builtins
        // We only try shell if the kernel returned a conversational (LLM) intent.
        // If the kernel reported an ERROR (e.g. offline), we still try shell.
        const shellResult = await this.shell_handle(parsed.trimmed, parsed.primary);
        if (shellResult) return shellResult;

        await this.workflowSession.sync();
        return response;
    }

    /**
     * Dispatch a resolved intent to the appropriate internal handler.
     */
    private async intent_dispatch(intent: CalypsoIntent, parsed: ParsedCommandInput): Promise<CalypsoResponse> {
        if (intent.type === 'workflow') {
            const command: string = intent.command || parsed.primary;
            const protocolCommand: string = command + (intent.args?.length ? ' ' + intent.args.join(' ') : '');

            // 1. Strict Stage Resolution
            const strictResolution: CommandResolution = this.workflowSession.resolveCommand(command, true);
            if (strictResolution.stage) {
                const workflowResult: CalypsoResponse | null = await this.workflow_dispatch(protocolCommand, strictResolution);
                if (workflowResult) return workflowResult;
            }

            // 2. Global Fallback Resolution
            if (this.workflowFallback_allowed(protocolCommand, command)) {
                const globalResolution: CommandResolution = this.workflowSession.resolveCommand(command, false);
                if (globalResolution.stage) {
                    const workflowResult: CalypsoResponse | null = await this.workflow_dispatch(protocolCommand, globalResolution);
                    if (workflowResult) return workflowResult;
                }
            }
        }

        if (intent.type === 'shell') {
            const command: string = intent.command || parsed.primary;
            const protocolCommand: string = command + (intent.args?.length ? ' ' + intent.args.join(' ') : '');
            const shellResult: CalypsoResponse | null = await this.shell_handle(protocolCommand, command);
            if (shellResult) return shellResult;
        }

        if (intent.type === 'special') {
            const command: string = intent.command || parsed.primary;
            const protocolCommand: string = `/${command}${intent.args?.length ? ' ' + intent.args.join(' ') : ''}`;
            return await this.special_handle(protocolCommand);
        }

        if (intent.type === 'llm') {
            // Conversational intent passed back to the kernel loop
            return this.response_create(intent.raw, [], true, CalypsoStatusCode.CONVERSATIONAL);
        }

        return this.response_create(`>> ERROR: UNABLE TO DISPATCH INTENT [${intent.type}]`, [], false, CalypsoStatusCode.ERROR);
    }

    // ─── Public API ───────────────────────────────────────────────────────

    public prompt_get(): string {
        return this.shell.prompt_render();
    }

    public session_getPath(): string {
        return this.sessionManager.sessionPath_get();
    }

    public workflows_available(): WorkflowSummary[] {
        return WorkflowAdapter.workflows_summarize();
    }

    public vfs_exists(path: string): boolean {
        return this.vfs.node_stat(path) !== null;
    }

    public vfs_read(path: string): string | null {
        try {
            return this.vfs.node_read(path);
        } catch {
            return null;
        }
    }

    public version_get(): string {
        return this.statusProvider.version_get();
    }

    public workflow_getPosition(): WorkflowPosition {
        return this.workflowAdapter.position_resolve(this.vfs, this.session_getPath());
    }

    public store_snapshot(): Partial<AppState> {
        return this.storeActions.state_get();
    }

    public merkleEngine_latestFingerprint_get(stageId: string): ArtifactEnvelope | null {
        return this.workflowAdapter.latestArtifact_get(this.vfs, this.session_getPath(), stageId);
    }

    public async merkleEngine_dataDir_resolve(stageId: string): Promise<string> {
        return this.merkleEngine.dataDir_resolve(stageId);
    }

    public telemetry_subscribe(observer: (event: any) => void): () => void {
        return this.telemetryBus.subscribe(observer);
    }

    public tab_complete(line: string): string[] {
        const parts: string[] = line.split(/\s+/);
        const last: string = parts[parts.length - 1] || '';
        const isCommandPosition: boolean = parts.length <= 1 && !line.endsWith(' ');

        if (isCommandPosition) {
            const builtinCommands: string[] = this.shell.builtins_list();
            const workflowCommands: string[] = this.workflowAdapter.commandVerbs_list();
            const sessionCommands: string[] = ['quit', 'exit', 'dag', 'status'];
            const allCommands: string[] = Array.from(
                new Set<string>([...builtinCommands, ...workflowCommands, ...sessionCommands])
            );
            const commandPrefix: string = last.toLowerCase();
            return allCommands
                .filter((command: string): boolean => command.toLowerCase().startsWith(commandPrefix))
                .sort((left: string, right: string): number => left.localeCompare(right));
        }

        let dir: string = '.';
        let prefix: string = last;
        if (last.includes('/')) {
            const lastSlash: number = last.lastIndexOf('/');
            dir = last.substring(0, lastSlash) || '/';
            prefix = last.substring(lastSlash + 1);
        }
        try {
            const resolvedDir: string = this.vfs.path_resolve(dir);
            const children: FileNode[] = this.vfs.dir_list(resolvedDir);
            return children
                .filter((c: FileNode): boolean => c.name.toLowerCase().startsWith(prefix.toLowerCase()))
                .map((c: FileNode): string => {
                    const base: string = dir === '.' ? '' : (dir.endsWith('/') ? dir : dir + '/');
                    const suffix: string = c.type === 'folder' ? '/' : '';
                    return base + c.name + suffix;
                })
                .sort((left: string, right: string): number => left.localeCompare(right));
        } catch {
            return [];
        }
    }

    // ─── Pipeline Handlers ──────────────────────────────────────────────────

    private commandInput_parse(input: string): ParsedCommandInput {
        const trimmed: string = input.trim();
        const parts: string[] = trimmed.split(/\s+/);
        const primary: string = parts[0]?.toLowerCase() || '';
        return { trimmed, parts, primary };
    }

    private async special_handle(input: string): Promise<CalypsoResponse> {
        const result = await this.special_dispatch(input);
        if (result.message === '__GREET_ASYNC__') {
            const response: CalypsoResponse = await this.llmProvider.greeting_generate(this.username_resolve());
            response.statusCode = CalypsoStatusCode.CONVERSATIONAL;
            this.conversationalHints_apply(response);
            return response;
        }
        if (result.message === '__STANDBY_ASYNC__') {
            const response: CalypsoResponse = await this.llmProvider.standby_generate(this.username_resolve());
            response.statusCode = CalypsoStatusCode.CONVERSATIONAL;
            this.conversationalHints_apply(response);
            return response;
        }
        return result;
    }

    private async special_dispatch(input: string): Promise<CalypsoResponse> {
        const parts = input.slice(1).split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1);

        const context = {
            vfs: this.vfs,
            shell: this.shell,
            storeActions: this.storeActions,
            statusProvider: this.statusProvider,
            settingsService: this.settingsService,
            workflowAdapter: this.workflowAdapter,
            workflowSession: this.workflowSession,
            merkleEngine: this.merkleEngine,
            sessionPath: this.session_getPath(),
            activeProvider: (this.config.llmConfig as any)?.provider || null,
            activeModel: (this.config.llmConfig as any)?.model || null,
            engineAvailable: Boolean(this.engine),
            username_resolve: () => this.username_resolve(),
            session_realign: () => this.session_realign(),
            response_create: (m: string, a: CalypsoAction[], s: boolean, sc: CalypsoStatusCode, ui?: any) => this.response_create(m, a, s, sc, ui),
            key_register: (p: string, k: string) => this.key_register(p, k)
        };

        const result = await this.systemCommands.execute(cmd, args, context);
        if (result) {
            return result;
        }

        switch (cmd) {
            case 'greet': return this.response_create('__GREET_ASYNC__', [], true, CalypsoStatusCode.CONVERSATIONAL);
            case 'standby': return this.response_create('__STANDBY_ASYNC__', [], true, CalypsoStatusCode.CONVERSATIONAL);
            default: return this.response_create(`Unknown command: /${cmd}`, [], false, CalypsoStatusCode.ERROR);
        }
    }

    private async shell_handle(input: string, primary: string): Promise<CalypsoResponse | null> {
        const result = await this.shell.command_execute(input);
        if (result.exitCode === 127) return null;

        return this.response_create(
            result.stderr ? `${result.stdout}\n<error>${result.stderr}</error>` : result.stdout, 
            [], 
            result.exitCode === 0, 
            result.exitCode === 0 ? CalypsoStatusCode.OK : CalypsoStatusCode.ERROR,
            primary === 'python' ? { render_mode: 'training' } : undefined
        );
    }

    private async workflow_dispatch(input: string, resolution: CommandResolution, isConfirmed: boolean = false): Promise<CalypsoResponse | null> {
        const parts: string[] = input.split(/\s+/);
        const cmd: string = parts[0].toLowerCase();

        const transition: TransitionResult = this.workflowAdapter.transition_check(cmd, this.vfs, this.session_getPath());
        if (!transition.allowed) {
            if (transition.pendingOptionals?.length && transition.autoDeclinable) {
                for (const optionalId of transition.pendingOptionals) {
                    await this.merkleEngine.skipSentinel_materialize(optionalId, `Auto-declined: user proceeded to ${resolution.stage!.id}`);
                }
                await this.workflowSession.sync();
            } else {
                return this.response_create(CalypsoPresenter.workflowWarning_format(transition), [], false, CalypsoStatusCode.BLOCKED);
            }
        }

        if (resolution.requiresConfirmation && resolution.warning && !isConfirmed) {
            const state = this.storeActions.state_get();
            const expectedIntent = `CONFIRM_JUMP:${resolution.stage!.id}|${input}`;
            if (state.lastIntent !== expectedIntent) {
                this.storeActions.state_set({ lastIntent: expectedIntent });
                return this.response_create(`${CalypsoPresenter.info_format('PHASE JUMP DETECTED')}\n${resolution.warning}\n\nType 'confirm' to proceed.`, [], false, CalypsoStatusCode.BLOCKED);
            }
        }

        return await this.workflow_execute(input, resolution.stage!);
    }

    private async workflow_execute(input: string, stage: DAGNode): Promise<CalypsoResponse> {
        if (!stage.handler) return this.response_create(`>> ERROR: STAGE [${stage.id}] HAS NO HANDLER.`, [], false, CalypsoStatusCode.ERROR);

        const parts: string[] = input.split(/\s+/);
        const command: string = parts[0].toLowerCase();
        const args: string[] = parts.slice(1);

        await this.session_realign();
        const stageDir = await this.merkleEngine.dataDir_resolve(stage.id);

        let result: PluginResult;
        try {
            result = await this.pluginHost.plugin_execute(stage.handler, stage.parameters, command, args, stageDir, stage.id);
        } catch (e: any) {
            return this.response_create(`>> ERROR: ${e.message}`, [], false, CalypsoStatusCode.ERROR);
        }

        if (result.statusCode === CalypsoStatusCode.OK) {
            await this.session_realign();
            this.workflowAdapter.stage_complete(stage.id);
            
            await this.merkleEngine.artifact_materialize(stage.id, (result.artifactData as any) || { command: input, timestamp: new Date().toISOString() }, result.materialized, result.physicalDataDir);

            await this.session_realign();
            await this.workflowSession.sync();

            const viewportPath = this.workflowSession.viewportPath_get();
            if (viewportPath) {
                try { 
                    this.shell.cwd_set(viewportPath);
                    this.shell.boundary_set(viewportPath);
                } catch { /* ignore */ }
            }

            const isClosingCommand = command === stage.id;
            const hasAdvanceAction = result.actions?.some(a => a.type === 'stage_advance');

            if (isClosingCommand || hasAdvanceAction) {
                const pos = this.workflowAdapter.position_resolve(this.vfs, this.session_getPath());
                if (pos.currentStage && pos.currentStage.id !== stage.id) {
                    this.workflowSession.advance_force(pos.currentStage.id);
                    if (pos.currentStage.structural) return await this.workflow_execute(pos.currentStage.id, pos.currentStage);
                }
            }
        }

        return this.response_create(result.message, result.actions || [], result.statusCode === CalypsoStatusCode.OK, result.statusCode, result.ui_hints);
    }

    // ─── Internal Utilities ────────────────────────────────────────────────

    private async session_realign(): Promise<void> {
        return await this.sessionManager.session_realign();
    }

    private username_resolve(): string {
        return this.shell.env_get('USER') || 'user';
    }

    private workflow_nextStep(): string {
        const pos = this.workflowAdapter.position_resolve(this.vfs, this.session_getPath());
        if (pos.isComplete) return '● WORKFLOW COMPLETE.\n\nNext Steps:\n  `/reset` — Reset system to clean state';
        return pos.nextInstruction || 'Workflow complete.';
    }

    private response_create(message: string, actions: CalypsoAction[], success: boolean, statusCode: CalypsoStatusCode, ui_hints?: CalypsoResponse['ui_hints']): CalypsoResponse {
        return { message, actions, success, statusCode, ui_hints };
    }

    private conversationalHints_apply(response: CalypsoResponse): void {
        if (response.statusCode !== CalypsoStatusCode.CONVERSATIONAL) {
            return;
        }
        const username: string = this.username_resolve();
        const convoWidth: number = this.settingsService.convoWidth_resolve(username);
        response.ui_hints = {
            ...(response.ui_hints || {}),
            convo_width: convoWidth,
        };
    }

    private workflowFallback_allowed(protocolCommand: string, intentCommand: string): boolean {
        return intentCommand.toLowerCase() === 'proceed' || this.workflowAdapter.commandDeclared_isExplicit(protocolCommand);
    }

    private projectName_resolve(configuredProjectName?: string): string | null {
        const activeProject = this.storeActions.project_getActive();
        if (activeProject?.name) return activeProject.name;
        const configured = (configuredProjectName || '').trim();
        if (configured) return configured;
        const env = (this.shell.env_get('PROJECT') || '').trim();
        if (env) return env;
        return null;
    }

    private sessionPath_resolve(projectName: string | null): string {
        const username: string = this.username_resolve();
        const persona: string = this.shell.env_get('PERSONA') || 'fedml';
        const sessionId: string | null = this.storeActions.sessionId_get();
        if (sessionId) return `/home/${username}/projects/${persona}/${sessionId}/provenance`;
        return `/home/${username}/projects/${projectName || 'bootstrap'}/data`;
    }

    private workflowId_resolve(config: CalypsoCoreConfig): string {
        const configured: string = (config.workflowId || '').trim();
        if (configured) return configured;
        const env = (this.shell.env_get('PERSONA') || '').trim();
        if (env) return env;
        const available = WorkflowAdapter.workflows_list();
        if (available.length === 0) throw new Error('No workflows available.');
        return available[0];
    }

    private llmProvider_create(): LLMProvider {
        return new LLMProvider(
            this.engine,
            this.statusProvider,
            this.searchProvider,
            this.storeActions,
            this.intentParser,
            (
                message: string,
                actions: CalypsoAction[],
                success: boolean,
            ): CalypsoResponse => this.response_create(
                message,
                actions,
                success,
                success ? CalypsoStatusCode.OK : CalypsoStatusCode.ERROR,
            ),
            (command: string): Promise<CalypsoResponse> => this.command_execute(command),
            {
                status_emit: (message: string): void => {
                    this.telemetryBus.emit({ type: 'status', message });
                },
                log_emit: (message: string): void => {
                    this.telemetryBus.emit({ type: 'log', message });
                },
            },
        );
    }
}
