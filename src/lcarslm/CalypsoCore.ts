/**
 * @file CalypsoCore - DOM-Free AI Orchestrator
 *
 * The headless core of Calypso that can run in Node.js without a browser.
 * Receives natural language input, classifies intent, executes deterministic
 * operations against VFS/Store, and returns structured responses.
 *
 * This module has ZERO DOM dependencies. All UI operations are delegated
 * to adapters via CalypsoAction objects in the response.
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
    VfsSnapshotNode,
    QueryResponse,
    CalypsoIntent,
    PluginResult
} from './types.js';
import { CalypsoStatusCode } from './types.js';
import type { Dataset, AppState, Project } from '../core/models/types.js';
import { FederationOrchestrator } from './federation/FederationOrchestrator.js';
import { ScriptRuntime } from './scripts/ScriptRuntime.js';
import { SearchProvider } from './SearchProvider.js';
import { StatusProvider } from './StatusProvider.js';
import { LLMProvider } from './LLMProvider.js';
import { IntentParser } from './routing/IntentParser.js';
import { PluginHost } from './PluginHost.js';
import { MerkleEngine, type RuntimeMaterializationMode } from './MerkleEngine.js';
import { vfs_snapshot } from './utils/VfsUtils.js';
import { fingerprint_compute } from '../dag/fingerprint/hasher.js';
import type { FingerprintRecord } from '../dag/fingerprint/types.js';
import { DATASETS } from '../core/data/datasets.js';
import { MOCK_PROJECTS } from '../core/data/projects.js';
import { project_gather, project_rename } from '../core/logic/ProjectManager.js';
import { CalypsoPresenter } from './CalypsoPresenter.js';
import { scripts_list, type CalypsoScript } from './scripts/Catalog.js';
import { controlPlaneIntent_resolve, type ControlPlaneIntent } from './routing/ControlPlaneRouter.js';
import { WorkflowAdapter } from '../dag/bridge/WorkflowAdapter.js';
import type { TransitionResult, WorkflowSummary } from '../dag/bridge/WorkflowAdapter.js';
import type { WorkflowPosition, DAGNode, StageParameters } from '../dag/graph/types.js';
import type { ArtifactEnvelope } from '../dag/store/types.js';
import type { StagePath } from '../dag/bridge/SessionPaths.js';
import { WorkflowSession, type CommandResolution } from '../dag/bridge/WorkflowSession.js';

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
    private simulationMode: boolean;
    private knowledge: Record<string, string> | undefined;
    private activeProvider: 'openai' | 'gemini' | null = null;
    private activeModel: string | null = null;

    /** Providers for logic delegation. */
    private searchProvider: SearchProvider;
    private statusProvider: StatusProvider;
    private llmProvider: LLMProvider;

    private storeActions: CalypsoStoreActions;
    private workflowAdapter: WorkflowAdapter;
    private sessionPath: string;
    private workflowSession: WorkflowSession;
    private federation: FederationOrchestrator;
    private scripts: ScriptRuntime;
    private intentParser: IntentParser;
    private pluginHost: PluginHost;
    private merkleEngine: MerkleEngine;

    constructor(
        private vfs: VirtualFileSystem,
        private shell: Shell,
        storeActions: CalypsoStoreActions,
        config: CalypsoCoreConfig = {}
    ) {
        this.storeActions = storeActions;
        this.simulationMode = config.simulationMode ?? false;
        this.knowledge = config.knowledge;

        this.searchProvider = new SearchProvider(vfs, shell);
        this.intentParser = new IntentParser(this.searchProvider, storeActions);

        const workflowId: string = config.workflowId ?? 'fedml';
        this.workflowAdapter = WorkflowAdapter.definition_load(workflowId);
        this.statusProvider = new StatusProvider(vfs, storeActions, this.workflowAdapter);

        if (config.llmConfig) {
            this.engine = new LCARSEngine(config.llmConfig, config.knowledge, this.simulationMode);
            this.activeProvider = config.llmConfig.provider;
            this.activeModel = config.llmConfig.model;
        } else {
            this.engine = null;
        }

        this.llmProvider = this.llmProvider_create();

        const username: string = shell.env_get('USER') || 'user';
        const sessionId: string = `session-${Date.now()}`;
        this.sessionPath = `/home/${username}/sessions/${workflowId}/${sessionId}`;
        
        this.workflowSession = new WorkflowSession(vfs, this.workflowAdapter, this.sessionPath);
        this.federation = new FederationOrchestrator(vfs, storeActions);
        this.pluginHost = new PluginHost(vfs, shell, storeActions, this.federation);
        this.merkleEngine = new MerkleEngine(
            vfs,
            this.workflowAdapter,
            this.sessionPath,
            {
                runtimeMode: this.runtimeMaterialization_resolve(config),
                joinMaterializationEnabled: this.runtimeJoinMaterialization_resolve(config),
            },
        );

        const fedPath: StagePath | undefined = this.workflowAdapter.stagePaths.get('federate-brief');
        if (fedPath) {
            this.federation.session_set(`${this.sessionPath}/${fedPath.artifactFile}`);
        }

        this.scripts = new ScriptRuntime(
            storeActions,
            (cmd: string): Promise<CalypsoResponse> => this.command_execute(cmd),
            (): Dataset[] => this.searchProvider.lastMentioned_get(),
        );
    }

    /**
     * Primary command execution pipeline (v10.0 Interpretation-First).
     *
     * 1. Fast-Path (Shell/Special): Low-latency UI/System actions.
     * 2. Intent Resolution: Compile noisy NL into deterministic protocol.
     * 3. Action Execution: Dispatch protocol command to plugin host.
     * 4. LLM Fallback: Conversational guidance and explanation.
     *
     * @param input - Raw natural language or protocol command.
     * @returns Structured response for adapters.
     */
    public async command_execute(input: string): Promise<CalypsoResponse> {
        const parsed: ParsedCommandInput = this.commandInput_parse(input);
        if (!parsed.trimmed) {
            return this.response_create('', [], true, CalypsoStatusCode.OK);
        }

        await this.workflowSession.sync();
        const resolution: CommandResolution = this.workflowSession.resolveCommand(parsed.trimmed);

        const fastPathResult: CalypsoResponse | null = await this.commandFastPath_handle(parsed, resolution);
        if (fastPathResult) {
            return fastPathResult;
        }

        // ─── 2. INTENT RESOLUTION (The Compiler) ───────────────────────────

        const intent: CalypsoIntent = await this.intentParser.intent_resolve(parsed.trimmed, this.engine);

        // ─── 3. ACTION EXECUTION (The Runtime) ─────────────────────────────

        if (intent.type === 'workflow' && intent.command) {
            const finalResolution: CommandResolution = this.workflowResolution_resolve(
                intent.command,
                parsed.primary,
                resolution,
            );

            if (finalResolution.stage) {
                const protocolCommand: string = intent.command + (intent.args?.length ? ' ' + intent.args.join(' ') : '');
                const workflowResult: CalypsoResponse | null = await this.workflow_dispatch(protocolCommand, finalResolution);
                if (workflowResult) return workflowResult;
            }
        }

        // ─── 4. LLM FALLBACK (The Communicator) ────────────────────────────

        // Interrogative guidance (what's next?)
        const guidance: CalypsoResponse | null = this.guidance_handle(parsed.trimmed);
        if (guidance) return guidance;

        // Conversational query
        const response: CalypsoResponse = await this.llmProvider.query(parsed.trimmed, this.sessionPath);
        response.statusCode = CalypsoStatusCode.CONVERSATIONAL;
        return response;
    }

    // ─── Public API (Restored for Adapters) ───────────────────────────────

    public prompt_get(): string {
        return this.shell.prompt_render();
    }

    public session_getPath(): string {
        return this.sessionPath;
    }

    public workflow_set(workflowId: string | null): boolean {
        if (!workflowId) return false;
        try {
            this.workflowAdapter = WorkflowAdapter.definition_load(workflowId);
            this.workflowSession = new WorkflowSession(this.vfs, this.workflowAdapter, this.sessionPath);
            return true;
        } catch {
            return false;
        }
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
        return this.workflowAdapter.position_resolve(this.vfs, this.sessionPath);
    }

    public store_snapshot(): Partial<AppState> {
        return this.storeActions.state_get();
    }

    /**
     * Resolve tab completion candidates for a partial line.
     */
    public tab_complete(line: string): string[] {
        const parts = line.split(/\s+/);
        const last = parts[parts.length - 1] || '';
        
        // Resolve directory and name prefix
        let dir = '.';
        let prefix = last;
        
        if (last.includes('/')) {
            const lastSlash = last.lastIndexOf('/');
            dir = last.substring(0, lastSlash) || '/';
            prefix = last.substring(lastSlash + 1);
        }

        try {
            const resolvedDir = this.vfs.path_resolve(dir);
            const children = this.vfs.dir_list(resolvedDir);
            
            return children
                .filter((c: FileNode): boolean => c.name.toLowerCase().startsWith(prefix.toLowerCase()))
                .map((c: FileNode): string => {
                    const base = dir === '.' ? '' : (dir.endsWith('/') ? dir : dir + '/');
                    const suffix = c.type === 'folder' ? '/' : '';
                    return base + c.name + suffix;
                });
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

    private workflowResolution_resolve(
        intentCommand: string,
        primary: string,
        currentResolution: CommandResolution,
    ): CommandResolution {
        if (intentCommand === primary) {
            return currentResolution;
        }
        return this.workflowSession.resolveCommand(intentCommand);
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
        if (trimmed.startsWith('/') || primary === 'reset' || primary === 'help' || (primary === 'status' && !isWorkflowCommand)) {
            const normalized: string = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
            const normalizedParts: string[] = normalized.slice(1).split(/\s+/);
            const commandName: string = normalizedParts[0].toLowerCase();
            if (commandName !== 'run' && commandName !== 'scripts') {
                return this.special_handle(normalized);
            }
        }

        if (primary === 'scripts' || primary === '/scripts') {
            const args: string[] = trimmed.startsWith('/')
                ? trimmed.split(/\s+/).slice(1)
                : parts.slice(1);
            return this.scripts.scripts_response(args);
        }
        if (primary === 'run' || primary === '/run') {
            const args: string[] = trimmed.startsWith('/')
                ? trimmed.split(/\s+/).slice(1)
                : parts.slice(1);
            return this.scripts.script_execute(args);
        }

        const controlResult: CalypsoResponse | null = await this.control_handle(trimmed);
        if (controlResult) {
            return controlResult;
        }

        const confirmation: CalypsoResponse | null = await this.confirmation_dispatch(trimmed);
        if (confirmation) {
            return confirmation;
        }

        const shellResult: CalypsoResponse | null = await this.shell_handle(trimmed, primary);
        return shellResult;
    }

    private async special_handle(input: string): Promise<CalypsoResponse> {
        const result = await this.special_dispatch(input);
        if (result.message === '__GREET_ASYNC__') {
            return this.llmProvider.greeting_generate(this.shell.env_get('USER') || 'user');
        }
        if (result.message === '__STANDBY_ASYNC__') {
            return this.llmProvider.standby_generate(this.shell.env_get('USER') || 'user');
        }
        return result;
    }

    private async special_dispatch(input: string): Promise<CalypsoResponse> {
        const parts = input.slice(1).split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1);

        switch (cmd) {
            case 'snapshot':
                const snap: VfsSnapshotNode | null = vfs_snapshot(this.vfs, args[0] || '/', true);
                return snap ? this.response_create(JSON.stringify(snap, null, 2), [], true, CalypsoStatusCode.OK) 
                            : this.response_create(`Path not found: ${args[0]}`, [], false, CalypsoStatusCode.ERROR);
            case 'state':
                return this.response_create(JSON.stringify(this.store_snapshot(), null, 2), [], true, CalypsoStatusCode.OK);
            case 'reset':
                this.reset();
                return this.response_create('System reset to clean state.', [], true, CalypsoStatusCode.OK);
            case 'version':
                return this.response_create(this.version_get(), [], true, CalypsoStatusCode.OK);
            case 'status':
                return this.response_create(this.statusProvider.status_generate(this.simulationMode, this.activeProvider, this.activeModel), [], true, CalypsoStatusCode.OK);
            case 'key':
                return this.key_register(args[0], args[1]);
            case 'workflows': {
                const workflows: WorkflowSummary[] = this.workflows_available();
                const progress: string = workflows.map((w: WorkflowSummary): string => `○ [${w.id}] ${w.name}: ${w.description}`).join('\n');
                return this.response_create(progress, [], true, CalypsoStatusCode.OK);
            }
            case 'scripts':
                return this.scripts.scripts_response(args);
            case 'help':
                return this.response_create(this.help_format(), [], true, CalypsoStatusCode.OK);
            case 'greet': return this.response_create('__GREET_ASYNC__', [], true, CalypsoStatusCode.CONVERSATIONAL);
            case 'standby': return this.response_create('__STANDBY_ASYNC__', [], true, CalypsoStatusCode.CONVERSATIONAL);
            default: return this.response_create(`Unknown command: /${cmd}`, [], false, CalypsoStatusCode.ERROR);
        }
    }

    private async control_handle(input: string): Promise<CalypsoResponse | null> {
        const scriptRefs: Array<{ id: string; aliases: string[] }> = scripts_list().map(
            (s: CalypsoScript): { id: string; aliases: string[] } => ({ id: s.id, aliases: s.aliases }),
        );
        const intent: ControlPlaneIntent = controlPlaneIntent_resolve(input, scriptRefs);
        return await this.controlIntent_dispatch(intent);
    }

    private async shell_handle(input: string, primary: string): Promise<CalypsoResponse | null> {
        const result = await this.shell.command_execute(input);
        if (result.exitCode === 127) return null;

        if (result.exitCode === 0 && primary === 'python') {
            const trimmedInput: string = input.trim();
            const resolution: CommandResolution = this.workflowSession.resolveCommand(trimmedInput);
            if (resolution.stage) {
                this.workflowAdapter.stage_complete(resolution.stage.id);
                await this.merkleEngine.artifact_materialize(resolution.stage.id, {
                    command: trimmedInput,
                    args: trimmedInput.split(/\s+/).slice(1),
                    timestamp: new Date().toISOString(),
                    result: true
                });
                
                const pos: WorkflowPosition = this.workflowAdapter.position_resolve(this.vfs, this.sessionPath);
                if (pos.currentStage) {
                    this.workflowSession.advance_force(pos.currentStage.id);
                }
            }
        }
        return this.response_create(result.stderr ? `${result.stdout}\n<error>${result.stderr}</error>` : result.stdout, [], result.exitCode === 0, result.exitCode === 0 ? CalypsoStatusCode.OK : CalypsoStatusCode.ERROR);
    }

    private guidance_handle(input: string): CalypsoResponse | null {
        const patterns: RegExp[] = [/^what('?s| is| should be)?\s*(the\s+)?next/i, /^next\??$/i, /^how\s+do\s+i\s+(proceed|continue|start)/i, /status/i, /progress/i];
        return patterns.some((p: RegExp): boolean => p.test(input)) ? this.response_create(this.workflow_nextStep(), [], true, CalypsoStatusCode.OK) : null;
    }

    // ─── Workflow Handlers ──────────────────────────────────────────────────

    /**
     * Resolve and dispatch a workflow command.
     *
     * Handles phase jump confirmations and DAG transition checks before
     * delegating to the execution engine.
     *
     * @param input - The raw command string.
     * @param resolution - The contextual command resolution from the session.
     * @param isConfirmed - Whether this is a post-confirmation execution.
     * @returns Structured response or null if command not handled.
     */
    private async workflow_dispatch(input: string, resolution: CommandResolution, isConfirmed: boolean = false): Promise<CalypsoResponse | null> {
        const parts: string[] = input.split(/\s+/);
        const cmd: string = parts[0].toLowerCase();

        // 1. Gatekeeper Check (Prerequisites & Skip Warnings)
        // We always check transition readiness first.
        const transition: TransitionResult = this.workflow_checkTransition(cmd);
        if (!transition.allowed) {
            if (transition.staleBlock) {
                return this.response_create(
                    CalypsoPresenter.workflowWarning_format(transition),
                    [],
                    false,
                    CalypsoStatusCode.BLOCKED_STALE,
                );
            }
            if (transition.skippedStageId) {
                this.workflowAdapter.skip_increment(transition.skippedStageId);
                return this.response_create(CalypsoPresenter.workflowWarning_format(transition), [], false, CalypsoStatusCode.BLOCKED);
            }
            return this.response_create(CalypsoPresenter.error_format(transition.warning!), [], false, CalypsoStatusCode.BLOCKED);
        }

        // 2. Phase Jump Confirmation
        if (!isConfirmed && resolution.requiresConfirmation && resolution.warning) {
            const state: Partial<AppState> = this.storeActions.state_get();
            const expectedIntent: string = `CONFIRM_JUMP:${resolution.stage!.id}|${input}`;
            
            if (state.lastIntent !== expectedIntent) {
                const jumpIntentState: Partial<AppState> = { lastIntent: expectedIntent };
                this.storeActions.state_set(jumpIntentState);
                return this.response_create(`${CalypsoPresenter.info_format('PHASE JUMP DETECTED')}\n${resolution.warning}\n\nType 'confirm' to proceed.`, [], false, CalypsoStatusCode.BLOCKED);
            }
        }

        // 3. Dispatch to Execution
        return await this.workflow_execute(input, resolution.stage!);
    }

    /**
     * Execute a workflow stage via the Plugin Host.
     *
     * Coordinates the execution of idiosyncratic logic, updates session state,
     * and materializes Merkle-proven artifacts on success.
     *
     * @param input - The original command string.
     * @param stage - The DAG node representing the target stage.
     * @returns Structured response for the user.
     */
    private async workflow_execute(input: string, stage: DAGNode): Promise<CalypsoResponse> {
        if (!stage.handler) {
            return this.response_create(`>> ERROR: STAGE [${stage.id}] HAS NO HANDLER DEFINED.`, [], false, CalypsoStatusCode.ERROR);
        }

        const parts: string[] = input.split(/\s+/);
        const command: string = parts[0].toLowerCase();
        const args: string[] = parts.slice(1);

        // Invoke the Plugin Host (The VM)
        const result: PluginResult = await this.pluginHost.plugin_execute(stage.handler, stage.parameters, command, args);

        // If plugin succeeded, handle automated materialization and context advancement
        if (result.statusCode === CalypsoStatusCode.OK) {
            this.workflowAdapter.stage_complete(stage.id);
            
            // AUTOMATED MATERIALIZATION (The Merkle Engine)
            const content: Record<string, unknown> = (result.artifactData as Record<string, unknown>) || { 
                command: input, 
                timestamp: new Date().toISOString(),
                result: true 
            };
            await this.merkleEngine.artifact_materialize(stage.id, content);

            // Advance the session context to the NEXT logical stage
            const pos: WorkflowPosition = this.workflowAdapter.position_resolve(this.vfs, this.sessionPath);
            if (pos.currentStage) {
                this.workflowSession.advance_force(pos.currentStage.id);
            }
        }

        return this.response_create(
            result.message, 
            result.actions || [], 
            result.statusCode === CalypsoStatusCode.OK, 
            result.statusCode
        );
    }

    // ─── Internal Utilities ────────────────────────────────────────────────

    private response_create(message: string, actions: CalypsoAction[], success: boolean, statusCode: CalypsoStatusCode): CalypsoResponse {
        return { message, actions, success, statusCode };
    }

    private reset(): void {
        this.vfs.reset();
        this.storeActions.reset();
        this.federation.state_reset();

        // Re-initialize session path with a new timestamp
        const username: string = this.shell.env_get('USER') || 'user';
        const workflowId: string = this.workflowAdapter.workflowId;
        const sessionId: string = `session-${Date.now()}`;
        this.sessionPath = `/home/${username}/sessions/${workflowId}/${sessionId}`;
        try {
            this.vfs.dir_create(`${this.sessionPath}/data`);
        } catch { /* exists */ }

        // Notify store adapter if it supports session path tracking
        this.storeActions.session_setPath(this.sessionPath);

        // Re-initialize workflow session
        this.workflowSession = new WorkflowSession(this.vfs, this.workflowAdapter, this.sessionPath);
        this.merkleEngine.session_setPath(this.sessionPath);

        // Re-sync federation with new session path
        const fedPath: StagePath | undefined = this.workflowAdapter.stagePaths.get('federate-brief');
        if (fedPath) {
            this.federation.session_set(`${this.sessionPath}/${fedPath.artifactFile}`);
        }
    }

    private workflow_nextStep(): string {
        const pos: WorkflowPosition = this.workflowAdapter.position_resolve(this.vfs, this.sessionPath);
        if (pos.isComplete) {
            return [
                '● WORKFLOW COMPLETE.',
                '',
                '○ ALL STAGES OF THE PIPELINE HAVE BEEN SUCCESSFULLY EXECUTED.',
                '○ FINAL ARTIFACTS ARE AVAILABLE IN THE SESSION AND PROJECT TREES.',
                '',
                'Next Steps:',
                '  `/reset` — Reset system to clean state'
            ].join('\n');
        }
        return pos.nextInstruction || 'Workflow complete.';
    }

    private workflow_checkTransition(cmd: string): TransitionResult {
        return this.workflowAdapter.transition_check(cmd, this.vfs, this.sessionPath);
    }

    private runtimeMaterialization_resolve(config: CalypsoCoreConfig): RuntimeMaterializationMode {
        if (config.runtimeMaterialization) {
            return config.runtimeMaterialization;
        }
        const env: string = (this.shell.env_get('ARGUS_RUNTIME_MODEL') || '').toLowerCase();
        if (env === 'legacy') {
            return 'legacy';
        }
        return 'store';
    }

    private runtimeJoinMaterialization_resolve(config: CalypsoCoreConfig): boolean {
        if (config.runtimeJoinMaterialization !== undefined) {
            return config.runtimeJoinMaterialization;
        }
        const env: string = (this.shell.env_get('ARGUS_RUNTIME_JOIN_MATERIALIZE') || '').toLowerCase();
        if (env === '0' || env === 'false' || env === 'off' || env === 'no') {
            return false;
        }
        if (env === '1' || env === 'true' || env === 'on' || env === 'yes') {
            return true;
        }
        return true;
    }

    private async controlIntent_dispatch(intent: ControlPlaneIntent): Promise<CalypsoResponse | null> {
        if (intent.plane !== 'control') return null;
        
        let response: CalypsoResponse | null = null;
        if (intent.action === 'scripts_list') {
            response = this.scripts.scripts_response([]);
        } else if (intent.action === 'script_run') {
            response = await this.scripts.script_execute([intent.scriptRef]);
        } else if (intent.action === 'script_show') {
            response = this.scripts.scripts_response([intent.scriptRef]);
        }
        
        return response;
    }

    private async confirmation_dispatch(input: string): Promise<CalypsoResponse | null> {
        if (!/^(yes|y|affirmative|confirm|ok|go\s+ahead)$/i.test(input)) {
            return null;
        }

        const state: Partial<AppState> = this.storeActions.state_get();
        if (state.lastIntent?.startsWith('CONFIRM_JUMP:')) {
            const intentContent: string = state.lastIntent.substring('CONFIRM_JUMP:'.length);
            const [stageId, originalInput] = intentContent.split('|');
            
            const stage: DAGNode | undefined = this.workflowAdapter.dag.nodes.get(stageId);
            if (stage) {
                // Clear the intent before executing to avoid recursion
                const clearIntentState: Partial<AppState> = { lastIntent: null };
                this.storeActions.state_set(clearIntentState);
                const res: CommandResolution = this.workflowSession.resolveCommand(originalInput);
                return await this.workflow_dispatch(originalInput, res, true);
            }
        }

        // Standard workflow confirmation (e.g. approve)
        // If we are in a confirmation state, the 'approve' command should be valid in the manifest.
        // We resolve 'approve' against the current session context.
        const res: CommandResolution = this.workflowSession.resolveCommand('approve');
        if (res.stage) {
            return await this.workflow_dispatch('approve', res, true);
        }

        return null;
    }

    private key_register(provider: string, key: string): CalypsoResponse {
        if (!provider || !key) {
            return this.response_create('Usage: /key <provider> <key>', [], false, CalypsoStatusCode.ERROR);
        }
        const normalizedProvider: 'openai' | 'gemini' | null = this.provider_resolve(provider);
        if (!normalizedProvider) {
            return this.response_create(`Unsupported provider: ${provider}`, [], false, CalypsoStatusCode.ERROR);
        }
        this.activeProvider = normalizedProvider;
        this.simulationMode = false;
        this.engine = new LCARSEngine(
            {
                apiKey: key,
                model: normalizedProvider === 'openai' ? 'gpt-4o' : 'gemini-1.5-flash',
                provider: normalizedProvider,
            },
            this.knowledge,
        );
        this.llmProvider = this.llmProvider_create();
        return this.response_create(`● AI CORE ONLINE [${provider.toUpperCase()}]`, [], true, CalypsoStatusCode.OK);
    }

    private provider_resolve(provider: string): 'openai' | 'gemini' | null {
        const normalized: string = provider.toLowerCase();
        if (normalized === 'openai' || normalized === 'gemini') {
            return normalized;
        }
        return null;
    }

    private llmProvider_create(): LLMProvider {
        return new LLMProvider(
            this.engine,
            this.statusProvider,
            this.searchProvider,
            this.storeActions,
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
        );
    }

    private help_format(): string {
        return '  /status, /workflows, /next, /version, /key, /reset, /snapshot, /help';
    }

    public vfs_snapshot(path: string = '/', includeContent: boolean = false): VfsSnapshotNode | null {
        return vfs_snapshot(this.vfs, path, includeContent);
    }
}
