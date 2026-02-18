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
import type { CalypsoResponse, CalypsoStoreActions } from '../types.js';
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
 */
export class FederationOrchestrator {
    /** Full path to the federate artifact file in session tree. */
    private federateArtifactPath: string = '';

    private contentProvider: FederationContentProvider;

    constructor(
        private vfs: VirtualFileSystem,
        private storeActions: CalypsoStoreActions
    ) {
        this.contentProvider = new FederationContentProvider(vfs);
    }

    /**
     * Get the current federation state from the store.
     */
    private federationState_get(): FederationState | null {
        return this.storeActions.federation_getState();
    }

    /**
     * Update the federation state in the store.
     */
    private federationState_set(state: FederationState | null): void {
        this.storeActions.federation_setState(state);
    }

    /**
     * Set the federation artifact path for session tree writes.
     */
    session_set(artifactPath: string): void {
        this.federateArtifactPath = artifactPath;
    }

    // ─── Public API ───────────────────────────────────────────────────

    /**
     * Route a command verb to the appropriate federation step handler.
     */
    command(verb: string, rawArgs: string[], username: string): CalypsoResponse {
        const activeMeta: { id: string; name: string; } | null = this.storeActions.project_getActive();
        if (!activeMeta) {
            return response_create('>> ERROR: NO ACTIVE PROJECT CONTEXT.', [], false);
        }

        const projectName: string = activeMeta.name;
        const projectBase: string = `/home/${username}/projects/${projectName}`;
        const args: FederationArgs = this.args_parse(rawArgs);

        // Abort
        if (args.abort) {
            this.federationState_set(null);
            return response_create('○ FEDERATION HANDSHAKE ABORTED. NO DISPATCH PERFORMED.', [], true);
        }

        // Already-complete check
        const federationComplete: boolean = this.vfs.node_stat(`${projectBase}/.federated`) !== null;
        const state: FederationState | null = this.federationState_get();
        const stateMatchesProject: boolean = !!state && state.projectId === activeMeta.id;

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

        // Initialize state if needed
        if (args.restart || !stateMatchesProject) {
            const newState: FederationState = state_create(activeMeta.id, projectName);
            this.federationState_set(newState);

            // Restart initializes state; user must then run `federate` to see briefing
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

        const dag: FederationDagPaths = dag_paths(projectBase);
        const currentState: FederationState | null = this.federationState_get();
        if (!currentState) {
            return response_create('>> ERROR: FEDERATION STATE INITIALIZATION FAILED.', [], false);
        }

        // Route by verb
        let response: CalypsoResponse;
        switch (verb) {
            case 'federate':
                response = step_brief(currentState, projectBase, dag, args);
                break;

            case 'approve':
                response = this.step_approve(currentState, projectBase, dag, projectName, args);
                break;

            case 'show':
                response = step_show(currentState, rawArgs, projectBase, dag);
                break;

            case 'config':
                response = step_config(currentState, rawArgs, args);
                break;

            case 'dispatch':
                response = step_dispatch(currentState, projectBase, dag, projectName, args, this.contentProvider);
                break;

            case 'status':
                response = step_status(currentState, projectBase, dag);
                break;

            case 'publish':
                const result = step_publish(currentState, projectBase, dag, projectName, this.vfs, this.federateArtifactPath);
                if (result.completed) {
                    this.federationState_set(null);
                }
                return result.response;

            default:
                return response_create(`>> ERROR: Unknown federation verb '${verb}'.`, [], false);
        }

        // Update state after step execution (in case it was mutated in place)
        // Only if not completed (null set handled in publish)
        if (this.federationState_get() !== null) {
            this.federationState_set(currentState);
        }
        return response;
    }

    /**
     * Start or advance the federation sequence (backward-compat wrapper).
     */
    federate(rawArgs: string[], username: string): CalypsoResponse {
        return this.command('federate', rawArgs, username);
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
    private step_approve(
        state: FederationState,
        projectBase: string,
        dag: FederationDagPaths,
        projectName: string,
        args: FederationArgs,
    ): CalypsoResponse {
        publish_mutate(state, args);

        switch (state.step) {
            case 'federate-brief':
                // Brief hasn't been shown yet; show it and advance
                return step_brief(state, projectBase, dag, args);

            case 'federate-transcompile':
                return step_transcompile_approve(state, projectBase, dag, this.contentProvider);

            case 'federate-containerize':
                return step_containerize_approve(state, projectBase, dag, this.contentProvider, this.vfs);

            case 'federate-publish-config':
                return step_publishConfig_approve(state);

            case 'federate-publish-execute':
                return step_publishExecute_approve(state, projectBase, dag, projectName, this.contentProvider, this.vfs);

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
     * Preserves backward compatibility with --yes, --name, --org, etc.
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
}
