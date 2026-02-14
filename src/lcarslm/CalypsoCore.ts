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
    CalypsoIntent,
    CalypsoCoreConfig,
    CalypsoStoreActions,
    VfsSnapshotNode,
    QueryResponse
} from './types.js';
import type { Dataset, AppState, Project } from '../core/models/types.js';
import { FederationOrchestrator } from './federation/FederationOrchestrator.js';
import { ScriptRuntime } from './scripts/ScriptRuntime.js';
import { DATASETS } from '../core/data/datasets.js';
import { MOCK_PROJECTS } from '../core/data/projects.js';
import { project_gather, project_rename, project_harmonize } from '../core/logic/ProjectManager.js';
import { projectDir_populate, chrisProject_populate } from '../vfs/providers/ProjectProvider.js';
import { VERSION } from '../generated/version.js';
import { WorkflowEngine } from '../core/workflows/WorkflowEngine.js';
import {
    scripts_list,
    type CalypsoScript
} from './scripts/Catalog.js';
import {
    controlPlaneIntent_resolve,
    type ControlPlaneIntent
} from './routing/ControlPlaneRouter.js';
import type {
    WorkflowDefinition,
    WorkflowState,
    WorkflowContext,
    TransitionResult,
    WorkflowSummary
} from '../core/workflows/types.js';

/**
 * DOM-free AI orchestrator for the ARGUS system.
 *
 * CalypsoCore processes natural language commands through three layers:
 * 1. Shell builtins (ls, cd, cat, tree, etc.)
 * 2. Workflow commands (search, add, gather, mount, federate)
 * 3. LLM fallback (natural language → intent → action)
 *
 * All state mutations happen here. UI rendering is delegated to adapters.
 *
 * @example
 * ```typescript
 * const core = new CalypsoCore(vfs, shell, store, config);
 * const response = await core.command_execute('search histology datasets');
 * console.log(response.message);
 * // Adapter processes response.actions
 * ```
 */
export class CalypsoCore {
    private engine: LCARSEngine | null;
    private simulationMode: boolean;
    private knowledge: Record<string, string> | undefined;
    private activeProvider: 'openai' | 'gemini' | null = null;
    private activeModel: string | null = null;

    /** Recently mentioned datasets for anaphora resolution ("that", "it", "them") */
    private lastMentionedDatasets: Dataset[] = [];

    /** Singular anaphoric tokens that refer to the last-mentioned dataset */
    private static readonly ANAPHORA_SINGULAR: ReadonlySet<string> = new Set([
        'that', 'it', 'this'
    ]);

    /** Plural anaphoric tokens that refer to all recently mentioned datasets */
    private static readonly ANAPHORA_PLURAL: ReadonlySet<string> = new Set([
        'them', 'those', 'these', 'all', 'both', 'everything'
    ]);

    /** Map of workflow commands to their intent identifiers */
    private static readonly COMMAND_TO_INTENT: Readonly<Record<string, string>> = {
        'search': 'SEARCH',
        'add': 'ADD',
        'gather': 'GATHER',
        'review': 'GATHER',
        'harmonize': 'HARMONIZE',
        'proceed': 'PROCEED',
        'code': 'CODE',
        'train': 'TRAIN',
        'python': 'PYTHON',
        'federate': 'FEDERATE',
        'mount': 'PROCEED'
    };

    // Store reference for state access (injected as interface to avoid circular deps)
    private storeActions: CalypsoStoreActions;

    /** Active workflow definition */
    private workflowDefinition: WorkflowDefinition;

    /** Current workflow state (completed stages, skip counts) */
    private workflowState: WorkflowState;

    /** Federation orchestrator (multi-phase handshake). */
    private federation: FederationOrchestrator;

    /** Script runtime engine (power scripts + structured sessions). */
    private scripts: ScriptRuntime;

    constructor(
        private vfs: VirtualFileSystem,
        private shell: Shell,
        storeActions: CalypsoStoreActions,
        config: CalypsoCoreConfig = {}
    ) {
        this.storeActions = storeActions;
        this.simulationMode = config.simulationMode ?? false;
        this.knowledge = config.knowledge;

        // Initialize workflow engine with default 'fedml' workflow
        const workflowId: string = config.workflowId ?? 'fedml';
        this.workflowDefinition = WorkflowEngine.definition_load(workflowId);
        this.workflowState = WorkflowEngine.state_create(workflowId);

        // Initialize federation orchestrator
        this.federation = new FederationOrchestrator(vfs, storeActions);

        // Initialize script runtime with command executor callback
        this.scripts = new ScriptRuntime(
            storeActions,
            (cmd: string) => this.command_execute(cmd),
            () => this.lastMentionedDatasets
        );

        if (config.llmConfig && !this.simulationMode) {
            this.engine = new LCARSEngine(config.llmConfig, config.knowledge);
            this.activeProvider = config.llmConfig.provider;
            this.activeModel = config.llmConfig.model;
        } else {
            this.engine = new LCARSEngine(null, config.knowledge);
        }
    }

    // ─── Public API ────────────────────────────────────────────────────────

    /**
     * Execute a command (natural language or shell).
     *
     * @param input - User input string
     * @returns Structured response with message and actions
     */
    public async command_execute(input: string): Promise<CalypsoResponse> {
        const trimmed: string = input.trim();
        const parts: string[] = trimmed.split(/\s+/);
        const primaryCommand: string = parts[0]?.toLowerCase() || '';

        if (!trimmed) {
            return this.response_create('', [], true);
        }

        // If a structured script is awaiting user input, consume that first.
        const scriptPromptResult: CalypsoResponse | null = await this.scripts.maybeConsumeInput(trimmed);
        if (scriptPromptResult) {
            return scriptPromptResult;
        }

        // Check for special commands (prefixed with /)
        if (trimmed.startsWith('/')) {
            const specialResult: CalypsoResponse = await this.special_dispatch(trimmed);
            // Handle async commands (like /greet)
            if (specialResult.message === '__GREET_ASYNC__') {
                const parts: string[] = trimmed.slice(1).split(/\s+/);
                const username: string = parts[1] || this.shell.env_get('USER') || 'user';
                return this.greeting_generate(username);
            }
            if (specialResult.message === '__STANDBY_ASYNC__') {
                const parts: string[] = trimmed.slice(1).split(/\s+/);
                const username: string = parts[1] || this.shell.env_get('USER') || 'user';
                return this.standby_generate(username);
            }
            return specialResult;
        }

        // Deterministic script UX (shared across CLI and embedded ARGUS)
        if (primaryCommand === 'scripts') {
            return this.scripts.scripts_response(parts.slice(1));
        }

        if (primaryCommand === 'run') {
            return this.scripts.script_execute(parts.slice(1));
        }

        // Deterministic control-plane router (scripts automation surface).
        const controlIntent: ControlPlaneIntent = controlPlaneIntent_resolve(
            trimmed,
            scripts_list().map((script: CalypsoScript) => ({
                id: script.id,
                aliases: script.aliases
            }))
        );

        const controlResult: CalypsoResponse | null = await this.controlIntent_dispatch(controlIntent);
        if (controlResult) {
            return controlResult;
        }

        // Deterministic yes/no confirmations for staged federate handshakes.
        const confirmationResult: CalypsoResponse | null = this.confirmation_dispatch(trimmed);
        if (confirmationResult) {
            return confirmationResult;
        }

        // Prioritize first-class harmonize intent so CLI can render
        // the dedicated harmonization experience instead of shell usage text.
        if (primaryCommand === 'harmonize') {
            const workflowResult: CalypsoResponse | null = await this.workflow_dispatch(trimmed);
            if (workflowResult) {
                return workflowResult;
            }
        }

        // Try shell builtins first
        const shellResult = await this.shell.command_execute(trimmed);
        if (shellResult.exitCode !== 127) {
            // Shell handled it (127 = command not found)
            const message: string = shellResult.stderr
                ? `${shellResult.stdout}\n<error>${shellResult.stderr}</error>`
                : shellResult.stdout;
            return this.response_create(message, [], shellResult.exitCode === 0);
        }

        // Try workflow commands
        const workflowResult: CalypsoResponse | null = await this.workflow_dispatch(trimmed);
        if (workflowResult) {
            return workflowResult;
        }

        // Intercept workflow-related queries for deterministic guidance
        // These bypass the LLM to provide accurate, state-aware responses
        const lowerInput: string = trimmed.toLowerCase();
        const workflowPatterns: RegExp[] = [
            // "What's next" style queries
            /^what('?s| is| should be)?\s*(the\s+)?next/i,
            /^next\??$/i,
            /^what\s+(now|should\s+i\s+do)/i,
            /^what\s+do\s+i\s+do/i,
            /^help\s+me/i,
            /^guide\s+me/i,
            /^suggest/i,
            /^how\s+do\s+i\s+(proceed|continue|start)/i,
            // Status and progress queries
            /^(show\s+)?(my\s+)?status/i,
            /^(show\s+)?(my\s+)?progress/i,
            /^where\s+am\s+i/i,
            /^what\s+stage/i,
            /^which\s+stage/i,
            /^current\s+stage/i,
            /remaining\s+steps/i,
            /steps\s+remaining/i,
            /^what\s+are\s+the\s+remaining\s+steps/i,
            // Harmonization queries (ensure user gets proper guidance)
            /do\s+i\s+need\s+to\s+harmonize/i,
            /should\s+i\s+harmonize/i,
            /what('?s| is)\s+harmoniz/i,
            /why\s+(do\s+i\s+need\s+to\s+|should\s+i\s+)?harmonize/i,
            /before\s+(i\s+)?(can\s+)?(code|train|proceed)/i,
            /can\s+i\s+skip\s+harmoniz/i
        ];

        if (workflowPatterns.some((pattern: RegExp): boolean => pattern.test(lowerInput))) {
            const guidance: string = this.workflow_nextStep();
            return this.response_create(guidance, [], true);
        }

        // Intercept imperative NL workflow actions (e.g., "ok, do the harmonization")
        // Sits after workflowPatterns (interrogative) and before LLM (would describe, not execute)
        const resolvedCommand: string | null = this.actionIntent_resolve(trimmed);
        if (resolvedCommand) {
            const actionResult: CalypsoResponse | null = await this.workflow_dispatch(resolvedCommand);
            if (actionResult) return actionResult;
        }

        // Fall through to LLM
        return this.llm_query(trimmed);
    }

    /**
     * Get a snapshot of the VFS tree for assertions.
     *
     * @param rootPath - Root path for the snapshot (default: '/')
     * @param includeContent - Include file content in snapshot
     * @returns Serializable VFS snapshot
     */
    public vfs_snapshot(rootPath: string = '/', includeContent: boolean = false): VfsSnapshotNode | null {
        const resolved: string = this.vfs.path_resolve(rootPath);
        const node: FileNode | null = this.vfs.node_stat(resolved);

        if (!node) {
            return null;
        }

        return this.node_serialize(node, includeContent);
    }

    /**
     * Get a snapshot of the store state.
     *
     * @returns Partial state snapshot
     */
    public store_snapshot(): Partial<AppState> {
        return this.storeActions.state_get();
    }

    /**
     * Check if a path exists in the VFS.
     *
     * @param path - Path to check
     * @returns True if path exists
     */
    public vfs_exists(path: string): boolean {
        const resolved: string = this.vfs.path_resolve(path);
        return this.vfs.node_stat(resolved) !== null;
    }

    /**
     * Read file content from VFS.
     *
     * @param path - Path to read
     * @returns File content or null if not found/not a file
     */
    public vfs_read(path: string): string | null {
        const resolved: string = this.vfs.path_resolve(path);
        return this.vfs.node_read(resolved);
    }

    /**
     * Reset the system to a clean state.
     */
    public reset(): void {
        this.storeActions.reset();
        this.workflowState = WorkflowEngine.state_create(this.workflowDefinition.id);
        this.lastMentionedDatasets = [];
        this.federation.state_reset();
        this.scripts.session_reset();
    }

    /**
     * Get version information.
     */
    public version_get(): string {
        return `CALYPSO CORE V${VERSION}`;
    }

    /**
     * Get the current prompt string (for CLI clients).
     * Format: <user>@CALYPSO:[pwd]>
     */
    public prompt_get(): string {
        return this.shell.prompt_render();
    }

    /**
     * Set the active workflow by ID.
     *
     * @param workflowId - Workflow ID ('fedml', 'chris', etc.) or null to disable
     * @returns True if workflow was set, false if not found
     */
    public workflow_set(workflowId: string | null): boolean {
        if (!workflowId) {
            // Disable workflow enforcement by setting a permissive state
            this.workflowState = {
                workflowId: 'none',
                skipCounts: {}
            };
            return true;
        }

        try {
            this.workflowDefinition = WorkflowEngine.definition_load(workflowId);
            this.workflowState = WorkflowEngine.state_create(workflowId);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get the current workflow ID.
     *
     * @returns Current workflow ID or 'none' if disabled
     */
    public workflow_get(): string {
        return this.workflowState.workflowId;
    }

    /**
     * Get available workflows for selection.
     *
     * @returns Array of workflow summaries
     */
    public workflows_available(): WorkflowSummary[] {
        return WorkflowEngine.workflows_summarize();
    }

    // ─── Special Commands (/command) ───────────────────────────────────────

    /**
     * Dispatch special commands prefixed with /.
     */
    private async special_dispatch(input: string): Promise<CalypsoResponse> {
        const parts: string[] = input.slice(1).split(/\s+/);
        const cmd: string = parts[0].toLowerCase();
        const args: string[] = parts.slice(1);

        switch (cmd) {
            case 'snapshot': {
                const path: string = args[0] || '/';
                const snapshot: VfsSnapshotNode | null = this.vfs_snapshot(path, true);
                if (snapshot) {
                    return this.response_create(JSON.stringify(snapshot, null, 2), [], true);
                }
                return this.response_create(`Path not found: ${path}`, [], false);
            }

            case 'state': {
                const state: Partial<AppState> = this.store_snapshot();
                return this.response_create(JSON.stringify(state, null, 2), [], true);
            }

            case 'store': {
                const property: string = args[0];
                if (!property) {
                    return this.response_create('Usage: /store <property>', [], false);
                }
                const state: Partial<AppState> = this.store_snapshot();
                const value: unknown = (state as Record<string, unknown>)[property];
                return this.response_create(JSON.stringify(value, null, 2), [], true);
            }

            case 'reset': {
                this.reset();
                return this.response_create('System reset to clean state.', [], true);
            }

            case 'version': {
                return this.response_create(this.version_get(), [], true);
            }

            case 'status': {
                const lines: string[] = [
                    '╔══════════════════════════════════════╗',
                    '║  CALYPSO SYSTEM STATUS               ║',
                    '╚══════════════════════════════════════╝',
                    ''
                ];

                if (this.simulationMode || !this.engine) {
                    lines.push('○ AI CORE: SIMULATION MODE');
                    lines.push('  No API key configured.');
                    lines.push('  Use /key <provider> <api-key> to enable.');
                } else {
                    lines.push('● AI CORE: ONLINE');
                    lines.push(`  Provider: ${this.activeProvider?.toUpperCase() || 'UNKNOWN'}`);
                    lines.push(`  Model: ${this.activeModel || 'default'}`);
                }

                lines.push('');
                lines.push(`○ VFS: ${this.vfs.cwd_get()}`);
                const datasets = this.storeActions.datasets_getSelected();
                lines.push(`○ DATASETS SELECTED: ${datasets.length}`);
                const project = this.storeActions.project_getActive();
                lines.push(`○ ACTIVE PROJECT: ${project ? project.name : 'none'}`);

                return this.response_create(lines.join('\n'), [], true);
            }

            case 'key': {
                const provider: string = args[0]?.toLowerCase();
                const apiKey: string = args[1];

                if (!provider || !apiKey) {
                    const status: string = this.engine ?
                        (this.simulationMode ? '○ AI CORE: SIMULATION MODE (no key set)' : '● AI CORE: ONLINE') :
                        '○ AI CORE: OFFLINE';
                    return this.response_create(
                        `${status}\n\nUsage: /key <provider> <api-key>\n  provider: openai | gemini\n  api-key:  Your API key\n\nExample: /key gemini AIzaSy...`,
                        [],
                        true
                    );
                }

                if (provider !== 'openai' && provider !== 'gemini') {
                    return this.response_create('>> ERROR: Provider must be "openai" or "gemini"', [], false);
                }

                // Reinitialize engine with new key
                const model: string = provider === 'openai' ? 'gpt-4o-mini' : 'gemini-flash-latest';
                this.engine = new LCARSEngine({
                    provider: provider as 'openai' | 'gemini',
                    apiKey,
                    model
                }, this.knowledge);
                this.simulationMode = false;
                this.activeProvider = provider as 'openai' | 'gemini';
                this.activeModel = model;

                return this.response_create(
                    `● AI CORE INITIALIZED.\n  Provider: ${provider.toUpperCase()}\n  Model: ${model}\n\nI AM NOW FULLY OPERATIONAL.`,
                    [],
                    true
                );
            }

            case 'workflow': {
                const progress: string = this.workflow_progress();
                return this.response_create(progress, [], true);
            }

            case 'batch':
            case 'jump': {
                const targetStage: string | undefined = args[0];
                const datasetHint: string | undefined = args[1];
                return this.workflow_batchToStage(targetStage, datasetHint);
            }

            case 'next': {
                const guidance: string = this.workflow_nextStep();
                return this.response_create(guidance, [], true);
            }

            case 'scripts': {
                return this.scripts.scripts_response(args);
            }

            case 'run': {
                return this.scripts.script_execute(args);
            }

            case 'help': {
                const help: string = `CALYPSO SPECIAL COMMANDS:
  /status           - Show system status (AI, VFS, project)
  /scripts [name]   - List available automation scripts (or inspect one)
  /run [script]     - Execute a built-in script
  /run --dry [script] - Preview script steps without executing
  /batch <stage> [dataset] - Fast-forward workflow to target stage
  /jump <stage> [dataset]  - Alias for /batch
  /next             - Show suggested next step with commands
  /workflow         - Show workflow progress summary
  /key <provider> <key> - Set API key (openai|gemini)
  /snapshot [path]  - Display VFS snapshot as JSON
  /state            - Display Store state as JSON
  /store <property> - Display specific store property
  /reset            - Reset to clean state
  /version          - Display version info
  /help             - Show this help

SHELL COMMANDS:
  ls, cd, cat, pwd, mkdir, touch, rm, cp, mv, tree, echo, env, whoami

WORKFLOW COMMANDS:
  search <query>    - Search dataset catalog
  add <dataset-id>  - Add dataset to selection
  gather            - Create project from selection
  harmonize         - Standardize cohort for federation
  proceed / code    - Scaffold training environment
  python train.py   - Run local training
  federate          - Start federation sequence (3-phase handshake)
  federate --name <app> - Set marketplace app name (phase 2)
  federate --org <name> - Set marketplace org/namespace (phase 2)
  federate --private | --public - Set publish visibility (phase 2)
  federate --yes    - Confirm pending federation step
  federate --rerun  - Re-initialize federation from step 1/5 (explicit restart)
  federate --abort  - Abort federation handshake

TIP: Type /next anytime to see what to do next!`;
                return this.response_create(help, [], true);
            }

            case 'greet': {
                // Return null to signal async handling needed
                return this.response_create('__GREET_ASYNC__', [], true);
            }

            case 'standby': {
                // Return marker so command_execute can invoke async generator.
                return this.response_create('__STANDBY_ASYNC__', [], true);
            }

            default:
                return this.response_create(`Unknown special command: /${cmd}`, [], false);
        }
    }

    /**
     * Fast-forward workflow state to a target stage for power users.
     *
     * This command is intentionally deterministic and bypasses LLM routing.
     * It materializes required artifacts in VFS so the workflow engine sees
     * consistent ground truth after batching.
     *
     * @param targetRaw - Target stage keyword (gather|harmonize|code|train)
     * @param datasetHint - Optional dataset ID/name used when bootstrapping gather
     * @returns Batch execution summary
     */
    private workflow_batchToStage(targetRaw?: string, datasetHint?: string): CalypsoResponse {
        if (!targetRaw) {
            return this.response_create(
                'Usage: /batch <gather|harmonize|code|train> [dataset-id]',
                [],
                false
            );
        }

        const target: string = targetRaw.toLowerCase();
        const targetAliases: Record<string, 'gather' | 'harmonize' | 'code' | 'train'> = {
            gather: 'gather',
            assembly: 'gather',
            harmonize: 'harmonize',
            harmonic: 'harmonize',
            code: 'code',
            process: 'code',
            proceed: 'code',
            mount: 'code',
            train: 'train',
            python: 'train'
        };

        const targetStage: 'gather' | 'harmonize' | 'code' | 'train' | undefined = targetAliases[target];
        if (!targetStage) {
            return this.response_create(
                `Unsupported batch target: ${targetRaw}\nSupported: gather, harmonize, code, train`,
                [],
                false
            );
        }

        const stageOrder: Array<'gather' | 'harmonize' | 'code' | 'train'> = ['gather', 'harmonize', 'code', 'train'];
        const targetIndex: number = stageOrder.indexOf(targetStage);
        const username: string = this.shell.env_get('USER') || 'user';
        const lines: string[] = [
            `● BATCH MODE: FAST-FORWARD TO ${targetStage.toUpperCase()}`
        ];
        const actions: CalypsoAction[] = [];

        // 1) Gather bootstrap
        if (targetIndex >= 0) {
            const selected: Dataset[] = this.storeActions.datasets_getSelected();

            if (selected.length === 0) {
                const hintedDataset: Dataset | undefined = datasetHint
                    ? DATASETS.find((ds: Dataset): boolean =>
                        ds.id.toLowerCase() === datasetHint.toLowerCase() ||
                        ds.name.toLowerCase().includes(datasetHint.toLowerCase())
                    )
                    : undefined;

                if (datasetHint && !hintedDataset) {
                    return this.response_create(`>> ERROR: DATASET "${datasetHint}" NOT FOUND FOR BATCH BOOTSTRAP.`, [], false);
                }

                const bootstrapDataset: Dataset | undefined = hintedDataset || DATASETS[0];
                if (!bootstrapDataset) {
                    return this.response_create('>> ERROR: NO DATASETS AVAILABLE FOR BATCH BOOTSTRAP.', [], false);
                }

                const addResult: CalypsoResponse = this.workflow_add(bootstrapDataset.id);
                if (!addResult.success) {
                    return addResult;
                }
                actions.push(...addResult.actions);
                lines.push(`○ BOOTSTRAPPED COHORT WITH [${bootstrapDataset.id}] ${bootstrapDataset.name}`);
            } else {
                lines.push(`○ REUSING EXISTING SELECTION (${selected.length} DATASET(S))`);
            }

            this.storeActions.stage_set('gather');
            this.shell.stage_enter('gather');
            lines.push(`○ GATHER CONTEXT READY AT ${this.vfs.cwd_get()}`);
        }

        const activeMeta = this.storeActions.project_getActive();
        if (!activeMeta) {
            return this.response_create('>> ERROR: BATCH FAILED. NO ACTIVE PROJECT.', actions, false);
        }

        const project: Project | undefined = MOCK_PROJECTS.find((p: Project): boolean => p.id === activeMeta.id);
        if (!project) {
            return this.response_create('>> ERROR: BATCH FAILED. PROJECT MODEL NOT FOUND.', actions, false);
        }

        const projectBase: string = `/home/${username}/projects/${project.name}`;

        // 2) Harmonize
        if (targetIndex >= 1) {
            const harmonizedMarker: string = `${projectBase}/input/.harmonized`;
            if (this.vfs.node_stat(harmonizedMarker)) {
                lines.push('○ HARMONIZATION ALREADY COMPLETE');
            } else {
                project_harmonize(project);
                lines.push('○ HARMONIZATION COMPLETE');
            }
        }

        // 3) Code scaffold
        if (targetIndex >= 2) {
            const trainScriptPath: string = `${projectBase}/src/train.py`;
            if (this.vfs.node_stat(trainScriptPath)) {
                lines.push('○ CODE SCAFFOLD ALREADY PRESENT');
            } else {
                projectDir_populate(this.vfs, username, project.name);
                lines.push('○ CODE SCAFFOLD GENERATED (train.py, config.yaml, requirements.txt)');
            }

            try {
                this.vfs.dir_create(`${projectBase}/output`);
            } catch {
                // output already exists
            }

            this.shell.env_set('PROJECT', project.name);
            this.shell.env_set('STAGE', 'process');
            this.storeActions.stage_set('process');
            this.shell.stage_enter('process');
            lines.push(`○ PROCESS CONTEXT READY AT ${this.vfs.cwd_get()}`);
        }

        // 4) Train-ready
        if (targetIndex >= 3) {
            const localPassMarker: string = `${projectBase}/.local_pass`;
            if (this.vfs.node_stat(localPassMarker)) {
                lines.push('○ LOCAL VALIDATION ALREADY COMPLETE (.local_pass PRESENT)');
            } else {
                lines.push('○ READY FOR LOCAL VALIDATION');
                lines.push('  NEXT: `python train.py`');
            }
        }

        lines.push('');
        lines.push(`● BATCH COMPLETE. TARGET STAGE: ${targetStage.toUpperCase()}`);

        return this.response_create(lines.join('\n'), actions, true);
    }

    /**
     * Execute control-plane intent routed by ControlPlaneRouter.
     *
     * @param intent - Control-plane intent result.
     * @returns Response if handled by control plane, else null.
     */
    private async controlIntent_dispatch(intent: ControlPlaneIntent): Promise<CalypsoResponse | null> {
        if (intent.plane !== 'control') {
            return null;
        }

        switch (intent.action) {
            case 'scripts_list':
                return this.scripts.scripts_response([]);
            case 'script_show':
                return this.scripts.scripts_response([intent.scriptRef]);
            case 'script_run':
                return this.scripts.script_execute(intent.dryRun ? ['--dry', intent.scriptRef] : [intent.scriptRef]);
            case 'script_run_ambiguous':
                return this.response_create(
                    `○ MULTIPLE SCRIPT MATCHES: ${intent.candidates.join(', ')}\nUse /run [script-name] to select one.`,
                    [],
                    false
                );
            default:
                return null;
        }
    }

    /**
     * Summarize a command response for per-step script output.
     *

    /**
     * Generate a personalized greeting via the LLM.
     */
    private async greeting_generate(username: string): Promise<CalypsoResponse> {
        // Summarize available datasets for context
        const datasetSummary: string = DATASETS.map((ds: Dataset): string =>
            `${ds.id}: ${ds.name} (${ds.modality}, ${ds.imageCount} images, ${ds.provider})`
        ).join('\n');

        const totalImages: number = DATASETS.reduce((sum: number, ds: Dataset): number => sum + ds.imageCount, 0);
        const modalities: string[] = [...new Set(DATASETS.map((ds: Dataset): string => ds.modality))];
        const providers: string[] = [...new Set(DATASETS.map((ds: Dataset): string => ds.provider))];

        if (!this.engine) {
            return this.response_create(
                `● Welcome, ${username}. I am CALYPSO, ready to assist with your medical imaging workflows.\n` +
                `○ The ATLAS catalog currently contains ${DATASETS.length} datasets with ${totalImages.toLocaleString()} total images across ${modalities.length} modalities.`,
                [], true
            );
        }

        const greetingPrompt: string = `You are greeting user "${username}" who just logged into the ARGUS system.

AVAILABLE DATASETS IN ATLAS CATALOG:
${datasetSummary}

CATALOG SUMMARY:
- Total datasets: ${DATASETS.length}
- Total images: ${totalImages.toLocaleString()}
- Modalities: ${modalities.join(', ')}
- Providers: ${providers.join(', ')}

Generate a greeting that:
1. Welcomes ${username} warmly but professionally (1-2 sentences)
2. Mentions ONE specific interesting fact about the available datasets (e.g., highlight a unique dataset, the variety of modalities, or a notable provider)
3. Optionally adds ONE brief fact about federated learning or medical AI

Keep total response under 120 words. Use LCARS markers: ● for affirmations/greetings, ○ for data/facts. Do NOT include any [ACTION:] or [SELECT:] tags.`;

        try {
            const response: QueryResponse = await this.engine.query(greetingPrompt, [], true);
            // Clean any action markers that might slip through
            const cleanMessage: string = response.answer
                .replace(/\[ACTION:.*?\]/g, '')
                .replace(/\[SELECT:.*?\]/g, '')
                .replace(/\[FILTER:.*?\]/g, '')
                .trim();
            return this.response_create(cleanMessage, [], true);
        } catch {
            return this.response_create(
                `● Welcome, ${username}. I am CALYPSO, your AI assistant for the ARGUS Federation Network.\n` +
                `○ The ATLAS catalog contains ${DATASETS.length} datasets spanning ${modalities.join(', ')} modalities.`,
                [], true
            );
        }
    }

    /**
     * Generate a free-exploration standby response via the LLM.
     */
    private async standby_generate(username: string): Promise<CalypsoResponse> {
        const fallback: string =
            `● Acknowledged, ${username}. Workflow guidance is in standby.\n` +
            `○ Free exploration mode is active.\n` +
            `○ Use \`/next\` for immediate command guidance or \`/workflow\` for stage status.`;

        if (!this.engine) {
            return this.response_create(fallback, [], true);
        }

        const prompt: string = `User "${username}" selected free exploration mode (no guided workflow).
Respond as CALYPSO in-character, concise and mission-focused.

Requirements:
1. Acknowledge standby guidance mode.
2. State that free exploration is active.
3. Give concrete next commands: /next and /workflow (optionally /scripts).
4. Keep under 70 words.
5. Use LCARS markers: ● and ○.
6. Do NOT include [ACTION:], [SELECT:], or [FILTER:] tags.`;

        try {
            const response: QueryResponse = await this.engine.query(prompt, [], true);
            const cleanMessage: string = response.answer
                .replace(/\[ACTION:.*?\]/g, '')
                .replace(/\[SELECT:.*?\]/g, '')
                .replace(/\[FILTER:.*?\]/g, '')
                .trim();
            if (!cleanMessage) {
                return this.response_create(fallback, [], true);
            }
            return this.response_create(cleanMessage, [], true);
        } catch {
            return this.response_create(fallback, [], true);
        }
    }

    // ─── Conversation Context / Anaphora ─────────────────────────────────

    /**
     * Resolve an anaphoric reference ("that", "it", "them", etc.)
     * against the most recently mentioned datasets.
     *
     * Singular tokens return the last-mentioned dataset.
     * Plural tokens return all recently mentioned datasets.
     *
     * @param token - The user's word to resolve (e.g. "that", "them")
     * @returns Matching datasets, or empty array if not an anaphora
     */
    private anaphora_resolve(token: string): Dataset[] {
        const normalized: string = token.toLowerCase().trim();

        if (this.lastMentionedDatasets.length === 0) {
            return [];
        }

        if (CalypsoCore.ANAPHORA_SINGULAR.has(normalized)) {
            // Return the last (most recently) mentioned dataset
            return [this.lastMentionedDatasets[this.lastMentionedDatasets.length - 1]];
        }

        if (CalypsoCore.ANAPHORA_PLURAL.has(normalized)) {
            return [...this.lastMentionedDatasets];
        }

        return [];
    }

    /**
     * Scan text for dataset ID references (ds-XXX) and update
     * the conversation context for future anaphora resolution.
     *
     * @param text - Text to scan (LLM response, search output, etc.)
     */
    private context_updateFromText(text: string): void {
        const idPattern: RegExp = /\bds-(\d{3})\b/gi;
        const mentioned: Dataset[] = [];
        const seen: Set<string> = new Set();
        let match: RegExpExecArray | null;

        while ((match = idPattern.exec(text)) !== null) {
            const id: string = `ds-${match[1]}`;
            if (!seen.has(id)) {
                seen.add(id);
                const dataset: Dataset | undefined = DATASETS.find(
                    (ds: Dataset): boolean => ds.id === id
                );
                if (dataset) {
                    mentioned.push(dataset);
                }
            }
        }

        if (mentioned.length > 0) {
            this.lastMentionedDatasets = mentioned;
        }
    }

    // ─── Workflow Engine Integration ────────────────────────────────────────

    /**
     * Build the workflow context for validation checks.
     *
     * @returns WorkflowContext with store, vfs, and project path
     */
    private workflowContext_build(): WorkflowContext {
        const activeMeta = this.storeActions.project_getActive();
        const username: string = this.shell.env_get('USER') || 'user';
        const projectPath: string = activeMeta
            ? `/home/${username}/projects/${activeMeta.name}`
            : `/home/${username}/projects/DRAFT`;

        return {
            store: {
                selectedDatasets: { length: this.storeActions.datasets_getSelected().length }
            },
            vfs: {
                exists: (path: string): boolean => {
                    const resolved: string = path.replace(/\$\{project\}/g, projectPath);
                    return this.vfs.node_stat(resolved) !== null;
                }
            },
            project: projectPath
        };
    }

    /**
     * Check workflow constraints for a command and return warning if needed.
     *
     * @param cmd - The command being executed
     * @returns TransitionResult with allowed status and warnings
     */
    private workflow_checkTransition(cmd: string): TransitionResult {
        const intent: string | undefined = CalypsoCore.COMMAND_TO_INTENT[cmd];
        if (!intent) {
            // Command not tracked by workflow — allow
            return {
                allowed: true,
                warning: null,
                reason: null,
                suggestion: null,
                skipCount: 0,
                hardBlock: false,
                skippedStageId: null
            };
        }

        const context: WorkflowContext = this.workflowContext_build();
        return WorkflowEngine.transition_check(
            this.workflowState,
            this.workflowDefinition,
            intent,
            context
        );
    }

    /**
     * Format a workflow warning into a user-friendly message.
     *
     * @param transition - The transition result with warning details
     * @returns Formatted warning string
     */
    private workflowWarning_format(transition: TransitionResult): string {
        const lines: string[] = [];
        lines.push(`○ <span class="warning">WARNING: ${transition.warning}</span>`);

        // Include full reason on second+ warning
        if (transition.reason) {
            lines.push('');
            lines.push(transition.reason);
        }

        if (transition.suggestion) {
            lines.push('');
            lines.push(`  → ${transition.suggestion}`);
        }

        return lines.join('\n');
    }

    /**
     * Mark a workflow stage as complete based on the command executed.
     *
     * @param cmd - The command that was executed
     */
    private workflowStage_complete(cmd: string): void {
        const intent: string | undefined = CalypsoCore.COMMAND_TO_INTENT[cmd];
        if (!intent) return;

        const stage = WorkflowEngine.stage_forIntent(this.workflowDefinition, intent);
        if (stage) {
            WorkflowEngine.stage_complete(this.workflowState, stage.id);
        }
    }

    /**
     * Get current workflow progress summary.
     *
     * @returns Human-readable progress string
     */
    public workflow_progress(): string {
        const context: WorkflowContext = this.workflowContext_build();
        return WorkflowEngine.progress_summarize(this.workflowDefinition, context);
    }

    /**
     * Build workflow context string for LLM injection.
     *
     * This gives the LLM awareness of the current workflow state so it can
     * provide appropriate guidance and not suggest skipping required steps.
     *
     * @returns Formatted workflow context for system prompt injection
     */
    private workflowContext_forLLM(): string {
        const context: WorkflowContext = this.workflowContext_build();
        const completedStages: string[] = WorkflowEngine.stages_completed(this.workflowDefinition, context);
        const nextStage = WorkflowEngine.stage_next(this.workflowDefinition, context);
        const activeMeta = this.storeActions.project_getActive();

        const lines: string[] = [];
        lines.push('### CURRENT WORKFLOW STATE');
        lines.push(`- Workflow: ${this.workflowDefinition.name}`);
        lines.push(`- Completed stages: ${completedStages.length > 0 ? completedStages.join(', ') : 'none'}`);

        if (nextStage) {
            lines.push(`- Next required: ${nextStage.id} (${nextStage.name})`);
        } else {
            lines.push('- Status: All stages complete');
        }

        if (activeMeta) {
            lines.push(`- Active project: ${activeMeta.name}`);
        } else {
            lines.push('- Active project: none');
        }

        // Add specific guidance for the LLM based on workflow state
        if (nextStage?.id === 'harmonize') {
            lines.push('');
            lines.push('IMPORTANT: User must run `harmonize` before proceeding to code/training.');
            lines.push('Do NOT suggest skipping harmonization. If user asks to code or train,');
            lines.push('remind them to harmonize first.');
        } else if (nextStage?.id === 'gather' && completedStages.length === 0) {
            lines.push('');
            lines.push('IMPORTANT: User has not started the workflow. Guide them to search for');
            lines.push('datasets first using `search <query>`, then `add <id>` to build a cohort.');
        } else if (nextStage?.id === 'code') {
            lines.push('');
            lines.push('Data is harmonized. User can now proceed to code development with `proceed` or `code`.');
        } else if (nextStage?.id === 'train') {
            lines.push('');
            lines.push('Code scaffolded. User should run local training with `python train.py` before federation.');
        }

        return lines.join('\n');
    }

    /**
     * Generate smart, actionable next-step guidance based on workflow state.
     * Queries VFS markers to determine actual stage completion.
     *
     * @returns Structured guidance with specific command suggestions
     */
    public workflow_nextStep(): string {
        const context: WorkflowContext = this.workflowContext_build();
        const activeMeta = this.storeActions.project_getActive();
        const selectedDatasets: Dataset[] = this.storeActions.datasets_getSelected();
        const nextStage = WorkflowEngine.stage_next(this.workflowDefinition, context);
        const completedStages: string[] = WorkflowEngine.stages_completed(this.workflowDefinition, context);

        const lines: string[] = [];
        lines.push(`● **CALYPSO GUIDANCE** — ${this.workflowDefinition.name}`);
        lines.push('');

        // Check if we have a project
        if (!activeMeta) {
            // No project — user needs to search/gather datasets first
            if (selectedDatasets.length === 0) {
                lines.push('○ You have no datasets selected yet.');
                lines.push('');
                lines.push('**Suggested next step:**');
                lines.push('  `search <query>` — Find datasets (e.g., `search brain MRI`)');
                lines.push('  `add <id>` — Add a dataset to your selection');
                lines.push('');
                lines.push('*Example:* `search histology` then `add ds-006`');
            } else {
                lines.push(`○ You have ${selectedDatasets.length} dataset(s) selected but no active project.`);
                lines.push('');
                lines.push('**Suggested next step:**');
                lines.push('  `gather` — Create a draft project from selected datasets');
            }
            return lines.join('\n');
        }

        // We have an active project
        const projectName: string = activeMeta.name;
        const isDraft: boolean = projectName.startsWith('DRAFT-');

        lines.push(`○ Project: **${projectName}**`);

        // Check if project should be renamed
        if (isDraft) {
            lines.push('');
            lines.push('**Tip:** Give your project a meaningful name:');
            lines.push('  `rename <name>` — e.g., `rename lung-nodule-study`');
        }
        lines.push('');

        // Check workflow stage
        if (!nextStage) {
            // All stages complete
            lines.push('● **Workflow complete!** All stages have been completed.');
            lines.push('');
            const username: string = this.shell.env_get('USER') || 'user';
            const projectBase: string = `/home/${username}/projects/${projectName}`;
            const federationComplete: boolean = this.vfs.node_stat(`${projectBase}/.federated`) !== null;

            lines.push('You can now:');
            if (federationComplete) {
                lines.push('  `tree source-crosscompile` — Inspect materialized DAG artifacts');
                lines.push('  `federate --rerun` — Explicitly restart federation from step 1/5');
            } else {
                lines.push('  `federate` — Start the federated training run');
            }
            return lines.join('\n');
        }

        // Determine what's missing based on the next stage
        const stageId: string = nextStage.id;

        switch (stageId) {
            case 'gather':
                lines.push('**Next step: Gather datasets**');
                lines.push('  `search <query>` — Find relevant datasets');
                lines.push('  `add <id>` — Add to your cohort');
                lines.push('  `gather` — Create project from selection');
                break;

            case 'harmonize':
                lines.push('**Next step: Data Harmonization** ⚠️');
                lines.push('');
                lines.push('Before training, your cohort **must** be standardized for federated learning.');
                lines.push('This ensures consistent image formats, metadata, and quality metrics across all sites.');
                lines.push('');
                lines.push('  `harmonize` — Run the harmonization engine');
                lines.push('');
                lines.push('*This step is required before proceeding to model development.*');
                break;

            case 'code':
                lines.push('**Next step: Model Development**');
                lines.push('');
                lines.push('Your data is harmonized and ready. Now define your model architecture.');
                lines.push('');
                lines.push('  `proceed` or `code` — Scaffold the training environment');
                lines.push('');
                lines.push('This will generate `train.py`, `config.yaml`, and other boilerplate.');
                break;

            case 'train':
                lines.push('**Next step: Local Training**');
                lines.push('');
                lines.push('Test your model locally before federation.');
                lines.push('');
                lines.push('  `python train.py` — Run local training');
                lines.push('  `python train.py --epochs 5` — Quick validation run');
                break;

            case 'federate':
                lines.push('**Next step: Federated Training**');
                lines.push('');
                if (this.federation.currentStep === 'transcompile') {
                    lines.push('Federation Step 1/5 is pending: source transcompile.');
                    lines.push('');
                    lines.push('  `federate --yes` — Execute step 1/5');
                    lines.push('  `federate --abort` — Cancel federation handshake');
                } else if (this.federation.currentStep === 'containerize') {
                    lines.push('Federation Step 2/5 is pending: container compilation.');
                    lines.push('');
                    lines.push('  `federate --yes` — Execute step 2/5');
                    lines.push('  `federate --abort` — Cancel federation handshake');
                } else if (this.federation.currentStep === 'publish_prepare' || this.federation.currentStep === 'publish_configure') {
                    lines.push('Federation Step 3/5 is active: marketplace publish metadata.');
                    lines.push('');
                    lines.push('  `federate --name <app-name>` — Set app name');
                    lines.push('  `federate --org <org>` — Set org/namespace (optional)');
                    lines.push('  `federate --private` — Publish privately');
                    lines.push('  `federate --yes` — Confirm next publish action');
                    lines.push('  `federate --abort` — Cancel federation handshake');
                } else if (this.federation.currentStep === 'dispatch_compute') {
                    lines.push('Federation Step 5/5 is pending: dispatch + federated rounds.');
                    lines.push('');
                    lines.push('  `federate --yes` — Dispatch to participants and run rounds');
                    lines.push('  `federate --abort` — Cancel federation handshake');
                } else {
                    lines.push('Local training complete. Ready to distribute across nodes.');
                    lines.push('');
                    lines.push('  `federate` — Initialize the federation sequence');
                }
                break;

            default:
                lines.push(`**Next stage:** ${nextStage.name}`);
                lines.push(`  Available commands: ${nextStage.intents.map(i => `\`${i.toLowerCase()}\``).join(', ')}`);
        }

        // Show progress indicator
        lines.push('');
        lines.push(`Progress: ${completedStages.length}/${this.workflowDefinition.stages.length} stages complete`);

        return lines.join('\n');
    }

    // ─── NL Action Intent Resolution ────────────────────────────────────

    /**
     * Resolve natural language imperative requests to workflow command keywords.
     *
     * Strips conversational prefixes ("ok", "let's", "please", "run the", etc.)
     * and checks if what remains starts with a known workflow action keyword.
     * This correctly distinguishes imperatives ("do the harmonization") from
     * inquiries ("what is harmonization?") because inquiries don't reduce to
     * a bare action keyword after prefix stripping.
     *
     * @param input - Raw user input
     * @returns Resolved command keyword (e.g., 'harmonize') or null
     */
    private actionIntent_resolve(input: string): string | null {
        const stripped: string = input.toLowerCase()
            .replace(/^(ok|okay|yes|yeah|sure|alright|right|fine|great|good)[,.]?\s*/i, '')
            .replace(/^(let'?s|please|now|then|go\s+ahead(\s+and)?)\s*/i, '')
            .replace(/^(can\s+you|could\s+you|would\s+you)\s*/i, '')
            .replace(/^(do|run|start|execute|perform|begin|launch|initiate)\s+(the\s+)?/i, '')
            .trim();

        if (/^harmoniz/i.test(stripped)) return 'harmonize';
        if (/^federat/i.test(stripped)) return 'federate';
        if (/^gather/i.test(stripped)) return 'gather';
        if (/^scaffold/i.test(stripped)) return 'proceed';

        return null;
    }

    /**
     * Route short yes/no confirmations to active deterministic handshakes.
     */
    private confirmation_dispatch(input: string): CalypsoResponse | null {
        const normalized: string = input.trim().toLowerCase();
        const isAffirm: boolean = /^(yes|y|yeah|yep|sure|ok|okay|go ahead|proceed|continue|do it|affirmative)$/.test(normalized);
        const isReject: boolean = /^(no|n|nope|cancel|abort|stop|negative|not now)$/.test(normalized);

        if (!isAffirm && !isReject) {
            return null;
        }

        if (this.federation.active) {
            return this.workflow_federate([isAffirm ? '--yes' : '--abort']);
        }

        if (!this.federationReady_is()) {
            return null;
        }

        if (isAffirm) {
            // Start federate briefing first; step confirmations should happen
            // only after an explicit federate step prompt is active.
            return this.workflow_federate([]);
        }

        return this.response_create(
            '○ Understood. Federation sequence not started. Run `federate` when you are ready.',
            [],
            true
        );
    }

    /**
     * Returns true when federate is the next required workflow stage.
     */
    private federationReady_is(): boolean {
        const context: WorkflowContext = this.workflowContext_build();
        const nextStage = WorkflowEngine.stage_next(this.workflowDefinition, context);
        return nextStage?.id === 'federate';
    }

    // ─── Workflow Commands ─────────────────────────────────────────────────

    /**
     * Dispatch workflow commands (search, add, gather, mount, etc.).
     * Checks workflow constraints before execution and issues warnings.
     *
     * @param input - Full input string
     * @returns Response if handled, null to fall through to LLM
     */
    private async workflow_dispatch(input: string): Promise<CalypsoResponse | null> {
        const parts: string[] = input.split(/\s+/);
        const cmd: string = parts[0].toLowerCase();
        const args: string[] = parts.slice(1);

        // Check workflow constraints
        const transition: TransitionResult = this.workflow_checkTransition(cmd);
        let warningPrefix: string = '';

        if (!transition.allowed && transition.skippedStageId) {
            // Increment skip counter and format warning
            WorkflowEngine.skip_increment(this.workflowState, transition.skippedStageId);
            warningPrefix = this.workflowWarning_format(transition) + '\n\n';
        }

        // Execute the command
        let response: CalypsoResponse | null = null;

        switch (cmd) {
            case 'search':
                response = this.workflow_search(args.join(' '));
                break;

            case 'add':
                response = await this.workflow_add(args[0]);
                break;

            case 'remove':
            case 'deselect':
                response = this.workflow_remove(args[0]);
                break;

            case 'gather':
            case 'review':
                response = await this.workflow_gather(args[0]);
                break;

            case 'mount':
                response = this.workflow_mount();
                break;

            case 'federate':
                response = this.workflow_federate(args);
                break;

            case 'proceed':
            case 'code':
                response = this.workflow_proceed(args[0]);
                break;

            case 'rename':
                let nameArg: string = args.join(' ');
                if (nameArg.toLowerCase().startsWith('to ')) {
                    nameArg = nameArg.substring(3).trim();
                }
                response = this.workflow_rename(nameArg);
                break;

            case 'harmonize':
                response = this.workflow_harmonize();
                break;

            default:
                return null; // Fall through to LLM
        }

        // If we got a response, prepend warning (if any) and mark stage complete
        if (response) {
            if (warningPrefix && response.success) {
                response.message = warningPrefix + response.message;
            }
            if (response.success) {
                this.workflowStage_complete(cmd);
            }
        }

        return response;
    }

    /**
     * Harmonize the active project's cohort.
     * Returns a special marker __HARMONIZE_ANIMATE__ that CLI adapters
     * can detect to run an interactive terminal animation.
     */
    private workflow_harmonize(): CalypsoResponse {
        const activeMeta = this.storeActions.project_getActive();
        if (!activeMeta) {
            return this.response_create('>> ERROR: NO ACTIVE PROJECT TO HARMONIZE.', [], false);
        }

        const project: Project | undefined = MOCK_PROJECTS.find((p: Project): boolean => p.id === activeMeta.id);
        if (!project) {
            return this.response_create('>> ERROR: PROJECT MODEL NOT FOUND.', [], false);
        }

        project_harmonize(project);

        // Return special marker for CLI to run animation
        // The marker tells the adapter to run harmonization animation
        return this.response_create(
            `__HARMONIZE_ANIMATE__`,
            [],
            true
        );
    }

    /**
     * Rename the active project.
     */
    private workflow_rename(newName: string): CalypsoResponse {
        if (!newName) {
            return this.response_create('Usage: rename <new-name>', [], false);
        }

        const activeMeta = this.storeActions.project_getActive();
        if (!activeMeta) {
            return this.response_create('>> ERROR: NO ACTIVE PROJECT TO RENAME.', [], false);
        }

        const project: Project | undefined = MOCK_PROJECTS.find((p: Project): boolean => p.id === activeMeta.id);
        if (!project) {
            return this.response_create('>> ERROR: PROJECT MODEL NOT FOUND.', [], false);
        }

        // Execute deterministic side effect
        project_rename(project, newName);

        const actions: CalypsoAction[] = [
            { type: 'project_rename', id: project.id, newName }
        ];

        return this.response_create(
            `● PROJECT RENAMED: [${newName}]`,
            actions,
            true
        );
    }

    /**
     * Search the dataset catalog.
     */
    private workflow_search(query: string): CalypsoResponse {
        const q: string = query.toLowerCase();
        const results: Dataset[] = DATASETS.filter((ds: Dataset): boolean =>
            ds.name.toLowerCase().includes(q) ||
            ds.description.toLowerCase().includes(q) ||
            ds.modality.toLowerCase().includes(q) ||
            ds.annotationType.toLowerCase().includes(q) ||
            ds.provider.toLowerCase().includes(q)
        );

        // Update conversation context so "add that" etc. can resolve
        this.lastMentionedDatasets = results;
        const searchSnapshotPath: string | null = this.searchSnapshot_materialize(query, results);
        const searchSnapshotDisplay: string | null = this.searchSnapshot_displayPath(searchSnapshotPath);

        const actions: CalypsoAction[] = [
            { type: 'workspace_render', datasets: results }
        ];

        if (results.length === 0) {
            const snapshotLine: string = searchSnapshotDisplay
                ? `\n○ SEARCH SNAPSHOT: ${searchSnapshotDisplay}`
                : '';
            return this.response_create(
                `○ NO MATCHING DATASETS FOUND FOR "${query}".${snapshotLine}`,
                actions,
                true
            );
        }

        const listing: string = results
            .map((ds: Dataset): string => `  [${ds.id}] ${ds.name} (${ds.modality}/${ds.annotationType})`)
            .join('\n');
        const detailsTable: string = this.searchResultsTable_format(results);
        const snapshotLine: string = searchSnapshotDisplay
            ? `\n○ SEARCH SNAPSHOT: ${searchSnapshotDisplay}`
            : '';

        return this.response_create(
            `● FOUND ${results.length} MATCHING DATASET(S):\n${listing}\n\n${detailsTable}${snapshotLine}`,
            actions,
            true
        );
    }

    /**
     * Materialize a search snapshot artifact under ~/searches.
     *
     * @param query - Raw search query.
     * @param results - Matched datasets.
     * @returns Absolute snapshot path on success, null on failure.
     */
    private searchSnapshot_materialize(query: string, results: Dataset[]): string | null {
        const username: string = this.shell.env_get('USER') || 'user';
        const searchRoot: string = `/home/${username}/searches`;
        const now: Date = new Date();
        const timestamp: string = now.toISOString().replace(/[:.]/g, '-');
        const nonce: string = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        const snapshotPath: string = `${searchRoot}/search-${timestamp}-${nonce}.json`;

        try {
            this.vfs.dir_create(searchRoot);
            this.vfs.file_create(
                snapshotPath,
                JSON.stringify(
                    {
                        query,
                        generatedAt: now.toISOString(),
                        count: results.length,
                        results: results.map((ds: Dataset) => ({
                            id: ds.id,
                            name: ds.name,
                            modality: ds.modality,
                            annotationType: ds.annotationType,
                            provider: ds.provider,
                            imageCount: ds.imageCount
                        }))
                    },
                    null,
                    2
                )
            );
            this.vfs.node_write(`${searchRoot}/latest.txt`, `${snapshotPath}\n`);
            return snapshotPath;
        } catch {
            return null;
        }
    }

    /**
     * Convert an absolute search snapshot path to user-facing ~/ form.
     *
     * @param absolutePath - Absolute path in VFS.
     * @returns Display path or null if input missing.
     */
    private searchSnapshot_displayPath(absolutePath: string | null): string | null {
        if (!absolutePath) return null;
        const username: string = this.shell.env_get('USER') || 'user';
        const homePrefix: string = `/home/${username}`;
        if (absolutePath.startsWith(homePrefix)) {
            return absolutePath.replace(homePrefix, '~');
        }
        return absolutePath;
    }

    /**
     * Format full dataset details as a markdown table for terminal/web rendering.
     *
     * @param results - Search result datasets.
     * @returns Markdown table string.
     */
    private searchResultsTable_format(results: Dataset[]): string {
        return results.map((ds: Dataset, index: number): string => {
            const safeName: string = this.searchResultsTable_cell(ds.name);
            const safeProvider: string = this.searchResultsTable_cell(ds.provider);
            const safeDescription: string = this.searchResultsTable_cell(ds.description);
            const lines: string[] = [
                `### DATASET ${index + 1}/${results.length}`,
                '| Field | Value |',
                '|---|---|',
                `| ID | ${ds.id} |`,
                `| Name | ${safeName} |`,
                `| Modality | ${ds.modality} |`,
                `| Annotation | ${ds.annotationType} |`,
                `| Images | ${ds.imageCount.toLocaleString()} |`,
                `| Size | ${ds.size} |`,
                `| Cost | $${ds.cost.toFixed(2)} |`,
                `| Provider | ${safeProvider} |`,
                `| Description | ${safeDescription} |`
            ];
            return lines.join('\n');
        }).join('\n\n');
    }

    /**
     * Normalize text for markdown table cell rendering.
     *
     * @param value - Raw table cell text.
     * @returns Sanitized cell text.
     */
    private searchResultsTable_cell(value: string): string {
        return value
            .replace(/\|/g, '/')
            .replace(/\r?\n/g, ' ')
            .trim();
    }

    /**
     * Add a dataset to the selection.
     *
     * Resolution order:
     *   1. Exact dataset ID match (e.g. "ds-006")
     *   2. Name substring match (e.g. "histology")
     *   3. Anaphora resolution (e.g. "that", "it", "this")
     */
    private workflow_add(targetId: string): CalypsoResponse {
        if (!targetId) {
            return this.response_create('Usage: add <dataset-id>', [], false);
        }

        // 1. Exact ID or name substring match
        let dataset: Dataset | undefined = DATASETS.find((ds: Dataset): boolean =>
            ds.id === targetId || ds.name.toLowerCase().includes(targetId.toLowerCase())
        );

        // 2. Anaphora resolution ("that", "it", "this", etc.)
        if (!dataset) {
            const resolved: Dataset[] = this.anaphora_resolve(targetId);
            if (resolved.length > 0) {
                dataset = resolved[0];
            }
        }

        if (!dataset) {
            return this.response_create(
                `>> ERROR: DATASET "${targetId}" NOT FOUND.`,
                [],
                false
            );
        }

        // Update context: the just-added dataset is now "that"
        this.lastMentionedDatasets = [dataset];

        // Delegate to ProjectManager to handle draft creation and VFS mounting
        const activeProject = project_gather(dataset);

        const actions: CalypsoAction[] = [
            { type: 'dataset_select', id: dataset.id }
        ];

        return this.response_create(
            `● DATASET GATHERED: ${dataset.name} [${dataset.id}]\n○ MOUNTED TO [${activeProject.name}]`,
            actions,
            true
        );
    }

    /**
     * Remove a dataset from the selection.
     */
    private workflow_remove(targetId: string): CalypsoResponse {
        if (!targetId) {
            return this.response_create('Usage: remove <dataset-id>', [], false);
        }

        this.storeActions.dataset_deselect(targetId);

        const actions: CalypsoAction[] = [
            { type: 'dataset_deselect', id: targetId }
        ];

        return this.response_create(
            `● DATASET REMOVED: ${targetId}`,
            actions,
            true
        );
    }

    /**
     * Review gathered datasets. Optionally adds a dataset first.
     * Supports anaphora: "gather that" adds the last-mentioned dataset,
     * "gather them" / "gather those" adds all recently mentioned datasets.
     */
    private workflow_gather(targetId?: string): CalypsoResponse {
        if (targetId) {
            // Check for plural anaphora first (e.g. "gather them", "gather those")
            const resolved: Dataset[] = this.anaphora_resolve(targetId);
            if (resolved.length > 1) {
                // Add all resolved datasets
                for (const ds of resolved) {
                    this.workflow_add(ds.id);
                }
            } else {
                // Single add (handles direct IDs, names, and singular anaphora)
                this.workflow_add(targetId);
            }
        }

        const datasets: Dataset[] = this.storeActions.datasets_getSelected();

        if (datasets.length === 0) {
            return this.response_create(
                '○ NO DATASETS IN SELECTION BUFFER. USE "search" AND "add" FIRST.',
                [],
                true
            );
        }

        const listing: string = datasets
            .map((ds: Dataset): string => `  [${ds.id}] ${ds.name}`)
            .join('\n');

        const actions: CalypsoAction[] = [
            { type: 'stage_advance', stage: 'gather' }
        ];

        return this.response_create(
            `● COHORT REVIEW: ${datasets.length} DATASET(S) SELECTED:\n${listing}`,
            actions,
            true
        );
    }

    /**
     * Mount VFS and proceed to process stage.
     */
    private workflow_mount(): CalypsoResponse {
        const actions: CalypsoAction[] = [
            { type: 'stage_advance', stage: 'process' }
        ];

        return this.response_create(
            '● MOUNTING VIRTUAL FILESYSTEM...\n>> MOUNT COMPLETE. FILESYSTEM READY.',
            actions,
            true
        );
    }

    /**
     * Start or advance the federation sequence.
     * Delegates to FederationOrchestrator.
     */
    private workflow_federate(rawArgs: string[] = []): CalypsoResponse {
        const username = this.shell.env_get('USER') || 'user';
        return this.federation.federate(rawArgs, username);
    }

    /**
     * Proceed to coding/process stage.
     */
    private workflow_proceed(workflowTypeRaw?: string): CalypsoResponse {
        const workflowType: 'fedml' | 'chris' | null = this.proceedWorkflow_resolve(workflowTypeRaw);
        if (!workflowType) {
            return this.response_create(
                `Unsupported workflow: ${workflowTypeRaw}\nSupported: fedml, chris`,
                [],
                false
            );
        }

        const activeMeta = this.storeActions.project_getActive();
        if (!activeMeta) {
            return this.response_create('>> ERROR: NO ACTIVE PROJECT CONTEXT.', [], false);
        }

        const project: Project | undefined = MOCK_PROJECTS.find(
            (p: Project): boolean => p.id === activeMeta.id
        );
        if (!project) {
            return this.response_create('>> ERROR: PROJECT MODEL NOT FOUND.', [], false);
        }

        const username: string = this.shell.env_get('USER') || 'user';
        const projectBase: string = `/home/${username}/projects/${project.name}`;

        if (workflowType === 'chris') {
            chrisProject_populate(this.vfs, username, project.name);
            this.shell.env_set('PERSONA', 'appdev');
        } else {
            projectDir_populate(this.vfs, username, project.name);
            this.shell.env_set('PERSONA', 'fedml');
        }

        try {
            this.vfs.dir_create(`${projectBase}/output`);
        } catch {
            // output already exists
        }

        const actions: CalypsoAction[] = [
            { type: 'stage_advance', stage: 'process', workflow: workflowType }
        ];

        return this.response_create(
            `● AFFIRMATIVE. INITIATING CODE PROTOCOLS (${workflowType.toUpperCase()}).`,
            actions,
            true
        );
    }

    /**
     * Resolve workflow target for `proceed`/`code`.
     *
     * Resolution order:
     * 1. Explicit command argument (`proceed fedml|chris`)
     * 2. Active workflow selection (`workflow_set`)
     * 3. Persona environment hint (`PERSONA`)
     * 4. Default fallback (`fedml`)
     *
     * @param workflowTypeRaw - Optional explicit workflow argument.
     * @returns Resolved workflow or null if explicit argument is invalid.
     */
    private proceedWorkflow_resolve(workflowTypeRaw?: string): 'fedml' | 'chris' | null {
        if (workflowTypeRaw) {
            const normalized: string = workflowTypeRaw.toLowerCase();
            if (normalized === 'fedml' || normalized === 'chris') {
                return normalized;
            }
            return null;
        }

        const selectedWorkflow: string = this.workflow_get();
        if (selectedWorkflow === 'fedml' || selectedWorkflow === 'chris') {
            return selectedWorkflow;
        }

        const persona: string = (this.shell.env_get('PERSONA') || '').toLowerCase();
        if (persona === 'appdev' || persona === 'chris') return 'chris';
        if (persona === 'fedml') return 'fedml';

        return 'fedml';
    }

    // ─── LLM Integration ───────────────────────────────────────────────────

    /**
     * Query the LLM for natural language processing.
     * Injects workflow context so LLM is aware of current state.
     */
    private async llm_query(input: string): Promise<CalypsoResponse> {
        if (!this.engine) {
            return this.response_create(
                '>> WARNING: AI CORE OFFLINE. USE WORKFLOW COMMANDS.',
                [],
                false
            );
        }

        const selectedIds: string[] = this.storeActions.datasets_getSelected()
            .map((ds: Dataset): string => ds.id);

        // Build workflow context for LLM awareness
        const workflowContext: string = this.workflowContext_forLLM();

        try {
            const response: QueryResponse = await this.engine.query(
                input,
                selectedIds,
                false,
                workflowContext
            );
            return this.llmResponse_process(response);
        } catch (e: unknown) {
            const errorMsg: string = e instanceof Error ? e.message : 'UNKNOWN ERROR';
            return this.response_create(
                `>> ERROR: AI QUERY FAILED. ${errorMsg}`,
                [],
                false
            );
        }
    }

    /**
     * Process LLM response and extract intents/actions.
     */
    private llmResponse_process(response: QueryResponse): CalypsoResponse {
        const actions: CalypsoAction[] = [];

        // Update conversation context from dataset IDs mentioned in LLM response
        this.context_updateFromText(response.answer);

        // Extract [SELECT: ds-xxx] intent
        const selectMatch: RegExpMatchArray | null = response.answer.match(/\[SELECT: (ds-[0-9]+)\]/);
        if (selectMatch) {
            const dsId = selectMatch[1];
            // CRITICAL: Ensure VFS mounting happens for AI selections
            // We call workflow_add to trigger project_gather() and draft creation
            this.workflow_add(dsId);
            actions.push({ type: 'dataset_open', id: dsId });
        }

        // Extract [ACTION: PROCEED <type>] intent
        // Type can be 'fedml' or 'chris' - only scaffold if type is specified
        const proceedMatch: RegExpMatchArray | null = response.answer.match(/\[ACTION: PROCEED(?:\s+(fedml|chris))?\]/i);
        if (proceedMatch) {
            const workflowType: 'fedml' | 'chris' | undefined = proceedMatch[1]?.toLowerCase() as 'fedml' | 'chris' | undefined;

            // Only scaffold if workflow type is explicitly specified
            if (workflowType) {
                const activeMeta = this.storeActions.project_getActive();
                if (activeMeta) {
                    const project: Project | undefined = MOCK_PROJECTS.find((p: Project): boolean => p.id === activeMeta.id);
                    if (project) {
                        const username: string = this.shell.env_get('USER') || 'developer';
                        const projectBase: string = `/home/${username}/projects/${project.name}`;

                        // Create src/ with scaffolding based on workflow type
                        if (workflowType === 'fedml') {
                            projectDir_populate(this.vfs, username, project.name);
                        } else if (workflowType === 'chris') {
                            chrisProject_populate(this.vfs, username, project.name);
                        }

                        // Create output/ directory
                        try {
                            this.vfs.dir_create(`${projectBase}/output`);
                        } catch { /* already exists */ }

                        // Update shell stage and persona
                        this.shell.env_set('STAGE', 'process');
                        this.shell.env_set('PERSONA', workflowType);
                    }
                }
                actions.push({ type: 'stage_advance', stage: 'process', workflow: workflowType });
            }
            // If no workflow type specified, Calypso should have asked - no action needed
        }

        // Extract [ACTION: SHOW_DATASETS] intent
        if (response.answer.includes('[ACTION: SHOW_DATASETS]')) {
            let datasetsToShow: Dataset[] = response.relevantDatasets;

            const filterMatch: RegExpMatchArray | null = response.answer.match(/\[FILTER: (.*?)\]/);
            if (filterMatch) {
                const ids: string[] = filterMatch[1].split(',').map((s: string): string => s.trim());
                datasetsToShow = datasetsToShow.filter((ds: Dataset): boolean => ids.includes(ds.id));
            }

            actions.push({ type: 'workspace_render', datasets: datasetsToShow });
        }

        // Extract [ACTION: RENAME xxx] intent
        const renameMatch: RegExpMatchArray | null = response.answer.match(/\[ACTION: RENAME (.*?)\]/);
        if (renameMatch) {
            const newName: string = renameMatch[1].trim();
            const activeMeta = this.storeActions.project_getActive();
            
            if (activeMeta) {
                // Find full project object to pass to logic
                const project: Project | undefined = MOCK_PROJECTS.find((p: Project): boolean => p.id === activeMeta.id);
                if (project) {
                    // CRITICAL: Execute side effect for Headless VFS
                    project_rename(project, newName);
                }
                actions.push({ type: 'project_rename', id: activeMeta.id, newName });
            }
        }

        // Extract [ACTION: HARMONIZE] intent — execute + return animation marker
        if (response.answer.includes('[ACTION: HARMONIZE]')) {
            const activeMeta = this.storeActions.project_getActive();
            if (activeMeta) {
                const project: Project | undefined = MOCK_PROJECTS.find((p: Project): boolean => p.id === activeMeta.id);
                if (project) {
                    project_harmonize(project);
                    return this.response_create('__HARMONIZE_ANIMATE__', [], true);
                }
            }
        }

        // Clean up the answer (remove intent markers)
        const cleanAnswer: string = response.answer
            .replace(/\[SELECT: ds-[0-9]+\]/g, '')
            .replace(/\[ACTION: PROCEED(?:\s+(?:fedml|chris))?\]/gi, '')
            .replace(/\[ACTION: SHOW_DATASETS\]/g, '')
            .replace(/\[FILTER:.*?\]/g, '')
            .replace(/\[ACTION: RENAME.*?\]/g, '')
            .replace(/\[ACTION: HARMONIZE\]/g, '')
            .trim();

        return this.response_create(cleanAnswer, actions, true);
    }

    // ─── Helpers ───────────────────────────────────────────────────────────

    /**
     * Create a CalypsoResponse object.
     */
    private response_create(
        message: string,
        actions: CalypsoAction[],
        success: boolean
    ): CalypsoResponse {
        return { message, actions, success };
    }

    /**
     * Serialize a FileNode to a VfsSnapshotNode.
     */
    private node_serialize(node: FileNode, includeContent: boolean): VfsSnapshotNode {
        const serialized: VfsSnapshotNode = {
            name: node.name,
            type: node.type,
            path: node.path
        };

        if (node.type === 'file') {
            serialized.size = node.size;
            if (includeContent && node.content !== null) {
                serialized.content = node.content;
            }
            if (node.contentGenerator) {
                serialized.hasGenerator = true;
            }
        }

        if (node.type === 'folder' && node.children) {
            serialized.children = node.children
                .map((child: FileNode): VfsSnapshotNode => this.node_serialize(child, includeContent))
                .sort((a: VfsSnapshotNode, b: VfsSnapshotNode): number => a.name.localeCompare(b.name));
        }

        return serialized;
    }
}
