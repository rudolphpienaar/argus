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
    QueryResponse
} from './types.js';
import type { Dataset, AppState, Project } from '../core/models/types.js';
import { FederationOrchestrator } from './federation/FederationOrchestrator.js';
import { ScriptRuntime } from './scripts/ScriptRuntime.js';
import { SearchProvider, type SearchMaterialization } from './SearchProvider.js';
import { StatusProvider } from './StatusProvider.js';
import { LLMProvider } from './LLMProvider.js';
import { actionIntent_resolve } from './routing/ActionRouter.js';
import { vfs_snapshot } from './utils/VfsUtils.js';
import { fingerprint_compute } from '../dag/fingerprint/hasher.js';
import type { FingerprintRecord } from '../dag/fingerprint/types.js';
import { DATASETS } from '../core/data/datasets.js';
import { MOCK_PROJECTS } from '../core/data/projects.js';
import { project_gather, project_rename, project_harmonize } from '../core/logic/ProjectManager.js';
import { CalypsoPresenter } from './CalypsoPresenter.js';
import { scripts_list, type CalypsoScript } from './scripts/Catalog.js';
import { controlPlaneIntent_resolve, type ControlPlaneIntent } from './routing/ControlPlaneRouter.js';
import { WorkflowAdapter } from '../dag/bridge/WorkflowAdapter.js';
import type { TransitionResult, WorkflowSummary } from '../dag/bridge/WorkflowAdapter.js';
import type { WorkflowPosition, DAGNode, StageParameters } from '../dag/graph/types.js';
import type { ArtifactEnvelope } from '../dag/store/types.js';
import type { StagePath } from '../dag/bridge/SessionPaths.js';

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
    private federation: FederationOrchestrator;
    private scripts: ScriptRuntime;

    /** Registry of workflow handlers (shared capabilities). */
    private readonly HANDLER_REGISTRY: Record<string, (cmd: string, args: string[]) => Promise<CalypsoResponse | null> | CalypsoResponse | null> = {
        'search': async (_: string, args: string[]): Promise<CalypsoResponse | null> => {
            const query: string = args.join(' ');
            return await this.workflow_search(query);
        },
        'gather': async (cmd: string, args: string[]): Promise<CalypsoResponse | null> => {
            if (cmd === 'add') {
                return await this.workflow_add(args[0]);
            }
            if (cmd === 'remove' || cmd === 'deselect') {
                return this.workflow_remove(args[0]);
            }
            if (cmd === 'gather' || cmd === 'review') {
                return this.workflow_gather(args[0]);
            }
            if (cmd === 'mount') {
                return this.workflow_mount();
            }
            return null;
        },
        'rename': async (_: string, args: string[]): Promise<CalypsoResponse | null> => {
            let nameArg: string = args.join(' ');
            if (nameArg.toLowerCase().startsWith('to ')) {
                nameArg = nameArg.substring(3).trim();
            }
            return await this.workflow_rename(nameArg);
        },
        'harmonize': async (): Promise<CalypsoResponse | null> => {
            return await this.workflow_harmonize();
        },
        'scaffold': async (_: string, args: string[]): Promise<CalypsoResponse | null> => {
            return await this.workflow_proceed(args[0]);
        },
        'train': (): CalypsoResponse | null => null, 
        'publish': (): CalypsoResponse | null => null, 
        'federation': (cmd: string, args: string[]): Promise<CalypsoResponse | null> | CalypsoResponse | null => {
            if (cmd === 'federate') {
                return this.workflow_federate(args);
            }
            if (this.federation.active) {
                return this.workflow_federationCommand(cmd, args);
            }
            return null;
        }
    };

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

        this.llmProvider = new LLMProvider(
            this.engine,
            this.statusProvider,
            this.searchProvider,
            storeActions,
            (msg, actions, success) => this.response_create(msg, actions, success),
            (cmd) => this.command_execute(cmd)
        );

        const username: string = shell.env_get('USER') || 'user';
        const sessionId: string = `session-${Date.now()}`;
        this.sessionPath = `/home/${username}/sessions/${workflowId}/${sessionId}`;
        // Root stage folders (like search/) are created on-demand by sessionArtifact_write

        this.federation = new FederationOrchestrator(vfs, storeActions);
        const fedPath = this.workflowAdapter.stagePaths.get('federate-brief');
        if (fedPath) {
            this.federation.session_set(`${this.sessionPath}/${fedPath.artifactFile}`);
        }

        this.scripts = new ScriptRuntime(
            storeActions,
            (cmd: string) => this.command_execute(cmd),
            () => this.searchProvider.lastMentioned_get()
        );
    }

    /** Primary command execution pipeline. */
    public async command_execute(input: string): Promise<CalypsoResponse> {
        const trimmed = input.trim();
        const parts = trimmed.split(/\s+/);
        const primary = parts[0]?.toLowerCase() || '';

        if (!trimmed) return this.response_create('', [], true);

        const scriptPrompt = await this.scripts.maybeConsumeInput(trimmed);
        if (scriptPrompt) return scriptPrompt;

        if (trimmed.startsWith('/') || primary === 'status' || primary === 'reset' || primary === 'help') {
            const normalized: string = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
            const parts: string[] = normalized.slice(1).split(/\s+/);
            const cmd: string = parts[0].toLowerCase();
            if (cmd === 'run' || cmd === 'scripts') {
                // fall through to primary command check below
            } else {
                return this.special_handle(normalized);
            }
        }

        if (primary === 'scripts' || (trimmed.startsWith('/') && trimmed.toLowerCase().startsWith('/scripts'))) {
            const args = trimmed.startsWith('/') ? trimmed.split(/\s+/).slice(1) : parts.slice(1);
            return this.scripts.scripts_response(args);
        }
        if (primary === 'run' || (trimmed.startsWith('/') && trimmed.toLowerCase().startsWith('/run'))) {
            const args = trimmed.startsWith('/') ? trimmed.split(/\s+/).slice(1) : parts.slice(1);
            return this.scripts.script_execute(args);
        }

        const controlResult = await this.control_handle(trimmed);
        if (controlResult) return controlResult;

        const confirmation = this.confirmation_dispatch(trimmed);
        if (confirmation) return confirmation;

        if (primary === 'harmonize') {
            const result = await this.workflow_dispatch(trimmed);
            if (result) return result;
        }

        const shellResult = await this.shell_handle(trimmed, primary);
        if (shellResult) return shellResult;

        // Only attempt workflow dispatch if it's a likely command (single word or known command)
        if (this.workflowAdapter.stage_forCommand(primary)) {
            const workflowResult = await this.workflow_dispatch(trimmed);
            if (workflowResult) return workflowResult;
        }

        const guidance = this.guidance_handle(trimmed);
        if (guidance) return guidance;

        const action = await this.actionIntent_handle(trimmed);
        if (action) return action;

        return this.llmProvider.query(trimmed, this.sessionPath);
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
                .filter(c => c.name.toLowerCase().startsWith(prefix.toLowerCase()))
                .map(c => {
                    const base = dir === '.' ? '' : (dir.endsWith('/') ? dir : dir + '/');
                    const suffix = c.type === 'folder' ? '/' : '';
                    return base + c.name + suffix;
                });
        } catch {
            return [];
        }
    }

    // ─── Pipeline Handlers ──────────────────────────────────────────────────

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
                const snap = vfs_snapshot(this.vfs, args[0] || '/', true);
                return snap ? this.response_create(JSON.stringify(snap, null, 2), [], true) 
                            : this.response_create(`Path not found: ${args[0]}`, [], false);
            case 'state':
                return this.response_create(JSON.stringify(this.store_snapshot(), null, 2), [], true);
            case 'reset':
                this.reset();
                return this.response_create('System reset to clean state.', [], true);
            case 'version':
                return this.response_create(this.version_get(), [], true);
            case 'status':
                return this.response_create(this.statusProvider.status_generate(this.simulationMode, this.activeProvider, this.activeModel), [], true);
            case 'key':
                return this.key_register(args[0], args[1]);
            case 'workflows': {
                const workflows = this.workflows_available();
                const progress = workflows.map(w => `○ [${w.id}] ${w.name}: ${w.description}`).join('\n');
                return this.response_create(progress, [], true);
            }
            case 'scripts':
                return this.scripts.scripts_response(args);
            case 'help':
                return this.response_create(this.help_format(), [], true);
            case 'greet': return this.response_create('__GREET_ASYNC__', [], true);
            case 'standby': return this.response_create('__STANDBY_ASYNC__', [], true);
            default: return this.response_create(`Unknown command: /${cmd}`, [], false);
        }
    }

    private async control_handle(input: string): Promise<CalypsoResponse | null> {
        const intent = controlPlaneIntent_resolve(input, scripts_list().map(s => ({ id: s.id, aliases: s.aliases })));
        return await this.controlIntent_dispatch(intent);
    }

    private async shell_handle(input: string, primary: string): Promise<CalypsoResponse | null> {
        const result = await this.shell.command_execute(input);
        if (result.exitCode === 127) return null;

        if (result.exitCode === 0 && primary === 'python' && input.includes('train.py')) {
            this.sessionArtifact_write('train', { status: 'LOCAL_PASS' });
        }
        return this.response_create(result.stderr ? `${result.stdout}\n<error>${result.stderr}</error>` : result.stdout, [], result.exitCode === 0);
    }

    private guidance_handle(input: string): CalypsoResponse | null {
        const patterns = [/^what('?s| is| should be)?\s*(the\s+)?next/i, /^next\??$/i, /^how\s+do\s+i\s+(proceed|continue|start)/i, /status/i, /progress/i];
        return patterns.some(p => p.test(input)) ? this.response_create(this.workflow_nextStep(), [], true) : null;
    }

    private async actionIntent_handle(input: string): Promise<CalypsoResponse | null> {
        const cmd = actionIntent_resolve(input);
        return cmd ? await this.workflow_dispatch(cmd) : null;
    }

    // ─── Workflow Handlers ──────────────────────────────────────────────────

    private async workflow_dispatch(input: string): Promise<CalypsoResponse | null> {
        const parts: string[] = input.split(/\s+/);
        const cmd: string = parts[0].toLowerCase();
        const args: string[] = parts.slice(1);

        const transition: TransitionResult = this.workflow_checkTransition(cmd);
        if (!transition.allowed && transition.skippedStageId) {
            this.workflowAdapter.skip_increment(transition.skippedStageId);
            const warning: string = CalypsoPresenter.workflowWarning_format(transition);
            
            // If it's a soft warning, we DO NOT execute. We just return the warning.
            // The next time the user tries, skip_increment will eventually allow it.
            return this.response_create(warning, [], false);
        }

        if (!transition.allowed && transition.hardBlock) {
            return this.response_create(CalypsoPresenter.error_format(transition.warning!), [], false);
        }

        const res: CalypsoResponse | null = await this.workflow_execute(cmd, args);
        return res;
    }

    private async workflow_execute(cmd: string, args: string[]): Promise<CalypsoResponse | null> {
        const stage: DAGNode | null = this.workflowAdapter.stage_forCommand(cmd);
        if (!stage || !stage.handler) {
            return null;
        }

        const handler: (cmd: string, args: string[]) => Promise<CalypsoResponse | null> | CalypsoResponse | null = this.HANDLER_REGISTRY[stage.handler];
        const response: CalypsoResponse | null = await handler(cmd, args);

        if (response?.success) {
            this.workflowStage_complete(cmd);
            
            // AUTOMATED MATERIALIZATION: 
            this.sessionArtifact_write(stage.id, { 
                command: cmd, 
                args, 
                timestamp: new Date().toISOString(),
                result: response.success
            });
        }
        return response;
    }

    private async workflow_search(query: string): Promise<CalypsoResponse> {
        const results: Dataset[] = this.searchProvider.search(query);
        
        // Resolve topological path if search is part of current workflow
        const stage: DAGNode | null = this.workflowAdapter.stage_forCommand('search');
        const sp: StagePath | undefined = stage ? this.workflowAdapter.stagePaths.get(stage.id) : undefined;
        const topologicalPath: string | undefined = sp ? `${this.sessionPath}/${sp.dataDir}` : undefined;

        // Provider generates content block
        const snap: SearchMaterialization = this.searchProvider.snapshot_materialize(query, results, topologicalPath);
        
        if (stage && snap.content) {
            // Include query in content for fingerprinting
            const content: Record<string, unknown> = { ...snap.content, query };
            // Centralized materialization with fingerprints
            this.sessionArtifact_write(stage.id, content);
        }

        const display: string | null = this.searchProvider.displayPath_resolve(snap.path);
        const snapLine: string = display ? `\n${CalypsoPresenter.info_format(`SEARCH SNAPSHOT: ${display}`)}` : '';

        return results.length === 0 
            ? this.response_create(CalypsoPresenter.info_format(`NO MATCHING DATASETS FOUND FOR "${query}".`), [], false)
            : this.response_create(CalypsoPresenter.success_format(`FOUND ${results.length} MATCHING DATASET(S):`) + `\n${CalypsoPresenter.searchListing_format(results)}\n\n${CalypsoPresenter.searchDetails_format(results)}${snapLine}`, [{ type: 'workspace_render', datasets: results }], true);
    }

    private async workflow_add(targetId: string): Promise<CalypsoResponse> {
        const datasets = this.searchProvider.resolve(targetId);
        if (datasets.length === 0) return this.response_create(CalypsoPresenter.error_format(`DATASET "${targetId}" NOT FOUND.`), [], false);

        let lastProj: any;
        for (const ds of datasets) {
            this.storeActions.dataset_select(ds);
            lastProj = project_gather(ds);
        }
        return this.response_create(CalypsoPresenter.success_format(`DATASET(S) GATHERED: ${datasets.map(d => d.id).join(', ')}`) + `\n${CalypsoPresenter.info_format(`MOUNTED TO [${lastProj.name}]`)}`, datasets.map(d => ({ type: 'dataset_select', id: d.id })), true);
    }

    private workflow_remove(targetId: string): CalypsoResponse {
        const datasets = this.searchProvider.resolve(targetId);
        if (datasets.length === 0) return this.response_create(CalypsoPresenter.error_format(`DATASET "${targetId}" NOT FOUND IN BUFFER.`), [], false);
        for (const ds of datasets) this.storeActions.dataset_deselect(ds.id);
        return this.response_create(CalypsoPresenter.success_format(`DATASET(S) REMOVED: ${datasets.map(d => d.id).join(', ')}`), datasets.map(d => ({ type: 'dataset_deselect', id: d.id })), true);
    }

    private workflow_gather(targetId?: string): CalypsoResponse {
        if (targetId) for (const ds of this.searchProvider.resolve(targetId)) { this.storeActions.dataset_select(ds); project_gather(ds); }
        const datasets = this.storeActions.datasets_getSelected();
        if (datasets.length === 0) return this.response_create(CalypsoPresenter.info_format('NO DATASETS SELECTED.'), [], true);
        return this.response_create(CalypsoPresenter.success_format(`COHORT REVIEW: ${datasets.length} SELECTED:`) + `\n${datasets.map(d => `  [${d.id}] ${d.name}`).join('\n')}`, [{ type: 'stage_advance', stage: 'gather' }], true);
    }

    private workflow_harmonize(): CalypsoResponse {
        const active = this.storeActions.project_getActive();
        if (!active) return this.response_create(CalypsoPresenter.error_format('NO ACTIVE PROJECT.'), [], false);
        const project = MOCK_PROJECTS.find(p => p.id === active.id);
        if (!project) return this.response_create(CalypsoPresenter.error_format('PROJECT NOT FOUND.'), [], false);
        project_harmonize(project);
        return this.response_create('__HARMONIZE_ANIMATE__', [], true);
    }

    private workflow_rename(newName: string): CalypsoResponse {
        const active = this.storeActions.project_getActive();
        if (!active) return this.response_create(CalypsoPresenter.error_format('NO ACTIVE PROJECT.'), [], false);
        const project = MOCK_PROJECTS.find(p => p.id === active.id);
        if (!project) return this.response_create(CalypsoPresenter.error_format('PROJECT NOT FOUND.'), [], false);
        project_rename(project, newName);
        return this.response_create(CalypsoPresenter.success_format(`RENAMED TO [${newName}]`), [{ type: 'project_rename', id: project.id, newName }], true);
    }

    private async workflow_proceed(type?: string): Promise<CalypsoResponse> {
        const workflow = this.proceedWorkflow_resolve(type);
        if (!workflow) return this.response_create(CalypsoPresenter.error_format('INVALID WORKFLOW TYPE.'), [], false);

        const active = this.storeActions.project_getActive();
        if (active) {
            const username = this.shell.env_get('USER') || 'user';
            const projectPath = `/home/${username}/projects/${active.name}/src`;
            this.shell.env_set('PROJECT', active.name);
            
            const { projectDir_populate, chrisProject_populate } = await import('../vfs/providers/ProjectProvider.js');
            if (workflow === 'chris') {
                chrisProject_populate(this.vfs, username, active.name);
            } else {
                projectDir_populate(this.vfs, username, active.name);
            }
            
            this.vfs.cwd_set(projectPath);
            this.shell.env_set('PWD', projectPath);
        }

        return this.response_create(CalypsoPresenter.success_format(`PROCEEDING WITH ${workflow.toUpperCase()} WORKFLOW.`), [{ type: 'stage_advance', stage: 'process', workflow }], true);
    }

    private async workflow_proceedChris(): Promise<CalypsoResponse> {
        const active = this.storeActions.project_getActive();
        const username = this.shell.env_get('USER') || 'user';
        if (active) {
            const projectPath = `/home/${username}/projects/${active.name}/src`;
            this.shell.env_set('PROJECT', active.name);
            const { chrisProject_populate } = await import('../vfs/providers/ProjectProvider.js');
            chrisProject_populate(this.vfs, username, active.name);
            this.vfs.cwd_set(projectPath);
            this.shell.env_set('PWD', projectPath);
        }
        return this.response_create(CalypsoPresenter.success_format('PROCEEDING WITH CHRIS WORKFLOW.'), [{ type: 'stage_advance', stage: 'process', workflow: 'chris' }], true);
    }

    private workflow_mount(): CalypsoResponse {
        return this.response_create(CalypsoPresenter.success_format('MOUNT COMPLETE.'), [{ type: 'stage_advance', stage: 'process' }], true);
    }

    private workflow_federate(args: string[] = []): CalypsoResponse {
        return this.federation.command('federate', args, this.shell.env_get('USER') || 'user');
    }

    private workflow_federationCommand(verb: string, args: string[]): CalypsoResponse {
        return this.federation.command(verb, args, this.shell.env_get('USER') || 'user');
    }

    // ─── Internal Utilities ────────────────────────────────────────────────

    private response_create(message: string, actions: CalypsoAction[], success: boolean): CalypsoResponse {
        return { message, actions, success };
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

        // Re-sync federation with new session path
        const fedPath: StagePath | undefined = this.workflowAdapter.stagePaths.get('federate-brief');
        if (fedPath) {
            this.federation.session_set(`${this.sessionPath}/${fedPath.artifactFile}`);
        }
    }

    private workflow_nextStep(): string {
        const pos = this.workflowAdapter.position_resolve(this.vfs, this.sessionPath);
        if (pos.isComplete) {
            return [
                '● WORKFLOW COMPLETE.',
                '',
                '○ ALL STAGES OF THE FEDERATED ML PIPELINE HAVE BEEN SUCCESSFULLY EXECUTED.',
                '○ FINAL ARTIFACTS ARE AVAILABLE IN THE SESSION AND PROJECT TREES.',
                '',
                'Next Steps:',
                '  `federate --rerun` — Explicitly start a new federation run',
                '  `/reset` — Reset system to clean state'
            ].join('\n');
        }
        return pos.nextInstruction || 'Workflow complete.';
    }

    private workflow_checkTransition(cmd: string): TransitionResult {
        return this.workflowAdapter.transition_check(cmd, this.vfs, this.sessionPath);
    }

    /**
     * Mark a workflow stage as complete in the adapter.
     */
    private workflowStage_complete(cmd: string): void {
        const stage: DAGNode | null = this.workflowAdapter.stage_forCommand(cmd);
        if (stage) {
            this.workflowAdapter.stage_complete(stage.id);
        }
    }

    /**
     * Materialize a workflow stage artifact with Merkle fingerprinting.
     *
     * @param stageId - The ID of the stage being materialized
     * @param content - Domain-specific content block
     */
    private sessionArtifact_write(stageId: string, content: Record<string, unknown>): void {
        const stage: DAGNode | undefined = this.workflowAdapter.dag.nodes.get(stageId);
        const stagePath: StagePath | undefined = this.workflowAdapter.stagePaths.get(stageId);
        if (!stage || !stagePath) {
            return;
        }

        const parentFingerprints: Record<string, string> = this.parentFingerprints_resolve(stage);
        const parameters_used: StageParameters = (content.args !== undefined)
            ? { args: content.args } as StageParameters
            : stage.parameters;
        
        const contentStr: string = JSON.stringify(content);
        const _fingerprint: string = fingerprint_compute(contentStr, parentFingerprints);

        const tsNow: Date = new Date();
        const timestamp: string = tsNow.toISOString() + '-' + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        
        const envelope: ArtifactEnvelope = {
            stage: stageId,
            timestamp,
            parameters_used,
            content,
            _fingerprint,
            _parent_fingerprints: parentFingerprints
        };

        const finalPath: string = this.artifactPath_resolve(stageId, stagePath, tsNow);
        this.vfs.file_create(finalPath, JSON.stringify(envelope, null, 2));
    }

    /**
     * Resolve the fingerprints of all parent stages.
     */
    private parentFingerprints_resolve(node: DAGNode): Record<string, string> {
        const parentFingerprints: Record<string, string> = {};
        if (node.previous) {
            for (const parentId of node.previous) {
                const fp: string | null = this.fingerprint_get(parentId);
                if (fp) {
                    parentFingerprints[parentId] = fp;
                }
            }
        }
        return parentFingerprints;
    }

    /**
     * Resolve the physical path for an artifact, creating a branch if needed.
     */
    private artifactPath_resolve(stageId: string, stagePath: StagePath, tsNow: Date): string {
        let finalPath: string = `${this.sessionPath}/${stagePath.artifactFile}`;
        if (this.vfs_exists(finalPath)) {
            const branchSuffix: string = tsNow.getTime().toString();
            const branchPath: string = stagePath.artifactFile.replace(
                `${stageId}/data/`, 
                `${stageId}_BRANCH_${branchSuffix}/data/`
            );
            finalPath = `${this.sessionPath}/${branchPath}`;
        }
        return finalPath;
    }

    /**
     * Read the fingerprint from the latest materialized artifact for a stage.
     */
    private fingerprint_get(stageId: string): string | null {
        const record: FingerprintRecord | null = this.workflowAdapter.latestFingerprint_get(
            this.vfs,
            this.sessionPath,
            stageId
        );
        return record ? record.fingerprint : null;
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

    private confirmation_dispatch(input: string): CalypsoResponse | null {
        if (!this.federation.active) return null;
        if (/^(yes|y|affirmative|confirm|proceed|ok|go\s+ahead)$/i.test(input)) return this.workflow_federationCommand('approve', []);
        return null;
    }

    private key_register(provider: string, key: string): CalypsoResponse {
        if (!provider || !key) return this.response_create('Usage: /key <provider> <key>', [], false);
        this.activeProvider = provider as any;
        this.simulationMode = false;
        this.engine = new LCARSEngine({ apiKey: key, model: provider === 'openai' ? 'gpt-4o' : 'gemini-1.5-flash', provider: this.activeProvider! }, this.knowledge);
        this.llmProvider = new LLMProvider(this.engine, this.statusProvider, this.searchProvider, this.storeActions, (m, a, s) => this.response_create(m, a, s), (c) => this.command_execute(c));
        return this.response_create(`● AI CORE ONLINE [${provider.toUpperCase()}]`, [], true);
    }

    private help_format(): string {
        return '  /status, /workflows, /next, /version, /key, /reset, /snapshot, /help';
    }

    private proceedWorkflow_resolve(type?: string): 'fedml' | 'chris' | null {
        if (type === 'fedml' || type === 'chris') return type;
        const persona = (this.shell.env_get('PERSONA') || '').toLowerCase();
        return persona === 'appdev' || persona === 'chris' ? 'chris' : 'fedml';
    }

    public vfs_snapshot(path: string = '/', includeContent: boolean = false): VfsSnapshotNode | null {
        return vfs_snapshot(this.vfs, path, includeContent);
    }
}
