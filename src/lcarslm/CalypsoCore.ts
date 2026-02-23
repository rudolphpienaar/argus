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
import { LCARSEngine } from './engine.js';
import type {
    CalypsoResponse,
    CalypsoAction,
    CalypsoCoreConfig,
    CalypsoStoreActions,
    CalypsoIntent,
    PluginResult,
    BootPhase,
    BootStatus,
} from './types.js';
import { CalypsoStatusCode } from './types.js';
import type { AppState, Project } from '../core/models/types.js';
import { ScriptRuntime } from './scripts/ScriptRuntime.js';
import { scripts_list, type CalypsoScript } from './scripts/Catalog.js';
import { controlPlaneIntent_resolve, type ControlPlaneIntent } from './routing/ControlPlaneRouter.js';
import { SearchProvider } from './SearchProvider.js';
import { StatusProvider } from './StatusProvider.js';
import { LLMProvider } from './LLMProvider.js';
import { IntentParser } from './routing/IntentParser.js';
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
import { type CalypsoServiceBag } from './CalypsoFactory.js';

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

    private readonly config: CalypsoCoreConfig;

    constructor(
        private vfs: VirtualFileSystem,
        private shell: Shell,
        storeActions: CalypsoStoreActions,
        config: CalypsoCoreConfig = {}
    ) {
        this.storeActions = storeActions;
        this.config = config;
        
        // v11.0: Factory-driven assembly.
        const bag = this.bag_assemble();
        
        this.engine = bag.engine;
        this.searchProvider = bag.searchProvider;
        this.statusProvider = bag.statusProvider;
        this.workflowAdapter = bag.workflowAdapter;
        this.sessionPath = bag.sessionPath;
        this.workflowSession = bag.workflowSession;
        this.intentParser = bag.intentParser;
        this.llmProvider = bag.llmProvider;
        this.pluginHost = bag.pluginHost;
        this.merkleEngine = bag.merkleEngine;
        this.scripts = bag.scripts;
        this.systemCommands = bag.systemCommands;
        this.workflowController = bag.workflowController;
        this.sessionManager = bag.sessionManager;
        this.telemetryBus = bag.telemetryBus;
        this.settingsService = bag.settingsService;
        this.bootOrchestrator = bag.bootOrchestrator;

        // Re-bind lifecycle updates back to this instance
        (this.bootOrchestrator as any).ctx.adapter_update = (a: WorkflowAdapter) => { this.workflowAdapter = a; };
        (this.bootOrchestrator as any).ctx.session_update = (s: WorkflowSession) => { this.workflowSession = s; };
    }

    private bag_assemble(): CalypsoServiceBag {
        const telemetryBus = this.config.telemetryBus || new TelemetryBus();
        const settingsService = this.config.settingsService || SettingsService.instance_get();
        const searchProvider = new SearchProvider(this.vfs, this.shell, this.storeActions);

        const workflowId = this.workflowId_resolve(this.config);
        const workflowAdapter = WorkflowAdapter.definition_load(workflowId);
        const statusProvider = new StatusProvider(this.vfs, this.storeActions, workflowAdapter);

        let engine: LCARSEngine | null = null;
        if (this.config.llmConfig) {
            engine = new LCARSEngine(this.config.llmConfig, this.config.knowledge);
        }

        const projectName = this.projectName_resolve(this.config.projectName);
        const sessionPath = this.sessionPath_resolve(projectName);
        
        const workflowSession = new WorkflowSession(this.vfs, workflowAdapter, sessionPath);

        const systemCommands = new SystemCommandRegistry();
        register_defaultHandlers(systemCommands);
        
        const workflowController = new WorkflowController();

        const intentParser = new IntentParser(searchProvider, this.storeActions, {
            activeStageId_get: () => workflowSession.activeStageId_get(),
            stage_forCommand: (cmd) => workflowAdapter.stage_forCommand(cmd),
            commands_list: () => workflowAdapter.commandVerbs_list(),
            systemCommands_list: () => systemCommands.commands_list()
        });

        const pluginHost = new PluginHost(
            this.vfs, 
            this.shell, 
            this.storeActions, 
            searchProvider, 
            telemetryBus,
            workflowAdapter,
            sessionPath
        );

        const merkleEngine = new MerkleEngine(this.vfs, workflowAdapter, sessionPath);

        const scripts = new ScriptRuntime(
            this.storeActions,
            workflowAdapter,
            (cmd: string): Promise<CalypsoResponse> => this.command_execute(cmd)
        );

        const sessionManager = new SessionManager({
            vfs: this.vfs,
            shell: this.shell,
            storeActions: this.storeActions,
            workflowSession,
            merkleEngine,
            pluginHost
        });
        sessionManager.session_init(sessionPath);

        const bootOrchestrator = new BootOrchestrator({
            vfs: this.vfs,
            shell: this.shell,
            storeActions: this.storeActions,
            workflowAdapter,
            workflowSession,
            telemetryBus,
            sessionManager,
            adapter_update: () => {}, 
            session_update: () => {}
        });

        const llmProvider = new LLMProvider(
            engine,
            statusProvider,
            searchProvider,
            this.storeActions,
            intentParser,
            (msg, act, succ) => this.response_create(msg, act, succ, succ ? CalypsoStatusCode.OK : CalypsoStatusCode.ERROR),
            (cmd) => this.command_execute(cmd),
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
        return await this.bootOrchestrator.workflow_set(workflowId);
    }

    // ─── Command Execution ──────────────────────────────────────────────────

    /**
     * Primary command execution pipeline (v10.0 Interpretation-First).
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

        if (this.shell.isBuiltin(parsed.primary)) {
            const shellResult: CalypsoResponse | null = await this.shell_handle(parsed.trimmed, parsed.primary);
            if (shellResult) return shellResult;
        }

        const confirmationFastPath: CalypsoResponse | null = await this.workflowController.confirmation_dispatch(
            parsed.trimmed, 
            this.workflowControllerContext_create()
        );
        if (confirmationFastPath) {
            return confirmationFastPath;
        }

        const intent: CalypsoIntent = await this.intentParser.intent_resolve(parsed.trimmed, this.engine);

        if (intent.type === 'workflow' && intent.command) {
            const protocolCommand: string = intent.command + (intent.args?.length ? ' ' + intent.args.join(' ') : '');

            const strictResolution: CommandResolution = this.workflowSession.resolveCommand(intent.command, true);
            if (strictResolution.stage) {
                const workflowResult: CalypsoResponse | null = await this.workflow_dispatch(protocolCommand, strictResolution);
                if (workflowResult) return workflowResult;
            }

            if (this.workflowFallback_allowed(protocolCommand, intent.command)) {
                const globalResolution: CommandResolution = this.workflowSession.resolveCommand(protocolCommand, false);
                if (globalResolution.stage) {
                    const workflowResult: CalypsoResponse | null = await this.workflow_dispatch(protocolCommand, globalResolution);
                    if (workflowResult) return workflowResult;
                }
            }
        }

        if (intent.type === 'shell' && intent.command) {
            const protocolCommand: string = intent.command + (intent.args?.length ? ' ' + intent.args.join(' ') : '');
            const shellResult: CalypsoResponse | null = await this.shell_handle(protocolCommand, intent.command);
            if (shellResult) return shellResult;
        }

        if (intent.type === 'special' && intent.command) {
            const protocolCommand: string = `/${intent.command}${intent.args?.length ? ' ' + intent.args.join(' ') : ''}`;
            return await this.special_handle(protocolCommand);
        }

        const resolution = this.workflowSession.resolveCommand(parsed.primary, false);
        const fastPathResult: CalypsoResponse | null = await this.commandFastPath_handle(parsed, resolution);
        if (fastPathResult) return fastPathResult;

        const guidance: CalypsoResponse | null = this.workflowController.guidance_handle(
            parsed.trimmed, 
            this.workflowControllerContext_create()
        );
        if (guidance) return guidance;

        const response: CalypsoResponse = await this.llmProvider.query(parsed.trimmed, this.session_getPath());
        response.statusCode = CalypsoStatusCode.CONVERSATIONAL;
        this.conversationalHints_apply(response);

        await this.workflowSession.sync();

        return response;
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
            const sessionCommands: string[] = ['quit', 'exit', 'dag'];
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

    private async commandFastPath_handle(
        parsed: ParsedCommandInput,
        resolution: CommandResolution,
    ): Promise<CalypsoResponse | null> {
        const { trimmed, parts, primary } = parsed;
        const scriptPrompt: CalypsoResponse | null = await this.scripts.maybeConsumeInput(trimmed);
        if (scriptPrompt) {
            return scriptPrompt;
        }

        const isWorkflowCommand: boolean = resolution.stage !== null && !resolution.isJump;
        if (
            trimmed.startsWith('/') ||
            primary === 'reset' ||
            primary === 'help' ||
            primary === 'settings' ||
            primary === 'dag' ||
            (primary === 'status' && !isWorkflowCommand)
        ) {
            const normalized: string = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
            const normalizedParts: string[] = normalized.slice(1).split(/\s+/);
            const commandName: string = normalizedParts[0].toLowerCase();
            if (commandName !== 'run' && commandName !== 'scripts') {
                return this.special_handle(normalized);
            }
        }

        if (primary === 'scripts' || primary === '/scripts') {
            const args: string[] = trimmed.startsWith('/') ? trimmed.split(/\s+/).slice(1) : parts.slice(1);
            return this.scripts.scripts_response(args);
        }
        if (primary === 'run' || primary === '/run') {
            const args: string[] = trimmed.startsWith('/') ? trimmed.split(/\s+/).slice(1) : parts.slice(1);
            return this.scripts.script_execute(args);
        }

        const controlResult: CalypsoResponse | null = await this.control_handle(trimmed);
        if (controlResult) return controlResult;

        const confirmation: CalypsoResponse | null = await this.workflowController.confirmation_dispatch(
            trimmed, 
            this.workflowControllerContext_create()
        );
        if (confirmation) return confirmation;

        return await this.shell_handle(trimmed, primary);
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

    private async control_handle(input: string): Promise<CalypsoResponse | null> {
        const scriptRefs = scripts_list().map(s => ({ id: s.id, aliases: s.aliases }));
        const intent = controlPlaneIntent_resolve(input, scriptRefs);
        if (intent.plane !== 'control') return null;
        if (intent.action === 'scripts_list') return this.scripts.scripts_response([]);
        if (intent.action === 'script_run') return await this.scripts.script_execute([intent.scriptRef]);
        if (intent.action === 'script_show') return this.scripts.scripts_response([intent.scriptRef]);
        return null;
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

    private workflowControllerContext_create(): any {
        return {
            vfs: this.vfs,
            storeActions: this.storeActions,
            workflowAdapter: this.workflowAdapter,
            workflowSession: this.workflowSession,
            sessionPath: this.session_getPath(),
            response_create: (m: string, a: CalypsoAction[], s: boolean, sc: CalypsoStatusCode) => this.response_create(m, a, s, sc),
            workflow_nextStep: () => this.workflow_nextStep(),
            workflow_dispatch: (i: string, r: CommandResolution, c: boolean) => this.workflow_dispatch(i, r, c)
        };
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
