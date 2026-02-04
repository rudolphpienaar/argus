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
import type { Dataset, AppState } from '../core/models/types.js';
import { DATASETS } from '../core/data/datasets.js';
import { project_gather } from '../core/logic/ProjectManager.js';

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

    // Store reference for state access (injected as interface to avoid circular deps)
    private storeActions: CalypsoStoreActions;

    constructor(
        private vfs: VirtualFileSystem,
        private shell: Shell,
        storeActions: CalypsoStoreActions,
        config: CalypsoCoreConfig = {}
    ) {
        this.storeActions = storeActions;
        this.simulationMode = config.simulationMode ?? false;
        this.knowledge = config.knowledge;

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

        if (!trimmed) {
            return this.response_create('', [], true);
        }

        // Check for special commands (prefixed with /)
        if (trimmed.startsWith('/')) {
            return this.special_dispatch(trimmed);
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
        // VFS reset would go here if needed
    }

    /**
     * Get version information.
     */
    public version_get(): string {
        return 'CALYPSO CORE V5.0.0';
    }

    // ─── Special Commands (/command) ───────────────────────────────────────

    /**
     * Dispatch special commands prefixed with /.
     */
    private special_dispatch(input: string): CalypsoResponse {
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

            case 'help': {
                const help: string = `CALYPSO SPECIAL COMMANDS:
  /status           - Show system status (AI, VFS, project)
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
  gather            - Review gathered datasets
  mount             - Mount VFS and proceed to process stage
  federate          - Start federation sequence`;
                return this.response_create(help, [], true);
            }

            default:
                return this.response_create(`Unknown special command: /${cmd}`, [], false);
        }
    }

    // ─── Workflow Commands ─────────────────────────────────────────────────

    /**
     * Dispatch workflow commands (search, add, gather, mount, etc.).
     *
     * @param input - Full input string
     * @returns Response if handled, null to fall through to LLM
     */
    private async workflow_dispatch(input: string): Promise<CalypsoResponse | null> {
        const parts: string[] = input.split(/\s+/);
        const cmd: string = parts[0].toLowerCase();
        const args: string[] = parts.slice(1);

        switch (cmd) {
            case 'search':
                return this.workflow_search(args.join(' '));

            case 'add':
                return this.workflow_add(args[0]);

            case 'remove':
            case 'deselect':
                return this.workflow_remove(args[0]);

            case 'gather':
            case 'review':
                return this.workflow_gather();

            case 'mount':
                return this.workflow_mount();

            case 'federate':
                return this.workflow_federate();

            case 'proceed':
            case 'code':
                return this.workflow_proceed();

            default:
                return null; // Fall through to LLM
        }
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

        const actions: CalypsoAction[] = [
            { type: 'workspace_render', datasets: results }
        ];

        if (results.length === 0) {
            return this.response_create(
                `○ NO MATCHING DATASETS FOUND FOR "${query}".`,
                actions,
                true
            );
        }

        const listing: string = results
            .map((ds: Dataset): string => `  [${ds.id}] ${ds.name} (${ds.modality}/${ds.annotationType})`)
            .join('\n');

        return this.response_create(
            `● FOUND ${results.length} MATCHING DATASET(S):\n${listing}`,
            actions,
            true
        );
    }

    /**
     * Add a dataset to the selection.
     */
    private workflow_add(targetId: string): CalypsoResponse {
        if (!targetId) {
            return this.response_create('Usage: add <dataset-id>', [], false);
        }

        const dataset: Dataset | undefined = DATASETS.find((ds: Dataset): boolean =>
            ds.id === targetId || ds.name.toLowerCase().includes(targetId.toLowerCase())
        );

        if (!dataset) {
            return this.response_create(
                `>> ERROR: DATASET "${targetId}" NOT FOUND.`,
                [],
                false
            );
        }

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
     * Review gathered datasets.
     */
    private workflow_gather(): CalypsoResponse {
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
    private workflow_federate(): CalypsoResponse {
        const actions: CalypsoAction[] = [
            { type: 'federation_start' }
        ];

        return this.response_create(
            '● INITIATING FEDERATION SEQUENCE...',
            actions,
            true
        );
    }

    /**
     * Proceed to coding/process stage.
     */
    private workflow_proceed(): CalypsoResponse {
        const actions: CalypsoAction[] = [
            { type: 'stage_advance', stage: 'process' }
        ];

        return this.response_create(
            '● AFFIRMATIVE. INITIATING CODE PROTOCOLS.',
            actions,
            true
        );
    }

    // ─── LLM Integration ───────────────────────────────────────────────────

    /**
     * Query the LLM for natural language processing.
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

        try {
            const response: QueryResponse = await this.engine.query(input, selectedIds, false);
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

        // Extract [SELECT: ds-xxx] intent
        const selectMatch: RegExpMatchArray | null = response.answer.match(/\[SELECT: (ds-[0-9]+)\]/);
        if (selectMatch) {
            const dsId = selectMatch[1];
            // CRITICAL: Ensure VFS mounting happens for AI selections
            // We call workflow_add to trigger project_gather() and draft creation
            this.workflow_add(dsId);
            actions.push({ type: 'dataset_open', id: dsId });
        }

        // Extract [ACTION: PROCEED] intent
        if (response.answer.includes('[ACTION: PROCEED]')) {
            actions.push({ type: 'stage_advance', stage: 'process' });
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
            const activeProject = this.storeActions.project_getActive();
            if (activeProject) {
                actions.push({ type: 'project_rename', id: activeProject.id, newName });
            }
        }

        // Clean up the answer (remove intent markers)
        const cleanAnswer: string = response.answer
            .replace(/\[SELECT: ds-[0-9]+\]/g, '')
            .replace(/\[ACTION: PROCEED\]/g, '')
            .replace(/\[ACTION: SHOW_DATASETS\]/g, '')
            .replace(/\[FILTER:.*?\]/g, '')
            .replace(/\[ACTION: RENAME.*?\]/g, '')
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
