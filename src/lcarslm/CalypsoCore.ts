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
    VfsSnapshotNode,
    QueryResponse
} from './types.js';
import type { Dataset, AppState, Project } from '../core/models/types.js';
import { DATASETS } from '../core/data/datasets.js';
import { MOCK_PROJECTS } from '../core/data/projects.js';
import { project_gather, project_rename, project_harmonize } from '../core/logic/ProjectManager.js';
import { projectDir_populate, chrisProject_populate } from '../vfs/providers/ProjectProvider.js';
import { VERSION } from '../generated/version.js';
import { WorkflowEngine } from '../core/workflows/WorkflowEngine.js';
import {
    script_find,
    scripts_list,
    type CalypsoScript,
    type CalypsoStructuredScript,
    type CalypsoStructuredStep
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

type FederationVisibility = 'public' | 'private';
type FederationStep = 'transcompile' | 'containerize' | 'publish_prepare' | 'publish_configure' | 'dispatch_compute';

interface FederationPublishConfig {
    appName: string | null;
    org: string | null;
    visibility: FederationVisibility;
}

interface FederationState {
    projectId: string;
    step: FederationStep;
    publish: FederationPublishConfig;
}

interface FederationDagPaths {
    crosscompileBase: string;
    crosscompileData: string;
    containerizeBase: string;
    containerizeData: string;
    publishBase: string;
    publishData: string;
    dispatchBase: string;
    dispatchData: string;
    dispatchReceipts: string;
    roundsBase: string;
    roundsData: string;
}

interface FederationArgs {
    confirm: boolean;
    abort: boolean;
    restart: boolean;
    name: string | null;
    org: string | null;
    visibility: FederationVisibility | null;
}

interface ScriptRuntimeContext {
    defaults: Record<string, string>;
    answers: Record<string, string>;
    outputs: Record<string, unknown>;
}

interface ScriptPendingInput {
    kind: 'param' | 'selection';
    key: string;
    prompt: string;
    options?: string[];
}

interface ScriptRuntimeSession {
    script: CalypsoScript;
    spec: CalypsoStructuredScript;
    stepIndex: number;
    context: ScriptRuntimeContext;
    actions: CalypsoAction[];
    pending: ScriptPendingInput | null;
}

interface ScriptStepParamsResolved {
    ok: true;
    params: Record<string, unknown>;
}

interface ScriptStepParamsPending {
    ok: false;
    pending: ScriptPendingInput;
}

type ScriptStepParamResolution = ScriptStepParamsResolved | ScriptStepParamsPending;

interface ScriptValueResolved {
    ok: true;
    value: unknown;
}

interface ScriptValuePending {
    ok: false;
    pending: ScriptPendingInput;
}

type ScriptValueResolution = ScriptValueResolved | ScriptValuePending;

interface ScriptStepExecutionSuccess {
    success: true;
    output?: unknown;
    actions: CalypsoAction[];
    summary?: string;
}

interface ScriptStepExecutionFailure {
    success: false;
    actions: CalypsoAction[];
    message?: string;
}

interface ScriptStepExecutionPending {
    success: 'pending';
    pending: ScriptPendingInput;
    actions: CalypsoAction[];
}

type ScriptStepExecutionResult =
    ScriptStepExecutionSuccess
    | ScriptStepExecutionFailure
    | ScriptStepExecutionPending;

interface ScriptSuggestionScore {
    id: string;
    score: number;
}

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

    /** Multi-phase federation handshake state. */
    private federationState: FederationState | null = null;

    /** Active structured script runtime session awaiting completion/input. */
    private scriptRuntime: ScriptRuntimeSession | null = null;

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
        const scriptPromptResult: CalypsoResponse | null = await this.scriptRuntime_maybeConsumeInput(trimmed);
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
            return this.scripts_response(parts.slice(1));
        }

        if (primaryCommand === 'run') {
            return this.script_execute(parts.slice(1));
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
        this.federationState = null;
        this.scriptRuntime = null;
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
                return this.scripts_response(args);
            }

            case 'run': {
                return this.script_execute(args);
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
     * Build script catalog response or script detail response.
     *
     * @param args - Optional script name argument.
     * @returns Formatted response text.
     */
    private scripts_response(args: string[]): CalypsoResponse {
        const targetRaw: string = args.join(' ').trim();
        if (!targetRaw) {
            const lines: string[] = [
                '● Yes. I can show you the available power scripts now.',
                '○ Tip: You can type `/scripts` anytime to see this list.',
                '',
                'POWER SCRIPTS AVAILABLE:',
                ''
            ];

            const scripts: ReadonlyArray<CalypsoScript> = scripts_list();
            scripts.forEach((script: CalypsoScript, idx: number): void => {
                lines.push(`  ${idx + 1}. ${script.id} - ${script.description}`);
            });

            lines.push('');
            lines.push('Use: /scripts [name] or /run [name]');
            return this.response_create(lines.join('\n'), [], true);
        }

        const script: CalypsoScript | null = script_find(targetRaw);
        if (!script) {
            return this.response_create(this.scriptNotFound_message(targetRaw), [], false);
        }

        const lines: string[] = [
            `● SCRIPT: ${script.id}`,
            `○ DESCRIPTION: ${script.description}`,
            `○ TARGET: ${script.target}`,
            `○ REQUIRES: ${script.requires.length > 0 ? script.requires.join(', ') : 'none'}`,
            ''
        ];

        script.steps.forEach((step: string, idx: number): void => {
            lines.push(`  ${idx + 1}. ${step}`);
        });

        lines.push('');
        lines.push(`Run: /run [${script.id}]`);
        return this.response_create(lines.join('\n'), [], true);
    }

    /**
     * Execute a built-in script deterministically.
     *
     * Supports:
     * - `/run [name]`
     * - `/run --dry [name]`
     * - `run [name]`
     *
     * @param args - Script command arguments.
     * @returns Execution summary and aggregated actions.
     */
    private async script_execute(args: string[]): Promise<CalypsoResponse> {
        let dryRun: boolean = false;
        let scriptRef: string = '';

        if (args[0] === '--dry' || args[0] === '-n') {
            dryRun = true;
            scriptRef = args.slice(1).join(' ').trim();
        } else {
            scriptRef = args.join(' ').trim();
        }

        if (!scriptRef) {
            return this.response_create('Usage: /run [script] OR /run --dry [script]', [], false);
        }

        const script: CalypsoScript | null = script_find(scriptRef);
        if (!script) {
            return this.response_create(this.scriptNotFound_message(scriptRef), [], false);
        }

        const unmetRequirement: string | null = this.scriptRequirement_unmet(script.requires);
        if (unmetRequirement) {
            return this.response_create(`>> ERROR: SCRIPT REQUIREMENT FAILED (${unmetRequirement})`, [], false);
        }

        if (dryRun) {
            return this.scriptDryRun_response(script);
        }

        if (script.structured) {
            return this.scriptStructured_begin(script);
        }

        const lines: string[] = [
            `● RUNNING SCRIPT: ${script.id}`,
            `○ ${script.description}`
        ];
        const actions: CalypsoAction[] = [];

        for (let i: number = 0; i < script.steps.length; i++) {
            const step: string = script.steps[i];
            const trimmedStep: string = step.trim();
            if (/^\/?(run|scripts)\b/i.test(trimmedStep)) {
                return this.response_create(
                    `>> ERROR: SCRIPT "${script.id}" CONTAINS NESTED SCRIPT COMMAND AT STEP ${i + 1}.`,
                    actions,
                    false
                );
            }

            const result: CalypsoResponse = await this.command_execute(trimmedStep);
            actions.push(...result.actions);

            const summary: string | null = this.scriptStep_summary(result.message);

            if (!result.success) {
                lines.push(`[FAIL] [${i + 1}/${script.steps.length}] ${trimmedStep}`);
                if (summary) lines.push(`  -> ${summary}`);
                lines.push(`>> SCRIPT ABORTED AT STEP ${i + 1}.`);
                if (result.message && result.message !== '__HARMONIZE_ANIMATE__' && !summary) {
                    lines.push(result.message);
                }
                return this.response_create(lines.join('\n'), actions, false);
            }

            lines.push(`[OK] [${i + 1}/${script.steps.length}] ${trimmedStep}`);
            if (summary) lines.push(`  -> ${summary}`);
        }

        lines.push('');
        lines.push(`● SCRIPT COMPLETE. TARGET ${script.target.toUpperCase()} READY.`);
        return this.response_create(lines.join('\n'), actions, true);
    }

    /**
     * Render dry-run output for legacy or structured scripts.
     */
    private scriptDryRun_response(script: CalypsoScript): CalypsoResponse {
        const lines: string[] = [
            `● DRY RUN: ${script.id}`,
            `○ TARGET: ${script.target}`,
            `○ REQUIRES: ${script.requires.length > 0 ? script.requires.join(', ') : 'none'}`,
            ''
        ];

        if (script.structured) {
            const spec: CalypsoStructuredScript = script.structured;
            lines.push(`○ MODE: structured v${spec.version}`);
            if (spec.description) {
                lines.push(`○ ${spec.description}`);
            }
            lines.push('');
            spec.steps.forEach((step: CalypsoStructuredStep, idx: number): void => {
                lines.push(`  ${idx + 1}. ${step.id} :: ${step.action}`);
            });
            return this.response_create(lines.join('\n'), [], true);
        }

        script.steps.forEach((step: string, idx: number): void => {
            lines.push(`  ${idx + 1}. ${step}`);
        });
        return this.response_create(lines.join('\n'), [], true);
    }

    /**
     * Initialize structured script execution state and run until next prompt/completion.
     */
    private async scriptStructured_begin(script: CalypsoScript): Promise<CalypsoResponse> {
        const spec: CalypsoStructuredScript | undefined = script.structured;
        if (!spec) {
            return this.response_create(`>> ERROR: SCRIPT ${script.id} HAS NO STRUCTURED SPEC.`, [], false);
        }

        this.scriptRuntime = {
            script,
            spec,
            stepIndex: 0,
            context: {
                defaults: { ...(spec.defaults || {}) },
                answers: {},
                outputs: {}
            },
            actions: [],
            pending: null
        };

        const lines: string[] = [
            `● RUNNING SCRIPT: ${script.id}`,
            `○ ${script.description}`,
            `○ MODE: structured v${spec.version}`
        ];
        return this.scriptStructured_continue(lines);
    }

    /**
     * Consume user input for an active structured script prompt if present.
     */
    private async scriptRuntime_maybeConsumeInput(input: string): Promise<CalypsoResponse | null> {
        const session: ScriptRuntimeSession | null = this.scriptRuntime;
        if (!session || !session.pending) {
            return null;
        }

        if (input.trim().startsWith('/')) {
            return null;
        }

        if (/^\/?(abort|cancel)$/i.test(input.trim())) {
            const scriptId: string = session.script.id;
            this.scriptRuntime = null;
            return this.response_create(`○ SCRIPT ABORTED: ${scriptId}`, [], false);
        }

        const normalized: string = input.trim() === '-' ? '' : input.trim();
        session.context.answers[session.pending.key] = normalized;
        session.pending = null;
        return this.scriptStructured_continue();
    }

    /**
     * Continue structured script execution from current step.
     */
    private async scriptStructured_continue(prefixLines: string[] = []): Promise<CalypsoResponse> {
        const session: ScriptRuntimeSession | null = this.scriptRuntime;
        if (!session) {
            return this.response_create('>> ERROR: NO ACTIVE SCRIPT RUNTIME.', [], false);
        }

        const lines: string[] = [...prefixLines];
        const totalSteps: number = session.spec.steps.length;

        while (session.stepIndex < totalSteps) {
            const step: CalypsoStructuredStep = session.spec.steps[session.stepIndex];
            const progress: string = `${session.stepIndex + 1}/${totalSteps}`;

            const resolved: ScriptStepParamResolution = this.scriptStructured_stepParamsResolve(step, session.context);
            if (!resolved.ok) {
                session.pending = resolved.pending;
                lines.push(`[WAIT] [${progress}] ${step.id} :: ${step.action}`);
                lines.push('● SCRIPT INPUT REQUIRED.');
                lines.push(`○ ${resolved.pending.prompt}`);
                if (resolved.pending.options && resolved.pending.options.length > 0) {
                    lines.push(...resolved.pending.options);
                }
                lines.push('○ Reply with a value, or type abort.');
                return this.response_create(lines.join('\n'), [...session.actions], true);
            }

            const execution: ScriptStepExecutionResult = await this.scriptStructured_stepExecute(step, resolved.params, session);
            session.actions.push(...execution.actions);

            if (execution.success === 'pending') {
                session.pending = execution.pending;
                lines.push(`[WAIT] [${progress}] ${step.id} :: ${step.action}`);
                lines.push('● SCRIPT INPUT REQUIRED.');
                lines.push(`○ ${execution.pending.prompt}`);
                if (execution.pending.options && execution.pending.options.length > 0) {
                    lines.push(...execution.pending.options);
                }
                lines.push('○ Reply with a value, or type abort.');
                return this.response_create(lines.join('\n'), [...session.actions], true);
            }

            if (!execution.success) {
                lines.push(`[FAIL] [${progress}] ${step.id} :: ${step.action}`);
                if (execution.message) {
                    lines.push(`>> ${execution.message}`);
                }
                lines.push(`>> SCRIPT ABORTED AT STEP ${session.stepIndex + 1}.`);
                const actions: CalypsoAction[] = [...session.actions];
                this.scriptRuntime = null;
                return this.response_create(lines.join('\n'), actions, false);
            }

            lines.push(`[OK] [${progress}] ${step.id} :: ${step.action}`);
            if (execution.summary) {
                lines.push(`  -> ${execution.summary}`);
            }

            const alias: string | undefined = step.outputs?.alias;
            if (alias) {
                session.context.outputs[alias] = execution.output !== undefined ? execution.output : resolved.params;
            }

            session.stepIndex += 1;
        }

        lines.push('');
        lines.push(`● SCRIPT COMPLETE. TARGET ${session.script.target.toUpperCase()} READY.`);
        const actions: CalypsoAction[] = [...session.actions];
        this.scriptRuntime = null;
        return this.response_create(lines.join('\n'), actions, true);
    }

    /**
     * Resolve structured step params using defaults/answers/aliases.
     */
    private scriptStructured_stepParamsResolve(step: CalypsoStructuredStep, runtime: ScriptRuntimeContext): ScriptStepParamResolution {
        const resolved: Record<string, unknown> = {};
        const entries: Array<[string, unknown]> = Object.entries(step.params || {});

        for (const [key, value] of entries) {
            const valueResult: ScriptValueResolution = this.scriptStructured_valueResolve(value, runtime, step.id, key);
            if (!valueResult.ok) {
                return { ok: false, pending: valueResult.pending };
            }
            resolved[key] = valueResult.value;
        }

        return { ok: true, params: resolved };
    }

    /**
     * Resolve one structured value.
     */
    private scriptStructured_valueResolve(
        value: unknown,
        runtime: ScriptRuntimeContext,
        stepId: string,
        paramKey: string
    ): ScriptValueResolution {
        if (Array.isArray(value)) {
            const out: unknown[] = [];
            for (let i: number = 0; i < value.length; i++) {
                const itemResult: ScriptValueResolution = this.scriptStructured_valueResolve(
                    value[i],
                    runtime,
                    stepId,
                    `${paramKey}[${i}]`
                );
                if (!itemResult.ok) return itemResult;
                out.push(itemResult.value);
            }
            return { ok: true, value: out };
        }

        if (typeof value === 'object' && value !== null) {
            const out: Record<string, unknown> = {};
            for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
                const nestedResult: ScriptValueResolution = this.scriptStructured_valueResolve(
                    nested,
                    runtime,
                    stepId,
                    key
                );
                if (!nestedResult.ok) return nestedResult;
                out[key] = nestedResult.value;
            }
            return { ok: true, value: out };
        }

        if (typeof value !== 'string') {
            return { ok: true, value };
        }

        const trimmed: string = value.trim();
        if (trimmed === '?') {
            if (runtime.answers[paramKey] !== undefined) {
                return { ok: true, value: runtime.answers[paramKey] };
            }

            const promptMap: Record<string, string> = {
                query: 'Search term?',
                project: 'Project name?',
                project_name: 'Project name?',
                app_name: 'Application name for marketplace publish?',
                org: 'Organization/namespace? (type - for none)'
            };
            return {
                ok: false,
                pending: {
                    kind: 'param',
                    key: paramKey,
                    prompt: promptMap[paramKey] || `Value for ${stepId}.${paramKey}?`
                }
            };
        }

        const fullRef: RegExpMatchArray | null = value.match(/^\$\{([^}]+)\}$/);
        if (fullRef) {
            const resolved: unknown = this.scriptStructured_expressionResolve(fullRef[1], runtime);
            return { ok: true, value: resolved };
        }

        const interpolated: string = value.replace(/\$\{([^}]+)\}/g, (_m: string, expr: string): string => {
            const resolved: unknown = this.scriptStructured_expressionResolve(expr, runtime);
            return resolved === undefined || resolved === null ? '' : String(resolved);
        });
        return { ok: true, value: interpolated };
    }

    /**
     * Evaluate `${expr}` references with `??` fallback.
     */
    private scriptStructured_expressionResolve(expr: string, runtime: ScriptRuntimeContext): unknown {
        const scope: Record<string, unknown> = {
            answers: runtime.answers,
            defaults: runtime.defaults,
            ...runtime.outputs
        };
        const parts: string[] = expr.split('??').map((part: string): string => part.trim());
        for (const part of parts) {
            if (!part) continue;
            const resolved: unknown = this.scriptStructured_referenceResolve(part, scope);
            if (resolved !== undefined && resolved !== null && resolved !== '') {
                return resolved;
            }
        }
        return undefined;
    }

    /**
     * Resolve dotted and indexed references like `foo.bar[0].id`.
     */
    private scriptStructured_referenceResolve(pathExpr: string, scope: Record<string, unknown>): unknown {
        const tokens: Array<string | number> = [];
        const tokenPattern: RegExp = /([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]/g;
        let match: RegExpExecArray | null;
        while ((match = tokenPattern.exec(pathExpr)) !== null) {
            if (match[1]) tokens.push(match[1]);
            else if (match[2]) tokens.push(parseInt(match[2], 10));
        }
        if (tokens.length === 0) return undefined;

        let current: unknown = scope;
        for (const token of tokens) {
            if (typeof token === 'number') {
                if (!Array.isArray(current) || token < 0 || token >= current.length) return undefined;
                current = current[token];
                continue;
            }
            if (typeof current !== 'object' || current === null || !(token in (current as Record<string, unknown>))) {
                return undefined;
            }
            current = (current as Record<string, unknown>)[token];
        }
        return current;
    }

    /**
     * Execute one structured script step action.
     */
    private async scriptStructured_stepExecute(
        step: CalypsoStructuredStep,
        params: Record<string, unknown>,
        session: ScriptRuntimeSession
    ): Promise<ScriptStepExecutionResult> {
        const runCommand = async (command: string): Promise<ScriptStepExecutionResult> => {
            const response: CalypsoResponse = await this.command_execute(command);
            if (!response.success) {
                return {
                    success: false,
                    actions: response.actions,
                    message: this.scriptStep_summary(response.message) || response.message || `command failed: ${command}`
                };
            }
            return {
                success: true,
                actions: response.actions,
                summary: this.scriptStep_summary(response.message) || undefined
            };
        };

        switch (step.action) {
            case 'search': {
                const query: string = String(params.query || '').trim();
                if (!query) {
                    return { success: false, actions: [], message: 'missing query for search step' };
                }
                const run: ScriptStepExecutionResult = await runCommand(`search ${query}`);
                if (run.success !== true) return run;
                return {
                    success: true,
                    actions: run.actions,
                    summary: run.summary,
                    output: [...this.lastMentionedDatasets]
                };
            }

            case 'select_dataset': {
                const rawCandidates: unknown = params.from;
                const candidates: Dataset[] = Array.isArray(rawCandidates)
                    ? rawCandidates as Dataset[]
                    : [];
                if (candidates.length === 0) {
                    return { success: false, actions: [], message: 'no dataset candidates available for selection' };
                }

                const strategy: string = String(params.strategy || 'ask').toLowerCase();
                let selected: Dataset | null = null;

                if (strategy === 'first' || strategy === 'best_match') {
                    selected = candidates[0];
                } else if (strategy === 'by_id') {
                    const desired: string = String(params.id || params.dataset || '').trim().toLowerCase();
                    selected = candidates.find((ds: Dataset): boolean => ds.id.toLowerCase() === desired) || null;
                } else {
                    if (candidates.length === 1) {
                        selected = candidates[0];
                    } else {
                        const answerKey: string = `${step.id}.selection`;
                        const rawChoice: string = (session.context.answers[answerKey] || '').trim();
                        if (!rawChoice) {
                            return {
                                success: 'pending',
                                actions: [],
                                pending: {
                                    kind: 'selection',
                                    key: answerKey,
                                    prompt: `Select dataset for ${step.id} by number or id.`,
                                    options: candidates.map((ds: Dataset, idx: number): string =>
                                        `  ${idx + 1}. [${ds.id}] ${ds.name} (${ds.modality}/${ds.annotationType})`
                                    )
                                }
                            };
                        }

                        const parsedIndex: number = parseInt(rawChoice, 10);
                        if (!isNaN(parsedIndex) && parsedIndex >= 1 && parsedIndex <= candidates.length) {
                            selected = candidates[parsedIndex - 1];
                        } else {
                            selected = candidates.find((ds: Dataset): boolean =>
                                ds.id.toLowerCase() === rawChoice.toLowerCase()
                            ) || null;
                        }
                    }
                }

                if (!selected) {
                    return {
                        success: 'pending',
                        actions: [],
                        pending: {
                            kind: 'selection',
                            key: `${step.id}.selection`,
                            prompt: `Invalid selection. Choose dataset for ${step.id} by number or id.`,
                            options: candidates.map((ds: Dataset, idx: number): string =>
                                `  ${idx + 1}. [${ds.id}] ${ds.name} (${ds.modality}/${ds.annotationType})`
                            )
                        }
                    };
                }

                session.context.answers.selected_dataset_id = selected.id;
                return {
                    success: true,
                    actions: [],
                    summary: `SELECTED DATASET: [${selected.id}] ${selected.name}`,
                    output: selected
                };
            }

            case 'add': {
                const datasetId: string = String(params.dataset || '').trim();
                if (!datasetId) {
                    return { success: false, actions: [], message: 'missing dataset id for add step' };
                }
                return runCommand(`add ${datasetId}`);
            }

            case 'rename': {
                const projectName: string = String(params.project || '').trim();
                if (!projectName) {
                    return { success: false, actions: [], message: 'missing project name for rename step' };
                }
                return runCommand(`rename ${projectName}`);
            }

            case 'harmonize':
                return runCommand('harmonize');
            case 'proceed':
            case 'code':
                return runCommand(step.action);

            case 'run_python': {
                const scriptName: string = String(params.script || 'train.py').trim() || 'train.py';
                const args: string[] = Array.isArray(params.args)
                    ? (params.args as unknown[]).map((item: unknown): string => String(item))
                    : [];
                const cmd: string = ['python', scriptName, ...args].join(' ').trim();
                return runCommand(cmd);
            }

            case 'federate.transcompile': {
                const start: ScriptStepExecutionResult = await runCommand('federate');
                if (start.success !== true) return start;
                const confirm: ScriptStepExecutionResult = await runCommand('federate --yes');
                if (confirm.success !== true) return confirm;
                return {
                    success: true,
                    actions: [...start.actions, ...confirm.actions],
                    summary: confirm.summary || start.summary
                };
            }

            case 'federate.containerize':
                return runCommand('federate --yes');

            case 'federate.publish_metadata': {
                const enter: ScriptStepExecutionResult = await runCommand('federate --yes');
                if (enter.success !== true) return enter;

                const actions: CalypsoAction[] = [...enter.actions];
                let summary: string | undefined = enter.summary;

                if (params.app_name !== undefined) {
                    const appName: string = String(params.app_name || '').trim();
                    if (!appName) {
                        return { success: false, actions, message: 'missing app_name for publish metadata step' };
                    }
                    const appSet: ScriptStepExecutionResult = await runCommand(`federate --name ${appName}`);
                    actions.push(...appSet.actions);
                    if (appSet.success !== true) return appSet;
                    summary = appSet.summary || summary;
                }

                if (params.org !== undefined) {
                    const orgName: string = String(params.org || '').trim();
                    if (orgName) {
                        const orgSet: ScriptStepExecutionResult = await runCommand(`federate --org ${orgName}`);
                        actions.push(...orgSet.actions);
                        if (orgSet.success !== true) return orgSet;
                        summary = orgSet.summary || summary;
                    }
                }

                if (params.visibility !== undefined) {
                    const visibility: string = String(params.visibility || '').trim().toLowerCase();
                    if (visibility === 'private' || visibility === 'public') {
                        const visSet: ScriptStepExecutionResult = await runCommand(
                            visibility === 'private' ? 'federate --private' : 'federate --public'
                        );
                        actions.push(...visSet.actions);
                        if (visSet.success !== true) return visSet;
                        summary = visSet.summary || summary;
                    }
                }

                return {
                    success: true,
                    actions,
                    summary,
                    output: {
                        app_name: params.app_name,
                        org: params.org,
                        visibility: params.visibility
                    }
                };
            }

            case 'federate.publish':
                return runCommand('federate --yes');
            case 'federate.dispatch_compute':
                return runCommand('federate --yes');

            default:
                return { success: false, actions: [], message: `unsupported script action: ${step.action}` };
        }
    }

    /**
     * Evaluate script requirement keys.
     *
     * @param requirements - Requirement keys.
     * @returns First unmet requirement key, or null if all pass.
     */
    private scriptRequirement_unmet(requirements: string[]): string | null {
        for (const requirement of requirements) {
            if (requirement === 'active_project' && !this.storeActions.project_getActive()) {
                return 'active_project';
            }
            if (requirement === 'datasets_selected' && this.storeActions.datasets_getSelected().length === 0) {
                return 'datasets_selected';
            }
        }
        return null;
    }

    /**
     * Build an actionable script-not-found message with typo suggestions.
     *
     * @param ref - User-entered script reference.
     * @returns Formatted error/help text.
     */
    private scriptNotFound_message(ref: string): string {
        const lines: string[] = [`>> ERROR: SCRIPT NOT FOUND: ${ref}`];
        const suggestions: string[] = this.scriptSuggestions_resolve(ref);

        if (suggestions.length > 0) {
            lines.push(`○ DID YOU MEAN: ${suggestions.map((name: string): string => `[${name}]`).join(', ')} ?`);
            lines.push(`Use: /run [${suggestions[0]}]`);
            return lines.join('\n');
        }

        lines.push('Use /scripts to list available scripts.');
        return lines.join('\n');
    }

    /**
     * Resolve nearest script candidates by normalized edit distance.
     *
     * @param ref - User-entered script reference.
     * @returns Ranked script IDs (top 3).
     */
    private scriptSuggestions_resolve(ref: string): string[] {
        const query: string = ref.trim().toLowerCase().replace(/\.clpso$/i, '');
        if (!query) return [];

        const ranked: ScriptSuggestionScore[] = [];

        for (const script of scripts_list()) {
            let bestScore: number = Number.POSITIVE_INFINITY;
            const refs: string[] = [script.id, ...script.aliases];

            for (const candidateRaw of refs) {
                const candidate: string = candidateRaw.toLowerCase();
                const distance: number = this.distance_levenshtein(query, candidate);
                const containsBoosted: number =
                    candidate.includes(query) || query.includes(candidate) ? Math.max(0, distance - 1) : distance;
                if (containsBoosted < bestScore) bestScore = containsBoosted;
            }

            ranked.push({ id: script.id, score: bestScore });
        }

        ranked.sort((a, b): number => (a.score - b.score) || a.id.localeCompare(b.id));
        const threshold: number = Math.max(2, Math.floor(query.length * 0.35));

        return ranked
            .filter((entry): boolean => entry.score <= threshold)
            .slice(0, 3)
            .map((entry): string => entry.id);
    }

    /**
     * Levenshtein edit distance.
     *
     * @param a - Source string.
     * @param b - Target string.
     * @returns Edit distance.
     */
    private distance_levenshtein(a: string, b: string): number {
        if (a === b) return 0;
        if (!a.length) return b.length;
        if (!b.length) return a.length;

        const prev: number[] = Array.from({ length: b.length + 1 }, (_, i: number): number => i);
        const curr: number[] = new Array<number>(b.length + 1);

        for (let i: number = 1; i <= a.length; i++) {
            curr[0] = i;
            for (let j: number = 1; j <= b.length; j++) {
                const cost: number = a[i - 1] === b[j - 1] ? 0 : 1;
                curr[j] = Math.min(
                    curr[j - 1] + 1,
                    prev[j] + 1,
                    prev[j - 1] + cost
                );
            }
            for (let j: number = 0; j <= b.length; j++) {
                prev[j] = curr[j];
            }
        }

        return prev[b.length];
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
                return this.scripts_response([]);
            case 'script_show':
                return this.scripts_response([intent.scriptRef]);
            case 'script_run':
                return this.script_execute(intent.dryRun ? ['--dry', intent.scriptRef] : [intent.scriptRef]);
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
     * @param message - Raw response message.
     * @returns Short summary or null.
     */
    private scriptStep_summary(message: string): string | null {
        if (!message) return null;

        if (message === '__HARMONIZE_ANIMATE__') {
            return 'COHORT HARMONIZATION COMPLETE';
        }

        const cleanedLines: string[] = message
            .split('\n')
            .map((line: string): string => line.replace(/<[^>]+>/g, '').trim())
            .filter((line: string): boolean => line.length > 0);

        if (cleanedLines.length === 0) return null;
        return cleanedLines[0];
    }

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
                if (this.federationState?.step === 'transcompile') {
                    lines.push('Federation Step 1/5 is pending: source transcompile.');
                    lines.push('');
                    lines.push('  `federate --yes` — Execute step 1/5');
                    lines.push('  `federate --abort` — Cancel federation handshake');
                } else if (this.federationState?.step === 'containerize') {
                    lines.push('Federation Step 2/5 is pending: container compilation.');
                    lines.push('');
                    lines.push('  `federate --yes` — Execute step 2/5');
                    lines.push('  `federate --abort` — Cancel federation handshake');
                } else if (this.federationState?.step === 'publish_prepare' || this.federationState?.step === 'publish_configure') {
                    lines.push('Federation Step 3/5 is active: marketplace publish metadata.');
                    lines.push('');
                    lines.push('  `federate --name <app-name>` — Set app name');
                    lines.push('  `federate --org <org>` — Set org/namespace (optional)');
                    lines.push('  `federate --private` — Publish privately');
                    lines.push('  `federate --yes` — Confirm next publish action');
                    lines.push('  `federate --abort` — Cancel federation handshake');
                } else if (this.federationState?.step === 'dispatch_compute') {
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

        if (this.federationState) {
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
     * Start federation sequence.
     */
    private workflow_federate(rawArgs: string[] = []): CalypsoResponse {
        const username = this.shell.env_get('USER') || 'user';
        const activeMeta = this.storeActions.project_getActive();
        if (!activeMeta) {
            return this.response_create('>> ERROR: NO ACTIVE PROJECT CONTEXT.', [], false);
        }

        const projectName: string = activeMeta.name;
        const projectBase: string = `/home/${username}/projects/${projectName}`;
        const args: FederationArgs = this.federationArgs_parse(rawArgs);
        const metadataCommandIssued: boolean = args.name !== null || args.org !== null || args.visibility !== null;

        if (args.abort) {
            this.federationState = null;
            return this.response_create('○ FEDERATION HANDSHAKE ABORTED. NO DISPATCH PERFORMED.', [], true);
        }

        const federationComplete: boolean = this.vfs.node_stat(`${projectBase}/.federated`) !== null;
        const stateMatchesProject: boolean = !!this.federationState && this.federationState.projectId === activeMeta.id;

        if (!stateMatchesProject && federationComplete && !args.restart) {
            return this.response_create(
                [
                    `○ FEDERATION ALREADY COMPLETED FOR PROJECT [${projectName}].`,
                    `○ MARKER: ${projectBase}/.federated`,
                    '',
                    'No pending federation step to confirm.',
                    '  `next?` — Show post-federation guidance',
                    '  `federate --rerun` — Explicitly start a new federation run'
                ].join('\n'),
                [],
                true
            );
        }

        let stateInitialized: boolean = false;
        if (args.restart || !stateMatchesProject) {
            this.federationState = this.federationState_create(activeMeta.id, projectName);
            stateInitialized = true;
        }

        if (stateInitialized && args.confirm) {
            return this.response_create(
                [
                    args.restart
                        ? '○ FEDERATION RERUN CONTEXT INITIALIZED.'
                        : '○ FEDERATION CONTEXT INITIALIZED.',
                    '',
                    '○ No step was executed yet.',
                    '○ Review step briefing first, then confirm execution.',
                    '',
                    'Next:',
                    '  `federate`',
                    'Then confirm STEP 1/5:',
                    '  `federate --yes`'
                ].join('\n'),
                [],
                true
            );
        }

        const metadataUpdated: boolean = this.federationPublish_mutate(args);
        const dag: FederationDagPaths = this.federationDag_paths(projectBase);
        const federationState: FederationState | null = this.federationState;
        if (!federationState) {
            return this.response_create('>> ERROR: FEDERATION STATE INITIALIZATION FAILED.', [], false);
        }

        if (federationState.step === 'transcompile') {
            if (!args.confirm) {
                const lines: string[] = [
                    '● FEDERATION PRECHECK COMPLETE.',
                    `○ SOURCE VERIFIED: ${projectBase}/src/train.py`,
                    `○ DAG ROOT: ${dag.crosscompileBase}`,
                    '',
                    '● PHASE 1/3 · STEP 1/5 PENDING: SOURCE CODE TRANSCOMPILE.',
                    '○ This step generates federated node code from local training source.',
                    '',
                    'Ready for STEP 1/5 (Source Code Transcompile)?',
                    '  `federate --yes`',
                    '  `federate --abort`'
                ];
                if (metadataUpdated) {
                    lines.push('', '○ NOTE: PUBLISH SETTINGS CAPTURED EARLY FOR PHASE 2/3.');
                }
                return this.response_create(lines.join('\n'), [], true);
            }

            this.federationDag_step1TranscompileMaterialize(projectBase);
            federationState.step = 'containerize';

            return this.response_create(
                [
                    '● PHASE 1/3 · STEP 1/5 COMPLETE: SOURCE CODE TRANSCOMPILE.',
                    '',
                    '○ [1/5] SOURCE CODE TRANSCOMPILE COMPLETE.',
                    `○ READING SOURCE: ${projectBase}/src/train.py`,
                    '○ PARSING TRAIN LOOP AND DATA LOADER CONTRACTS...',
                    '○ INJECTING FLOWER CLIENT/SERVER HOOKS...',
                    '○ EMITTING FEDERATED ENTRYPOINT: node.py',
                    '○ WRITING EXECUTION ADAPTERS: flower_hooks.py',
                    '○ WRITING TRANSCOMPILE RECEIPTS + ARTIFACT MANIFEST...',
                    '',
                    `○ ARTIFACTS MATERIALIZED: ${dag.crosscompileData}`,
                    `○ NEXT DAG NODE READY: ${dag.containerizeBase}`,
                    '',
                    'Ready for STEP 2/5 (Container Compilation)?',
                    '  `federate --yes`',
                    '  `federate --abort`'
                ].join('\n'),
                [],
                true
            );
        }

        if (federationState.step === 'containerize') {
            if (!args.confirm) {
                const lines: string[] = [
                    '● PHASE 1/3 · STEP 2/5 PENDING: CONTAINER COMPILATION.',
                    '○ This step packages the transcompiled node into a runnable federation image.',
                    '',
                    'Ready for STEP 2/5 (Container Compilation)?',
                    '  `federate --yes`',
                    '  `federate --abort`'
                ];
                if (metadataUpdated) {
                    lines.push('', '○ NOTE: PUBLISH SETTINGS CAPTURED EARLY FOR PHASE 2/3.');
                }
                return this.response_create(lines.join('\n'), [], true);
            }

            this.federationDag_step2ContainerizeMaterialize(projectBase);
            try {
                this.vfs.file_create(`${projectBase}/.containerized`, new Date().toISOString());
            } catch { /* ignore */ }
            federationState.step = 'publish_prepare';

            return this.response_create(
                [
                    '● PHASE 1/3 · STEP 2/5 COMPLETE: CONTAINER COMPILATION.',
                    '',
                    '○ [2/5] CONTAINER COMPILATION COMPLETE.',
                    '○ RESOLVING BASE IMAGE + RUNTIME DEPENDENCIES...',
                    '○ STAGING FEDERATED ENTRYPOINT + FLOWER HOOKS...',
                    '○ BUILDING SIMULATED OCI IMAGE LAYERS...',
                    '○ WRITING SBOM + IMAGE DIGEST + BUILD LOG...',
                    '',
                    `○ ARTIFACTS MATERIALIZED: ${dag.containerizeData}`,
                    `○ NEXT DAG NODE READY: ${dag.publishBase}`,
                    '',
                    '● PHASE 1/3 COMPLETE: BUILD ARTIFACTS.',
                    '',
                    'Ready for STEP 3/5 (Marketplace Publish Preparation)?',
                    '  `federate --yes`',
                    '  `federate --abort`'
                ].join('\n'),
                [],
                true
            );
        }

        if (federationState.step === 'publish_prepare') {
            if (metadataCommandIssued) {
                federationState.step = 'publish_configure';
                return this.response_create(
                    [
                        '● PHASE 2/3 · STEP 3/5 ACTIVE: MARKETPLACE PUBLISH PREPARATION.',
                        ...(metadataUpdated ? ['', '○ PUBLISH METADATA UPDATED.'] : []),
                        '',
                        '○ Reviewing publish metadata prior to marketplace push.',
                        ...this.federationPublish_promptLines(federationState.publish)
                    ].join('\n'),
                    [],
                    true
                );
            }

            if (!args.confirm) {
                return this.response_create(
                    [
                        '● PHASE 2/3 · STEP 3/5 PENDING: MARKETPLACE PUBLISH PREPARATION.',
                        '○ This step captures app identity, org namespace, and visibility.',
                        '',
                        'Ready for STEP 3/5 (Publish Preparation)?',
                        '  `federate --yes`',
                        '  `federate --abort`'
                    ].join('\n'),
                    [],
                    true
                );
            }

            federationState.step = 'publish_configure';
            return this.response_create(
                [
                    '● PHASE 2/3 · STEP 3/5 ACTIVE: MARKETPLACE PUBLISH PREPARATION.',
                    '○ Please confirm publish metadata for the container artifact.',
                    '',
                    ...this.federationPublish_promptLines(federationState.publish)
                ].join('\n'),
                [],
                true
            );
        }

        if (federationState.step === 'publish_configure') {
            if (!args.confirm) {
                const lines: string[] = [
                    '● PHASE 2/3 · STEP 3/5 ACTIVE: MARKETPLACE PUBLISH PREPARATION.',
                    ...(metadataUpdated ? ['', '○ PUBLISH METADATA UPDATED.'] : []),
                    '',
                    ...this.federationPublish_promptLines(federationState.publish)
                ];
                return this.response_create(lines.join('\n'), [], true);
            }

            if (!federationState.publish.appName) {
                return this.response_create(
                    [
                        '>> APP NAME REQUIRED BEFORE PUBLISH EXECUTION.',
                        '○ SET: `federate --name <app-name>`',
                        '○ THEN CONTINUE WITH: `federate --yes`'
                    ].join('\n'),
                    [],
                    false
                );
            }

            this.federationDag_step4PublishMaterialize(projectBase, federationState.publish);
            try {
                this.vfs.file_create(`${projectBase}/.published`, new Date().toISOString());
            } catch { /* ignore */ }
            federationState.step = 'dispatch_compute';

            return this.response_create(
                [
                    '● PHASE 2/3 · STEP 4/5 COMPLETE: MARKETPLACE PUBLISH.',
                    '',
                    '○ [3/5] MARKETPLACE PUBLISHING COMPLETE.',
                    '○ SIGNING IMAGE REFERENCE + REGISTRY MANIFEST...',
                    '○ WRITING APP METADATA + PUBLISH RECEIPTS...',
                    ...this.federationPublishSummary_lines(federationState.publish),
                    `○ ARTIFACTS MATERIALIZED: ${dag.publishData}`,
                    `○ NEXT DAG NODE READY: ${dag.dispatchBase}`,
                    '',
                    'Ready for STEP 5/5 (Dispatch + Federated Compute Rounds)?',
                    '  `federate --yes`',
                    '  `federate --abort`'
                ].join('\n'),
                [],
                true
            );
        }

        // Dispatch + federated compute phase (step 5/5)
        if (!args.confirm) {
            if (metadataUpdated) {
                return this.response_create(
                    [
                        '○ STEP 5/5 IS ACTIVE. PUBLISH SETTINGS ARE LOCKED AFTER STEP 4/5.',
                        '',
                        'Ready for STEP 5/5 (Dispatch + Federated Compute Rounds)?',
                        '  `federate --yes`',
                        '  `federate --abort`'
                    ].join('\n'),
                    [],
                    true
                );
            }
            return this.response_create(
                [
                    'Ready for STEP 5/5 (Dispatch + Federated Compute Rounds)?',
                    '  `federate --yes`',
                    '  `federate --abort`'
                ].join('\n'),
                [],
                true
            );
        }

        this.federationDag_phase3Materialize(projectBase);
        try {
            this.vfs.file_create(`${projectBase}/.federated`, new Date().toISOString());
        } catch { /* ignore */ }
        this.federationState = null;

        const lines: string[] = [
            '● PHASE 3/3 · STEP 5/5 COMPLETE: DISPATCH & FEDERATED COMPUTE.',
            '',
            '○ [4/5] DISPATCH TO REMOTE SITES INITIALIZED.',
            `○ INGESTING SOURCE: ${projectBase}/src/train.py`,
            '',
            '○ INJECTING Flower PROTOCOLS (Client/Server hooks)...',
            '○ WRAPPING TRAIN LOOP INTO Flower.Client OBJECT...',
            '',
            '○ USING PREPUBLISHED FEDERATION CONTAINER...',
            '○ RESOLVING PARTICIPANT ENDPOINTS...',
            '',
            '○ DISTRIBUTING CONTAINER TO TRUSTED DOMAINS...',
            '  [BCH] -> DISPATCHED',
            '  [MGH] -> DISPATCHED',
            '  [BIDMC] -> DISPATCHED',
            '',
            '○ [5/5] FEDERATED COMPUTE ROUNDS:',
            '  ROUND 1/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.62',
            '  ROUND 2/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.71',
            '  ROUND 3/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.79',
            '  ROUND 4/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.84',
            '  ROUND 5/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.89',
            '',
            `○ ARTIFACTS MATERIALIZED: ${dag.dispatchData}`,
            `○ ROUND METRICS MATERIALIZED: ${dag.roundsData}`,
            '',
            '>> NEXT: Ask `next?` for deployment/monitor guidance.',
            '<span class="success">● DISPATCH COMPLETE. HANDSHAKE IN PROGRESS...</span>'
        ];

        return this.response_create(lines.join('\n'), [{ type: 'federation_start' }], true);
    }

    /**
     * Parse federate arguments into structured flags.
     */
    private federationArgs_parse(rawArgs: string[]): FederationArgs {
        const parsed: FederationArgs = {
            confirm: false,
            abort: false,
            restart: false,
            name: null,
            org: null,
            visibility: null
        };

        for (let i: number = 0; i < rawArgs.length; i++) {
            const token: string = rawArgs[i].toLowerCase();
            const rawToken: string = rawArgs[i];

            if (token === '--yes' || token === 'yes' || token === 'confirm') {
                parsed.confirm = true;
                continue;
            }
            if (token === '--abort' || token === 'abort' || token === 'cancel') {
                parsed.abort = true;
                continue;
            }
            if (token === '--rerun' || token === '--restart' || token === 'rerun' || token === 'restart') {
                parsed.restart = true;
                continue;
            }
            if (token === '--private') {
                parsed.visibility = 'private';
                continue;
            }
            if (token === '--public') {
                parsed.visibility = 'public';
                continue;
            }
            if (token.startsWith('--name=')) {
                parsed.name = rawToken.slice(rawToken.indexOf('=') + 1).trim() || null;
                continue;
            }
            if (token.startsWith('--org=')) {
                parsed.org = rawToken.slice(rawToken.indexOf('=') + 1).trim() || null;
                continue;
            }
            if (token === '--name' && rawArgs[i + 1]) {
                parsed.name = rawArgs[i + 1].trim() || null;
                i++;
                continue;
            }
            if (token === '--org' && rawArgs[i + 1]) {
                parsed.org = rawArgs[i + 1].trim() || null;
                i++;
                continue;
            }
        }

        return parsed;
    }

    /**
     * Create initial federation state for a project.
     */
    private federationState_create(projectId: string, projectName: string): FederationState {
        return {
            projectId,
            step: 'transcompile',
            publish: {
                appName: `${projectName}-fedapp`,
                org: null,
                visibility: 'public'
            }
        };
    }

    /**
     * Apply publish config mutations from command arguments.
     *
     * @returns True if any publish setting changed
     */
    private federationPublish_mutate(args: FederationArgs): boolean {
        if (!this.federationState) return false;

        let changed: boolean = false;
        if (args.name !== null && args.name !== this.federationState.publish.appName) {
            this.federationState.publish.appName = args.name;
            changed = true;
        }
        if (args.org !== null && args.org !== this.federationState.publish.org) {
            this.federationState.publish.org = args.org;
            changed = true;
        }
        if (args.visibility && args.visibility !== this.federationState.publish.visibility) {
            this.federationState.publish.visibility = args.visibility;
            changed = true;
        }

        return changed;
    }

    /**
     * Render publish settings summary lines.
     */
    private federationPublishSummary_lines(publish: FederationPublishConfig): string[] {
        return [
            `○ APP: ${publish.appName ?? '(unset)'}`,
            `○ ORG: ${publish.org ?? '(none)'}`,
            `○ VISIBILITY: ${publish.visibility.toUpperCase()}`,
            '○ IMAGE PUBLISHED TO INTERNAL REGISTRY.'
        ];
    }

    /**
     * Render publish prompt and current config.
     */
    private federationPublish_promptLines(publish: FederationPublishConfig): string[] {
        return [
            `○ CURRENT APP: ${publish.appName ?? '(unset)'}`,
            `○ CURRENT ORG: ${publish.org ?? '(none)'}`,
            `○ CURRENT VISIBILITY: ${publish.visibility.toUpperCase()}`,
            '',
            'Provide or adjust metadata:',
            '  `federate --name <app-name>`',
            '  `federate --org <namespace>`',
            '  `federate --private` or `federate --public`',
            '',
            'When metadata is ready:',
            '  Ready for STEP 4/5 (Marketplace Publish)?',
            '    `federate --yes`',
            '    `federate --abort`'
        ];
    }

    /**
     * Resolve canonical DAG paths for federate stage materialization.
     */
    private federationDag_paths(projectBase: string): FederationDagPaths {
        const crosscompileBase: string = `${projectBase}/src/source-crosscompile`;
        const crosscompileData: string = `${crosscompileBase}/data`;
        const containerizeBase: string = `${crosscompileBase}/containerize`;
        const containerizeData: string = `${containerizeBase}/data`;
        const publishBase: string = `${containerizeBase}/marketplace-publish`;
        const publishData: string = `${publishBase}/data`;
        const dispatchBase: string = `${publishBase}/dispatch`;
        const dispatchData: string = `${dispatchBase}/data`;
        const dispatchReceipts: string = `${dispatchData}/receipts`;
        const roundsBase: string = `${dispatchBase}/federated-rounds`;
        const roundsData: string = `${roundsBase}/data`;

        return {
            crosscompileBase,
            crosscompileData,
            containerizeBase,
            containerizeData,
            publishBase,
            publishData,
            dispatchBase,
            dispatchData,
            dispatchReceipts,
            roundsBase,
            roundsData
        };
    }

    /**
     * Write a DAG artifact, creating parent directories if required.
     */
    private federationDag_write(path: string, content: string): void {
        const parent: string = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '/';
        this.vfs.dir_create(parent);
        this.vfs.node_write(path, content);
    }

    /**
     * Materialize step-1 (source-crosscompile) DAG artifacts.
     */
    private federationDag_step1TranscompileMaterialize(projectBase: string): void {
        const dag: FederationDagPaths = this.federationDag_paths(projectBase);
        const now: string = new Date().toISOString();
        this.vfs.dir_create(dag.crosscompileData);
        this.vfs.dir_create(dag.containerizeBase); // next DAG node as sibling to data

        this.federationDag_write(
            `${dag.crosscompileData}/node.py`,
            [
                '# Auto-generated federated node entrypoint',
                'import flwr as fl',
                '',
                'def client_fn(context):',
                '    return None',
                '',
                'if __name__ == "__main__":',
                '    fl.client.start_client(server_address="127.0.0.1:8080", client=client_fn({}))'
            ].join('\n')
        );
        this.federationDag_write(
            `${dag.crosscompileData}/flower_hooks.py`,
            [
                '# Auto-generated Flower hooks',
                'def train_hook(batch):',
                '    return {"loss": 0.0, "acc": 0.0}',
                '',
                'def eval_hook(batch):',
                '    return {"val_loss": 0.0, "val_acc": 0.0}'
            ].join('\n')
        );
        this.federationDag_write(
            `${dag.crosscompileData}/transcompile.log`,
            `TRANSPILE START: ${now}\nSOURCE: ${projectBase}/src/train.py\nSTATUS: COMPLETE\n`
        );
        this.federationDag_write(
            `${dag.crosscompileData}/artifact.json`,
            JSON.stringify(
                {
                    stage: 'source-crosscompile',
                    status: 'complete',
                    generatedAt: now,
                    inputs: [`${projectBase}/src/train.py`],
                    outputs: ['node.py', 'flower_hooks.py', 'transcompile.log']
                },
                null,
                2
            )
        );
    }

    /**
     * Materialize step-2 (container compilation) DAG artifacts.
     */
    private federationDag_step2ContainerizeMaterialize(projectBase: string): void {
        const dag: FederationDagPaths = this.federationDag_paths(projectBase);
        const now: string = new Date().toISOString();
        this.vfs.dir_create(dag.containerizeData);
        this.vfs.dir_create(dag.publishBase); // next DAG node as sibling to data

        this.federationDag_write(
            `${dag.containerizeData}/Dockerfile`,
            [
                'FROM python:3.11-slim',
                'WORKDIR /app',
                'COPY ../source-crosscompile/data/node.py /app/node.py',
                'COPY ../source-crosscompile/data/flower_hooks.py /app/flower_hooks.py',
                'CMD ["python", "/app/node.py"]'
            ].join('\n')
        );
        this.federationDag_write(`${dag.containerizeData}/image.tar`, 'SIMULATED OCI IMAGE TAR\n');
        this.federationDag_write(`${dag.containerizeData}/image.digest`, 'sha256:simulatedfedmlimage0001\n');
        this.federationDag_write(
            `${dag.containerizeData}/sbom.json`,
            JSON.stringify({ format: 'spdx-json', generatedAt: now, packages: ['python', 'flwr'] }, null, 2)
        );
        this.federationDag_write(
            `${dag.containerizeData}/build.log`,
            `BUILD START: ${now}\nLAYER CACHE: HIT\nIMAGE: COMPLETE\n`
        );
    }

    /**
     * Materialize step-4 (marketplace publish execution) DAG artifacts.
     */
    private federationDag_step4PublishMaterialize(projectBase: string, publish: FederationPublishConfig): void {
        const dag: FederationDagPaths = this.federationDag_paths(projectBase);
        const now: string = new Date().toISOString();
        this.vfs.dir_create(dag.publishData);
        this.vfs.dir_create(dag.dispatchBase); // next DAG node as sibling to data

        const appName: string = publish.appName || 'unnamed-fedml-app';
        this.federationDag_write(
            `${dag.publishData}/app.json`,
            JSON.stringify(
                {
                    appName,
                    org: publish.org,
                    visibility: publish.visibility,
                    imageDigest: 'sha256:simulatedfedmlimage0001',
                    publishedAt: now
                },
                null,
                2
            )
        );
        this.federationDag_write(
            `${dag.publishData}/publish-receipt.json`,
            JSON.stringify(
                {
                    status: 'published',
                    appName,
                    registry: 'internal://argus-marketplace',
                    publishedAt: now
                },
                null,
                2
            )
        );
        this.federationDag_write(`${dag.publishData}/registry-ref.txt`, `internal://argus-marketplace/${appName}:latest\n`);
        this.federationDag_write(
            `${dag.publishData}/publish.log`,
            `PUBLISH START: ${now}\nAPP: ${appName}\nSTATUS: COMPLETE\n`
        );
    }

    /**
     * Materialize phase-3 (dispatch + federated rounds) DAG artifacts.
     */
    private federationDag_phase3Materialize(projectBase: string): void {
        const dag: FederationDagPaths = this.federationDag_paths(projectBase);
        const now: string = new Date().toISOString();
        const participants: string[] = ['BCH', 'MGH', 'BIDMC'];

        this.vfs.dir_create(dag.dispatchData);
        this.vfs.dir_create(dag.dispatchReceipts);
        this.vfs.dir_create(dag.roundsData);

        this.federationDag_write(
            `${dag.dispatchData}/participants.json`,
            JSON.stringify(
                participants.map((site: string) => ({ site, endpoint: `federation://${site.toLowerCase()}/node`, status: 'ready' })),
                null,
                2
            )
        );
        this.federationDag_write(
            `${dag.dispatchData}/dispatch.log`,
            `DISPATCH START: ${now}\nTARGETS: ${participants.join(', ')}\nSTATUS: COMPLETE\n`
        );
        this.federationDag_write(
            `${dag.dispatchReceipts}/bch.json`,
            JSON.stringify({ site: 'BCH', status: 'accepted', timestamp: now }, null, 2)
        );
        this.federationDag_write(
            `${dag.dispatchReceipts}/mgh.json`,
            JSON.stringify({ site: 'MGH', status: 'accepted', timestamp: now }, null, 2)
        );
        this.federationDag_write(
            `${dag.dispatchReceipts}/bidmc.json`,
            JSON.stringify({ site: 'BIDMC', status: 'accepted', timestamp: now }, null, 2)
        );

        const rounds: number[] = [1, 2, 3, 4, 5];
        const aggregate: number[] = [0.62, 0.71, 0.79, 0.84, 0.89];
        rounds.forEach((round: number, idx: number): void => {
            this.federationDag_write(
                `${dag.roundsData}/round-0${round}.json`,
                JSON.stringify(
                    {
                        round,
                        participants: participants.map((site: string) => ({ site, status: 'ok' })),
                        aggregate: aggregate[idx],
                        timestamp: now
                    },
                    null,
                    2
                )
            );
        });
        this.federationDag_write(
            `${dag.roundsData}/aggregate-metrics.json`,
            JSON.stringify({ finalAggregate: 0.89, rounds: aggregate, completedAt: now }, null, 2)
        );
        this.federationDag_write(`${dag.roundsData}/final-checkpoint.bin`, 'SIMULATED_CHECKPOINT_PAYLOAD\n');

        // Keep a compact project-level marker for workflow validation compatibility.
        this.federationDag_write(
            `${projectBase}/.federation-dag.json`,
            JSON.stringify(
                {
                    root: `${projectBase}/src/source-crosscompile`,
                    lastMaterializedAt: now,
                    phases: ['source-crosscompile', 'containerize', 'marketplace-publish', 'dispatch', 'federated-rounds']
                },
                null,
                2
            )
        );
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

// ─── Store Actions Interface ───────────────────────────────────────────────

/**
 * Interface for store actions that CalypsoCore needs.
 * This avoids circular dependencies with the full Store class.
 */
export interface CalypsoStoreActions {
    /** Get current state snapshot */
    state_get(): Partial<AppState>;

    /** Reset to initial state */
    reset(): void;

    /** Select a dataset */
    dataset_select(dataset: Dataset): void;

    /** Deselect a dataset by ID */
    dataset_deselect(id: string): void;

    /** Get selected datasets */
    datasets_getSelected(): Dataset[];

    /** Get active project */
    project_getActive(): { id: string; name: string } | null;

    /** Set current stage */
    stage_set(stage: AppState['currentStage']): void;
}
