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
    CalypsoIntent,
    PluginResult
} from './types.js';
import { CalypsoStatusCode } from './types.js';
import type { AppState, Project } from '../core/models/types.js';
import { ScriptRuntime } from './scripts/ScriptRuntime.js';
import { SearchProvider } from './SearchProvider.js';
import { StatusProvider } from './StatusProvider.js';
import { LLMProvider } from './LLMProvider.js';
import { IntentParser } from './routing/IntentParser.js';
import { PluginHost } from './PluginHost.js';
import { TelemetryBus } from './TelemetryBus.js';
import { MerkleEngine } from './MerkleEngine.js';
import { vfs_snapshot } from './utils/VfsUtils.js';
import { scripts_list, type CalypsoScript } from './scripts/Catalog.js';
import { controlPlaneIntent_resolve, type ControlPlaneIntent } from './routing/ControlPlaneRouter.js';
import { WorkflowAdapter } from '../dag/bridge/WorkflowAdapter.js';
import type { TransitionResult, WorkflowSummary } from '../dag/bridge/WorkflowAdapter.js';
import type { WorkflowPosition, DAGNode } from '../dag/graph/types.js';
import type { ArtifactEnvelope } from '../dag/store/types.js';
import { WorkflowSession, type CommandResolution } from '../dag/bridge/WorkflowSession.js';
import { CalypsoPresenter } from './CalypsoPresenter.js';

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
    private scripts: ScriptRuntime;
    private intentParser: IntentParser;
    private pluginHost: PluginHost;
    private merkleEngine: MerkleEngine;
    private telemetryBus: TelemetryBus;

    constructor(
        private vfs: VirtualFileSystem,
        private shell: Shell,
        storeActions: CalypsoStoreActions,
        config: CalypsoCoreConfig = {}
    ) {
        this.storeActions = storeActions;
        this.knowledge = config.knowledge;

        this.telemetryBus = config.telemetryBus || new TelemetryBus();
        this.searchProvider = new SearchProvider(vfs, shell, storeActions);

        const workflowId: string = this.workflowId_resolve(config);
        this.workflowAdapter = WorkflowAdapter.definition_load(workflowId);
        this.statusProvider = new StatusProvider(vfs, storeActions, this.workflowAdapter);

        if (config.llmConfig) {
            this.engine = new LCARSEngine(config.llmConfig, config.knowledge);
            this.activeProvider = config.llmConfig.provider;
            this.activeModel = config.llmConfig.model;
        } else {
            this.engine = null;
        }

        const projectName: string | null = this.projectName_resolve(config.projectName);
        
        // v10.2: Physical Provenance - sessionPath is now project/provenance
        this.sessionPath = this.sessionPath_resolve(projectName);
        
        this.workflowSession = new WorkflowSession(vfs, this.workflowAdapter, this.sessionPath);
        
        this.llmProvider = this.llmProvider_create();
        this.pluginHost = new PluginHost(
            vfs, 
            shell, 
            storeActions, 
            this.searchProvider, 
            this.telemetryBus,
            this.workflowAdapter,
            this.sessionPath
        );
        this.merkleEngine = new MerkleEngine(
            vfs,
            this.workflowAdapter,
            this.sessionPath,
        );

        this.scripts = new ScriptRuntime(
            storeActions,
            this.workflowAdapter,
            (cmd: string): Promise<CalypsoResponse> => this.command_execute(cmd),
        );
    }

    // ─── Lifecycle & Boot ───────────────────────────────────────────────────

    /**
     * Public trigger for the interactive system boot sequence.
     *
     * Each milestone emits WAIT before performing its work, then OK once
     * complete. The 80ms yield between states is intentional: it ensures
     * the WAIT frame clears the WebSocket send buffer and arrives at the
     * client in a distinct TCP segment, preventing Nagle coalescing from
     * delivering both frames simultaneously and collapsing the WAIT→OK
     * animation to a single final-state flash.
     */
    public async boot(): Promise<void> {
        try {
            const username: string = this.username_resolve();
            const yieldLoop = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 80));

            // ── Genesis: sync DAG session state ─────────────────────────
            await this.status_emit('sys_genesis', 'INITIATING ARGUS CORE GENESIS', 'WAIT');
            await yieldLoop();
            await this.workflowSession.sync();
            await this.status_emit('sys_genesis', 'INITIATING ARGUS CORE GENESIS', 'OK');
            await yieldLoop();

            // ── VFS: verify home namespace is materialized ───────────────
            await this.status_emit('sys_vfs', 'MOUNTING VIRTUAL FILE SYSTEM', 'WAIT');
            await yieldLoop();
            const homeNode = this.vfs.node_stat(`/home/${username}`);
            await this.status_emit('sys_vfs', 'MOUNTING VIRTUAL FILE SYSTEM', homeNode ? 'OK' : 'FAIL');
            await yieldLoop();

            // ── Merkle: integrity engine ready ───────────────────────────
            await this.status_emit('sys_merkle', 'CALIBRATING INTEGRITY ENGINE', 'WAIT');
            await yieldLoop();
            await this.status_emit('sys_merkle', 'CALIBRATING INTEGRITY ENGINE', 'OK');
            await yieldLoop();

            await this.status_emit('sys_ready', `SYSTEM READY FOR USER: ${username.toUpperCase()}`, 'DONE');
        } catch (e: unknown) {
            console.error('System boot failed:', e);
        }
    }

    /**
     * Set the active workflow persona and perform session genesis.
     * 
     * @param workflowId - The ID of the manifest to load.
     * @returns Success status.
     */
    public async workflow_set(workflowId: string | null): Promise<boolean> {
        if (!workflowId) return false;
        try {
            const yieldLoop = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 80));
            
            this.storeActions.state_set({ currentPersona: workflowId } as any);
            (this.storeActions as any).session_start?.();

            const username: string = this.username_resolve();
            const sessionId: string = this.storeActions.sessionId_get() || 'unknown';

            // 1. MANIFEST
            await this.status_emit('user_manifest', `LOADING PERSONA MANIFEST: ${workflowId.toUpperCase()}`, 'WAIT');
            await yieldLoop();
            try {
                this.workflowAdapter = WorkflowAdapter.definition_load(workflowId);
                await this.status_emit('user_manifest', `LOADING PERSONA MANIFEST: ${workflowId.toUpperCase()}`, 'OK');
                await yieldLoop();
            } catch (e: any) {
                await this.status_emit('user_manifest', `MANIFEST LOAD FAILED: ${e.message}`, 'FAIL');
                throw e;
            }
            
            await this.session_realign();
            
            // 2. SESSION VFS
            await this.status_emit('user_vfs', 'GENERATING SESSION DATA SPACE', 'WAIT');
            await yieldLoop();
            try {
                const { sessionDir_scaffold } = await import('../vfs/providers/ProjectProvider.js');
                sessionDir_scaffold(this.vfs, username, undefined, sessionId);
                await this.status_emit('user_vfs', 'GENERATING SESSION DATA SPACE', 'OK');
                await yieldLoop();
            } catch (e: any) {
                await this.status_emit('user_vfs', `VFS GENESIS FAILED: ${e.message}`, 'FAIL');
                throw e;
            }

            // 3. VIEWPORT
            await this.status_emit('user_viewport', 'ESTABLISHING CAUSAL VIEWPORT PORTAL', 'WAIT');
            await yieldLoop();
            try {
                this.workflowSession = new WorkflowSession(this.vfs, this.workflowAdapter, this.sessionPath);
                await this.workflowSession.sync();
                await this.status_emit('user_viewport', 'ESTABLISHING CAUSAL VIEWPORT PORTAL', 'OK');
                await yieldLoop();
            } catch (e: any) {
                await this.status_emit('user_viewport', `VIEWPORT SYNC FAILED: ${e.message}`, 'FAIL');
                throw e;
            }
            
            await this.status_emit('user_ready', `PERSONA [${workflowId.toUpperCase()}] ACTIVE`, 'DONE');
            
            return true;
        } catch (e: unknown) {
            console.error('Workflow set failed:', e);
            return false;
        }
    }

    /**
     * Internal helper for standardized boot status telemetry.
     */
    private async status_emit(id: string, message: string, status: string | null = null): Promise<void> {
        this.telemetryBus.emit({ 
            type: 'boot_log', 
            id, 
            message, 
            status, 
            timestamp: new Date().toISOString() 
        });
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

        const confirmationFastPath: CalypsoResponse | null = await this.confirmation_dispatch(parsed.trimmed);
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

        const resolution = this.workflowSession.resolveCommand(parsed.primary, false);
        const fastPathResult: CalypsoResponse | null = await this.commandFastPath_handle(parsed, resolution);
        if (fastPathResult) return fastPathResult;

        const guidance: CalypsoResponse | null = this.guidance_handle(parsed.trimmed);
        if (guidance) return guidance;

        const response: CalypsoResponse = await this.llmProvider.query(parsed.trimmed, this.sessionPath);
        response.statusCode = CalypsoStatusCode.CONVERSATIONAL;

        await this.workflowSession.sync();

        return response;
    }

    // ─── Public API ───────────────────────────────────────────────────────

    public prompt_get(): string {
        return this.shell.prompt_render();
    }

    public session_getPath(): string {
        return this.sessionPath;
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

    public merkleEngine_latestFingerprint_get(stageId: string): ArtifactEnvelope | null {
        return this.workflowAdapter.latestArtifact_get(this.vfs, this.sessionPath, stageId);
    }

    public async merkleEngine_dataDir_resolve(stageId: string): Promise<string> {
        return this.merkleEngine.dataDir_resolve(stageId);
    }

    public telemetry_subscribe(observer: (event: any) => void): () => void {
        return this.telemetryBus.subscribe(observer);
    }

    public tab_complete(line: string): string[] {
        const parts = line.split(/\s+/);
        const last = parts[parts.length - 1] || '';
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
            const args: string[] = trimmed.startsWith('/') ? trimmed.split(/\s+/).slice(1) : parts.slice(1);
            return this.scripts.scripts_response(args);
        }
        if (primary === 'run' || primary === '/run') {
            const args: string[] = trimmed.startsWith('/') ? trimmed.split(/\s+/).slice(1) : parts.slice(1);
            return this.scripts.script_execute(args);
        }

        const controlResult: CalypsoResponse | null = await this.control_handle(trimmed);
        if (controlResult) return controlResult;

        const confirmation: CalypsoResponse | null = await this.confirmation_dispatch(trimmed);
        if (confirmation) return confirmation;

        return await this.shell_handle(trimmed, primary);
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
                return this.response_create(this.statusProvider.status_generate(Boolean(this.engine), this.activeProvider, this.activeModel), [], true, CalypsoStatusCode.OK);
            case 'key':
                return this.key_register(args[0], args[1]);
            case 'session':
                return await this.session_handle(args);
            case 'workflows': {
                const workflows: WorkflowSummary[] = this.workflows_available();
                const progress: string = workflows.map((w: WorkflowSummary): string => `○ [${w.id}] ${w.name}: ${w.description}`).join('\n');
                return this.response_create(progress, [], true, CalypsoStatusCode.OK);
            }
            case 'help':
                return this.response_create('  /status, /workflows, /next, /version, /key, /reset, /snapshot, /help', [], true, CalypsoStatusCode.OK);
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

        if (result.exitCode === 0 && primary === 'python') {
            const resolution = this.workflowSession.resolveCommand(input.trim());
            if (resolution.stage) {
                this.workflowAdapter.stage_complete(resolution.stage.id);
                await this.merkleEngine.artifact_materialize(resolution.stage.id, {
                    command: input.trim(),
                    timestamp: new Date().toISOString(),
                    result: true
                });
                const pos = this.workflowAdapter.position_resolve(this.vfs, this.sessionPath);
                if (pos.currentStage) this.workflowSession.advance_force(pos.currentStage.id);
            }
        }
        return this.response_create(
            result.stderr ? `${result.stdout}\n<error>${result.stderr}</error>` : result.stdout, 
            [], 
            result.exitCode === 0, 
            result.exitCode === 0 ? CalypsoStatusCode.OK : CalypsoStatusCode.ERROR,
            primary === 'python' ? { render_mode: 'training' } : undefined
        );
    }

    private guidance_handle(input: string): CalypsoResponse | null {
        const patterns: RegExp[] = [/^what('?s| is| should be)?\s*(the\s+)?next/i, /^next\??$/i, /^how\s+do\s+i\s+(proceed|continue|start)/i, /status/i, /progress/i];
        return patterns.some((p: RegExp): boolean => p.test(input)) 
            ? this.response_create(this.workflow_nextStep(), [], true, CalypsoStatusCode.OK) 
            : null;
    }

    // ─── Workflow Handlers ──────────────────────────────────────────────────

    private async workflow_dispatch(input: string, resolution: CommandResolution, isConfirmed: boolean = false): Promise<CalypsoResponse | null> {
        const parts: string[] = input.split(/\s+/);
        const cmd: string = parts[0].toLowerCase();

        const transition: TransitionResult = this.workflowAdapter.transition_check(cmd, this.vfs, this.sessionPath);
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
                const pos = this.workflowAdapter.position_resolve(this.vfs, this.sessionPath);
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
        const projectName: string | null = this.projectName_resolve();
        const newPath: string = this.sessionPath_resolve(projectName);
        
        const username: string = this.username_resolve();
        const persona: string = this.shell.env_get('PERSONA') || 'fedml';
        const sessionId: string | null = this.storeActions.sessionId_get();
        const sessionRoot = sessionId ? `/home/${username}/projects/${persona}/${sessionId}` : null;

        if (sessionRoot) this.shell.env_set('SCRATCH', sessionRoot);

        if (newPath === this.sessionPath) {
            await this.workflowSession.sync();
            this.shell.boundary_set(this.workflowSession.viewportPath_get());
            return;
        }

        this.sessionPath = newPath;
        this.workflowSession.sessionPath_set(this.sessionPath);
        this.merkleEngine.session_setPath(this.sessionPath);
        this.storeActions.session_setPath(this.sessionPath);
        this.pluginHost.session_setPath(this.sessionPath); 
        
        await this.workflowSession.sync();
        
        this.shell.boundary_set(this.workflowSession.viewportPath_get());
    }

    private async session_handle(args: string[]): Promise<CalypsoResponse> {
        const sub: string = (args[0] || 'list').toLowerCase();
        const username: string = this.username_resolve();
        const persona: string = this.shell.env_get('PERSONA') || 'fedml';
        const personaRoot = `/home/${username}/projects/${persona}`;

        switch (sub) {
            case 'list': {
                try {
                    const sessions = this.vfs.dir_list(personaRoot).filter(e => e.type === 'folder');
                    const currentId = this.storeActions.sessionId_get();
                    const list = sessions.map(s => `○ ${s.name}${s.name === currentId ? ' [ACTIVE]' : ''}`).join('\n');
                    return this.response_create(`AVAILABLE SESSIONS [${persona.toUpperCase()}]:\n${list || 'None'}`, [], true, CalypsoStatusCode.OK);
                } catch { return this.response_create(`No sessions found for persona: ${persona}`, [], false, CalypsoStatusCode.ERROR); }
            }
            case 'new': {
                this.storeActions.state_set({ activeProject: null } as any);
                this.storeActions.session_start();
                const { sessionDir_scaffold } = await import('../vfs/providers/ProjectProvider.js');
                sessionDir_scaffold(this.vfs, username);
                await this.session_realign();
                this.workflowSession = new WorkflowSession(this.vfs, this.workflowAdapter, this.sessionPath);
                await this.workflowSession.sync();
                return this.response_create(`● STARTED NEW SESSION: [${this.storeActions.sessionId_get()}]`, [], true, CalypsoStatusCode.OK);
            }
            case 'resume': {
                const targetId = args[1];
                if (!targetId) return this.response_create('Usage: /session resume <id>', [], false, CalypsoStatusCode.ERROR);
                if (!this.vfs.node_stat(`${personaRoot}/${targetId}`)) return this.response_create(`Session not found: ${targetId}`, [], false, CalypsoStatusCode.ERROR);
                this.storeActions.state_set({ currentSessionId: targetId } as any);
                await this.session_realign();
                this.workflowSession = new WorkflowSession(this.vfs, this.workflowAdapter, this.sessionPath);
                await this.workflowSession.sync();
                return this.response_create(`● RESUMED SESSION: [${targetId}]`, [], true, CalypsoStatusCode.OK);
            }
            default: return this.response_create('Usage: /session [list|new|resume <id>]', [], false, CalypsoStatusCode.ERROR);
        }
    }

    private response_create(message: string, actions: CalypsoAction[], success: boolean, statusCode: CalypsoStatusCode, ui_hints?: CalypsoResponse['ui_hints']): CalypsoResponse {
        return { message, actions, success, statusCode, ui_hints };
    }

    private workflowFallback_allowed(protocolCommand: string, intentCommand: string): boolean {
        return intentCommand.toLowerCase() === 'proceed' || this.workflowAdapter.commandDeclared_isExplicit(protocolCommand);
    }

    private reset(): void {
        this.vfs.reset();
        this.storeActions.reset();
        this.session_realign();
        try {
            this.vfs.dir_create(this.sessionPath);
        } catch { /* ignore */ }
        this.workflowSession = new WorkflowSession(this.vfs, this.workflowAdapter, this.sessionPath);
        this.workflowSession.sync(); 
        this.merkleEngine.session_setPath(this.sessionPath);
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

    private username_resolve(): string {
        return this.shell.env_get('USER') || 'user';
    }

    private workflow_nextStep(): string {
        const pos = this.workflowAdapter.position_resolve(this.vfs, this.sessionPath);
        if (pos.isComplete) return '● WORKFLOW COMPLETE.\n\nNext Steps:\n  `/reset` — Reset system to clean state';
        return pos.nextInstruction || 'Workflow complete.';
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
        );
    }
}
