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
import { project_gather, project_rename } from '../core/logic/ProjectManager.js';
import { projectDir_populate } from '../vfs/providers/ProjectProvider.js';
import { VERSION } from '../generated/version.js';

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
            const specialResult: CalypsoResponse = this.special_dispatch(trimmed);
            // Handle async commands (like /greet)
            if (specialResult.message === '__GREET_ASYNC__') {
                const parts: string[] = trimmed.slice(1).split(/\s+/);
                const username: string = parts[1] || this.shell.env_get('USER') || 'user';
                return this.greeting_generate(username);
            }
            return specialResult;
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
        return `CALYPSO CORE V${VERSION}`;
    }

    /**
     * Get the current prompt string (for CLI clients).
     * Format: <user>@CALYPSO:[pwd]>
     */
    public prompt_get(): string {
        return this.shell.prompt_render();
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

            case 'greet': {
                // Return null to signal async handling needed
                return this.response_create('__GREET_ASYNC__', [], true);
            }

            default:
                return this.response_create(`Unknown special command: /${cmd}`, [], false);
        }
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
                return this.workflow_gather(args[0]);

            case 'mount':
                return this.workflow_mount();

            case 'federate':
                return this.workflow_federate();

            case 'proceed':
            case 'code':
                return this.workflow_proceed();

            case 'rename':
                let nameArg: string = args.join(' ');
                if (nameArg.toLowerCase().startsWith('to ')) {
                    nameArg = nameArg.substring(3).trim();
                }
                return this.workflow_rename(nameArg);

            case 'harmonize':
                return this.workflow_harmonize();

            default:
                return null; // Fall through to LLM
        }
    }

    /**
     * Harmonize the active project's cohort.
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

        // Import side effect logic from ProjectManager
        const { project_harmonize } = require('../core/logic/ProjectManager.js');
        project_harmonize(project);

        return this.response_create(
            `● COHORT HARMONIZATION COMPLETE.`,
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
    private workflow_federate(): CalypsoResponse {
        const username = this.shell.env_get('USER') || 'user';
        const projectName = this.shell.env_get('PROJECT');
        
        if (globals.terminal) {
            globals.terminal.println('● INITIATING ATLAS FACTORY SEQUENCE...');
            globals.terminal.println(`○ INGESTING SOURCE: /home/${username}/projects/${projectName}/src/train.py`);
            
            // Phase 1: Flower-ization
            globals.terminal.println('○ INJECTING Flower PROTOCOLS (Client/Server hooks)...');
            globals.terminal.println('○ WRAPPING TRAIN LOOP INTO Flower.Client OBJECT...');
            
            // Phase 2: ChRIS-ification
            globals.terminal.println('○ GENERATING MERIDIAN CONTAINER (ChRIS-ification)...');
            globals.terminal.println('○ BUILDING Dockerfile AND manifest.json...');
            
            // Phase 3: Dispatch
            globals.terminal.println('○ DISTRIBUTING CONTAINER TO TRUSTED DOMAINS...');
            globals.terminal.println('  [BCH] -> DISPATCHED');
            globals.terminal.println('  [MGH] -> DISPATCHED');
            globals.terminal.println('  [BIDMC] -> DISPATCHED');
            
            globals.terminal.println('<span class="success">● DISPATCH COMPLETE. HANDSHAKE IN PROGRESS...</span>');
        }

        const actions: CalypsoAction[] = [
            { type: 'federation_start' }
        ];

        return this.response_create(
            '● FEDERATION PROTOCOLS ACTIVE.',
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
                            this.chrisProject_scaffold(projectBase);
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

        // Extract [ACTION: HARMONIZE] intent
        if (response.answer.includes('[ACTION: HARMONIZE]')) {
            const activeMeta = this.storeActions.project_getActive();
            if (activeMeta) {
                const project: Project | undefined = MOCK_PROJECTS.find((p: Project): boolean => p.id === activeMeta.id);
                if (project) {
                    // Execute the side effect
                    const { project_harmonize } = require('../core/logic/ProjectManager.js');
                    project_harmonize(project);
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

    // ─── Project Scaffolding ──────────────────────────────────────────────

    /**
     * Scaffold a ChRIS plugin project structure.
     * Creates src/ with Dockerfile, argument parser, and plugin entry point.
     */
    private chrisProject_scaffold(projectBase: string): void {
        const srcPath: string = `${projectBase}/src`;

        // Create directories
        this.vfs.dir_create(srcPath);
        this.vfs.dir_create(`${srcPath}/app`);

        // Create ChRIS plugin files
        const files: Array<[string, string]> = [
            ['Dockerfile', 'chris-dockerfile'],
            ['requirements.txt', 'chris-requirements'],
            ['README.md', 'chris-readme'],
            ['app/__init__.py', 'chris-init'],
            ['app/main.py', 'chris-main'],
            ['app/parser.py', 'chris-parser']
        ];

        for (const [fileName, generatorKey] of files) {
            const filePath: string = `${srcPath}/${fileName}`;
            this.vfs.file_create(filePath);
            const node: FileNode | null = this.vfs.node_stat(filePath);
            if (node) {
                node.contentGenerator = generatorKey;
                node.content = null;
            }
        }
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
