/**
 * @file FederationOrchestrator - Manifest-Aligned Federation Handshake
 *
 * Manages the 8-step federation workflow aligned 1:1 with fedml.manifest.yaml
 * stage IDs. Each step responds to its manifest-defined commands.
 *
 * Logic is delegated to phase handlers in `./phases/`.
 *
 * @module
 */

import type { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import { 
    CalypsoAction,
    CalypsoStoreActions,
    PluginTelemetry,
    CalypsoResponse 
} from '../types.js';
import { FederationContentProvider } from './FederationContentProvider.js';
import type {
    FederationState,
    FederationArgs,
    FederationDagPaths,
    FederationStep
} from './types.js';

import {
    dag_paths,
    publish_mutate,
    response_create,
    state_create
} from './utils.js';

import { step_brief } from './phases/Briefing.js';
import { step_transcompile_approve } from './phases/Transcompile.js';
import { step_containerize_approve } from './phases/Containerize.js';
import {
    step_config,
    step_publishConfig_approve,
    step_publishExecute_approve
} from './phases/Publish.js';
import {
    step_dispatch,
    step_publish,
    step_status
} from './phases/Dispatch.js';
import { step_show } from './phases/Show.js';

/**
 * Orchestrates the multi-phase federation handshake protocol.
 *
 * This class serves as the primary controller for the federation lifecycle,
 * coordinating state transitions across the 8-step manifest-aligned handshake.
 * It manages context resolution, state initialization, and command dispatching
 * to specialized phase handlers.
 */
export class FederationOrchestrator {
    /** Full path to the federate artifact file in session tree. */
    private federateArtifactPath: string = '';

    /** Provider for materializing federation artifacts in the VFS. */
    private contentProvider: FederationContentProvider;

    /**
     * Create a new FederationOrchestrator.
     *
     * @param vfs - The Virtual File System for artifact materialization.
     * @param storeActions - Actions for interacting with the global Calypso store.
     */
    constructor(
        private vfs: VirtualFileSystem,
        private storeActions: CalypsoStoreActions
    ) {
        this.contentProvider = new FederationContentProvider(vfs);
    }

    /**
     * Get the current federation state from the store.
     *
     * @returns The current FederationState or null if no handshake is active.
     */
    private federationState_get(): FederationState | null {
        return this.storeActions.federation_getState();
    }

    /**
     * Update the federation state in the store.
     *
     * @param state - The new federation state or null to clear it.
     */
    private federationState_set(state: FederationState | null): void {
        this.storeActions.federation_setState(state);
    }

    /**
     * Set the federation artifact path for session tree writes.
     *
     * @param artifactPath - The full path to the federate artifact file.
     */
    session_set(artifactPath: string): void {
        this.federateArtifactPath = artifactPath;
    }

    // ─── Public API ───────────────────────────────────────────────────

    /**
     * Route a command verb to the appropriate federation step handler.
     * 
     * This is the primary entry point for all federation-related commands.
     * It performs context resolution, state validation, and delegates to 
     * specialized dispatch methods.
     * 
     * @param verb - Command verb (e.g., 'federate', 'approve', 'show', 'config').
     * @param rawArgs - Raw command line arguments.
     * @param username - The active user's name.
     * @param ui - Live telemetry bus handle.
     * @param sleep - Sleep helper for simulated compute.
     * @returns A CalypsoResponse containing the operation result.
     */
    async command(
        verb: string, 
        rawArgs: string[], 
        username: string,
        ui: PluginTelemetry,
        sleep: (ms: number) => Promise<void>
    ): Promise<CalypsoResponse> {
        const activeMeta = this.storeActions.project_getActive();
        if (!activeMeta) {
            return response_create('>> ERROR: NO ACTIVE PROJECT CONTEXT.', [], false);
        }

        const projectName: string = activeMeta.name;
        const projectBase: string = `/home/${username}/projects/${projectName}`;
        const args: FederationArgs = this.args_parse(rawArgs);

        if (args.abort) {
            this.federationState_set(null);
            return response_create('○ FEDERATION HANDSHAKE ABORTED. NO DISPATCH PERFORMED.', [], true);
        }

        // 1. Guard against re-execution without explicit intent
        const completionCheck = this.completion_check(projectBase, activeMeta.id, projectName, args);
        if (completionCheck) return completionCheck;

        // 2. Initialize or restore state
        const stateResult = this.state_initialize(activeMeta.id, projectName, args);
        if (stateResult) return stateResult;

        const dag: FederationDagPaths = dag_paths(projectBase);
        const currentState = this.federationState_get();
        if (!currentState) {
            return response_create('>> ERROR: FEDERATION STATE INITIALIZATION FAILED.', [], false);
        }

        // 3. Dispatch to phase handler
        const response = await this.verb_dispatch(verb, currentState, projectBase, dag, projectName, rawArgs, args, ui, sleep);

        // 4. Persist updated state (unless completed)
        if (this.federationState_get() !== null) {
            this.federationState_set(currentState);
        }

        return response;
    }

    /**
     * Check if the federation is already complete and return a response if so.
     *
     * @param projectBase - Base filesystem path of the project.
     * @param projectId - Unique ID of the active project.
     * @param projectName - Display name of the active project.
     * @param args - Parsed federation arguments.
     * @returns A CalypsoResponse if completion prevents execution, otherwise null.
     */
    private completion_check(
        projectBase: string,
        projectId: string,
        projectName: string,
        args: FederationArgs
    ): CalypsoResponse | null {
        const federationComplete: boolean = this.vfs.node_stat(`${projectBase}/.federated`) !== null;
        const state = this.federationState_get();
        const stateMatchesProject: boolean = !!state && state.projectId === projectId;

        if (!stateMatchesProject && federationComplete && !args.restart) {
            return response_create(
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
        return null;
    }

    /**
     * Initialize or reset the federation state based on arguments and current project.
     *
     * @param projectId - Unique ID of the active project.
     * @param projectName - Display name of the active project.
     * @param args - Parsed federation arguments.
     * @returns A CalypsoResponse if initialization requires immediate user feedback, otherwise null.
     */
    private state_initialize(projectId: string, projectName: string, args: FederationArgs): CalypsoResponse | null {
        const state = this.federationState_get();
        const stateMatchesProject: boolean = !!state && state.projectId === projectId;

        if (args.restart || !stateMatchesProject) {
            const newState: FederationState = state_create(projectId, projectName);
            this.federationState_set(newState);

            if (args.restart) {
                return response_create(
                    [
                        '○ FEDERATION RERUN CONTEXT INITIALIZED.',
                        '',
                        'Next:',
                        '  `federate` — Review federation briefing',
                    ].join('\n'),
                    [],
                    true
                );
            }
        }
        return null;
    }

    /**
     * Dispatch the command verb to the appropriate phase handler.
     */
    private async verb_dispatch(
        verb: string,
        state: FederationState,
        projectBase: string,
        dag: FederationDagPaths,
        projectName: string,
        rawArgs: string[],
        args: FederationArgs,
        ui: PluginTelemetry,
        sleep: (ms: number) => Promise<void>
    ): Promise<CalypsoResponse> {
        switch (verb) {
            case 'federate':
                return step_brief(state, projectBase, dag, args);

            case 'approve':
                return await this.step_approve(state, projectBase, dag, projectName, args, ui, sleep);

            case 'show':
                return step_show(state, rawArgs, projectBase, dag);

            case 'config':
                return step_config(state, rawArgs, args);

            case 'dispatch':
                return await step_dispatch(state, projectBase, dag, projectName, args, this.contentProvider, ui, sleep);

            case 'status':
                return step_status(state, projectBase, dag);

            case 'publish':
                const result = step_publish(state, projectBase, dag, projectName, this.vfs, this.federateArtifactPath, ui, sleep);
                if (result.completed) {
                    this.federationState_set(null);
                }
                return result.response;

            default:
                return response_create(`>> ERROR: Unknown federation verb '${verb}'.`, [], false);
        }
    }

    /**
     * Start or advance the federation sequence (backward-compat wrapper).
     */
    async federate(
        rawArgs: string[], 
        username: string,
        ui: PluginTelemetry,
        sleep: (ms: number) => Promise<void>
    ): Promise<CalypsoResponse> {
        return await this.command('federate', rawArgs, username, ui, sleep);
    }

    /**
     * Reset federation state (used on abort from external callers).
     */
    state_reset(): void {
        this.federationState_set(null);
    }

    /**
     * Whether a federation handshake is currently active.
     */
    get active(): boolean {
        return this.federationState_get() !== null;
    }

    /**
     * Current federation step, or null if no active handshake.
     */
    get currentStep(): FederationStep | null {
        return this.federationState_get()?.step ?? null;
    }

    // ─── Step Router ──────────────────────────────────────────────────

    /**
     * Context-dependent approve: advance whatever step we're on.
     */
    private async step_approve(
        state: FederationState,
        projectBase: string,
        dag: FederationDagPaths,
        projectName: string,
        args: FederationArgs,
        ui: PluginTelemetry,
        sleep: (ms: number) => Promise<void>
    ): Promise<CalypsoResponse> {
        publish_mutate(state, args);

        switch (state.step) {
            case 'federate-brief':
                return step_brief(state, projectBase, dag, args);

            case 'federate-transcompile':
                return await step_transcompile_approve(state, projectBase, dag, this.contentProvider, ui, sleep);

            case 'federate-containerize':
                return await step_containerize_approve(state, projectBase, dag, this.contentProvider, this.vfs, ui, sleep);

            case 'federate-publish-config':
                return step_publishConfig_approve(state);

            case 'federate-publish-execute':
                return await step_publishExecute_approve(state, projectBase, dag, projectName, this.contentProvider, this.vfs, ui, sleep);

            case 'federate-dispatch':
                return response_create(
                    '○ Dispatch requires the `dispatch` command, not `approve`.\n  `dispatch`\n  `dispatch --sites BCH,MGH,BIDMC`',
                    [], false
                );

            case 'federate-execute':
                return response_create(
                    '○ Training is in progress. Use `status` or `show rounds` to monitor.',
                    [], true
                );

            case 'federate-model-publish':
                return response_create(
                    '○ Use `publish model` to publish the trained model.',
                    [], true
                );

            default:
                return response_create('>> ERROR: No pending step to approve.', [], false);
        }
    }

    // ─── Argument Parsing ─────────────────────────────────────────────

    /**
     * Parse federate arguments into structured flags.
     *
     * Preserves backward compatibility with --yes, --name, --org, etc.
     * while normalizing them into a FederationArgs record.
     *
     * @param rawArgs - Raw argument tokens.
     * @returns Parsed FederationArgs.
     */
    private args_parse(rawArgs: string[]): FederationArgs {
        const parsed: FederationArgs = {
            abort: false,
            restart: false,
            name: null,
            org: null,
            visibility: null
        };

        for (let i: number = 0; i < rawArgs.length; i++) {
            const token: string = rawArgs[i].toLowerCase();
            const rawToken: string = rawArgs[i];

            if (this.argIs_abort(token)) {
                parsed.abort = true;
                continue;
            }
            if (this.argIs_restart(token)) {
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
     * Check if a token represents an abort intent.
     *
     * @param token - Argument token.
     * @returns True if the token is an abort flag.
     */
    private argIs_abort(token: string): boolean {
        return token === '--abort' || token === 'abort' || token === 'cancel';
    }

    /**
     * Check if a token represents a restart intent.
     *
     * @param token - Argument token.
     * @returns True if the token is a restart flag.
     */
    private argIs_restart(token: string): boolean {
        return token === '--rerun' || token === '--restart' || token === 'rerun' || token === 'restart';
    }
}
