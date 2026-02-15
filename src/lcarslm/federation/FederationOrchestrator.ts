/**
 * @file FederationOrchestrator - Manifest-Aligned Federation Handshake
 *
 * Manages the 8-step federation workflow aligned 1:1 with fedml.manifest.yaml
 * stage IDs. Each step responds to its manifest-defined commands:
 *
 *   federate-brief          → federate
 *   federate-transcompile   → show transcompile, approve
 *   federate-containerize   → show container, approve
 *   federate-publish-config → config name/org/visibility, approve
 *   federate-publish-execute→ show publish, approve
 *   federate-dispatch       → dispatch [--sites]
 *   federate-execute        → status, show metrics, show rounds
 *   federate-model-publish  → publish model, show provenance
 *
 * Each step materializes DAG artifacts in VFS before advancing.
 *
 * @module
 */

import type { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import type { CalypsoResponse, CalypsoAction, CalypsoStoreActions } from '../types.js';
import type {
    FederationState,
    FederationArgs,
    FederationDagPaths,
    FederationPublishConfig
} from './types.js';
import type { ArtifactEnvelope } from '../../dag/store/types.js';

/**
 * Orchestrates the multi-phase federation handshake protocol.
 *
 * The federation flow is an 8-step sequence matching the manifest:
 *   1. Federation Briefing        (federate-brief)
 *   2. Flower Transcompilation    (federate-transcompile)
 *   3. Container Build            (federate-containerize)
 *   4. Publication Configuration  (federate-publish-config)
 *   5. Registry Publication       (federate-publish-execute)
 *   6. Federation Dispatch        (federate-dispatch)
 *   7. Federated Training         (federate-execute)
 *   8. Model Publication          (federate-model-publish)
 *
 * Each step materializes artifacts in VFS before advancing to the next.
 */
export class FederationOrchestrator {
    /** Multi-phase federation handshake state. */
    private federationState: FederationState | null = null;

    /** Full path to the federate artifact file in session tree. */
    private federateArtifactPath: string = '';

    constructor(
        private vfs: VirtualFileSystem,
        private storeActions: CalypsoStoreActions
    ) {}

    /**
     * Set the federation artifact path for session tree writes.
     */
    session_set(artifactPath: string): void {
        this.federateArtifactPath = artifactPath;
    }

    // ─── Public API ───────────────────────────────────────────────────

    /**
     * Route a command verb to the appropriate federation step handler.
     *
     * @param verb - Command verb: federate, approve, show, config, dispatch, status, publish
     * @param rawArgs - Remaining tokens after the verb
     * @param username - Active username for path resolution
     */
    command(verb: string, rawArgs: string[], username: string): CalypsoResponse {
        const activeMeta = this.storeActions.project_getActive();
        if (!activeMeta) {
            return this.response_create('>> ERROR: NO ACTIVE PROJECT CONTEXT.', [], false);
        }

        const projectName: string = activeMeta.name;
        const projectBase: string = `/home/${username}/projects/${projectName}`;
        const args: FederationArgs = this.args_parse(rawArgs);

        // Abort
        if (args.abort) {
            this.federationState = null;
            return this.response_create('○ FEDERATION HANDSHAKE ABORTED. NO DISPATCH PERFORMED.', [], true);
        }

        // Already-complete check
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

        // Initialize state if needed
        if (args.restart || !stateMatchesProject) {
            this.federationState = this.state_create(activeMeta.id, projectName);

            // If restart + approve in same command, tell user to review first
            if (args.confirm) {
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
                        'Then confirm:',
                        '  `approve`'
                    ].join('\n'),
                    [],
                    true
                );
            }
        }

        const dag: FederationDagPaths = this.dag_paths(projectBase);
        const state: FederationState | null = this.federationState;
        if (!state) {
            return this.response_create('>> ERROR: FEDERATION STATE INITIALIZATION FAILED.', [], false);
        }

        // Route by verb
        switch (verb) {
            case 'federate':
                // Backward compat: federate --yes → approve
                if (args.confirm && this.federationState) {
                    return this.step_approve(state, projectBase, dag, projectName, args);
                }
                return this.step_brief(state, projectBase, dag, args);

            case 'approve':
                return this.step_approve(state, projectBase, dag, projectName, args);

            case 'show':
                return this.step_show(state, rawArgs, projectBase, dag);

            case 'config':
                return this.step_config(state, rawArgs, args);

            case 'dispatch':
                return this.step_dispatch(state, projectBase, dag, projectName, args);

            case 'status':
                return this.step_status(state, projectBase, dag);

            case 'publish':
                return this.step_publish(state, projectBase, dag, projectName);

            default:
                return this.response_create(`>> ERROR: Unknown federation verb '${verb}'.`, [], false);
        }
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
        this.federationState = null;
    }

    /**
     * Whether a federation handshake is currently active.
     */
    get active(): boolean {
        return this.federationState !== null;
    }

    /**
     * Current federation step, or null if no active handshake.
     */
    get currentStep(): FederationState['step'] | null {
        return this.federationState?.step ?? null;
    }

    // ─── Step Handlers ────────────────────────────────────────────────

    /**
     * federate-brief: Show federation briefing and advance to transcompile.
     */
    private step_brief(
        state: FederationState,
        projectBase: string,
        dag: FederationDagPaths,
        args: FederationArgs,
    ): CalypsoResponse {
        const metadataUpdated: boolean = this.publish_mutate(args);
        const lines: string[] = [
            '● FEDERATION BRIEFING',
            '',
            '○ Your code will be:',
            '  1. Transcompiled for Flower federated learning framework',
            '  2. Containerized as a MERIDIAN-compliant OCI image',
            '  3. Published to the ChRIS store registry',
            '  4. Dispatched to the federation network',
            '  5. Executed across participating sites',
            '  6. Aggregated model published to marketplace',
            '',
            `○ SOURCE: ${projectBase}/src/train.py`,
            `○ DAG ROOT: ${dag.crosscompileBase}`,
            '',
            'Review complete. Approve to begin transcompilation:',
            '  `approve`',
            '  `federate --abort`',
        ];
        if (metadataUpdated) {
            lines.push('', '○ NOTE: PUBLISH SETTINGS CAPTURED EARLY.');
        }

        state.step = 'federate-transcompile';
        return this.response_create(lines.join('\n'), [], true);
    }

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
        this.publish_mutate(args);

        switch (state.step) {
            case 'federate-brief':
                // Brief hasn't been shown yet; show it and advance
                return this.step_brief(state, projectBase, dag, args);

            case 'federate-transcompile':
                return this.step_transcompile_approve(state, projectBase, dag);

            case 'federate-containerize':
                return this.step_containerize_approve(state, projectBase, dag);

            case 'federate-publish-config':
                return this.step_publishConfig_approve(state, projectBase, dag);

            case 'federate-publish-execute':
                return this.step_publishExecute_approve(state, projectBase, dag, projectName);

            case 'federate-dispatch':
                return this.response_create(
                    '○ Dispatch requires the `dispatch` command, not `approve`.\n  `dispatch`\n  `dispatch --sites BCH,MGH,BIDMC`',
                    [], false
                );

            case 'federate-execute':
                return this.response_create(
                    '○ Training is in progress. Use `status` or `show rounds` to monitor.',
                    [], true
                );

            case 'federate-model-publish':
                return this.response_create(
                    '○ Use `publish model` to publish the trained model.',
                    [], true
                );

            default:
                return this.response_create('>> ERROR: No pending step to approve.', [], false);
        }
    }

    /**
     * Approve transcompile → materialize step 1, advance to containerize.
     */
    private step_transcompile_approve(
        state: FederationState,
        projectBase: string,
        dag: FederationDagPaths,
    ): CalypsoResponse {
        this.dag_step1TranscompileMaterialize(projectBase);
        state.step = 'federate-containerize';

        return this.response_create(
            [
                '● STEP 1/8 COMPLETE: FLOWER TRANSCOMPILATION.',
                '',
                '○ READING SOURCE: train.py',
                '○ PARSING TRAIN LOOP AND DATA LOADER CONTRACTS...',
                '○ INJECTING FLOWER CLIENT/SERVER HOOKS...',
                '○ EMITTING FEDERATED ENTRYPOINT: node.py',
                '○ WRITING EXECUTION ADAPTERS: flower_hooks.py',
                '○ WRITING TRANSCOMPILE RECEIPTS + ARTIFACT MANIFEST...',
                '',
                `○ ARTIFACTS MATERIALIZED: ${dag.crosscompileData}`,
                '',
                'Next: review container build or approve directly:',
                '  `show container` — Review container configuration',
                '  `approve`        — Build container image',
            ].join('\n'),
            [],
            true
        );
    }

    /**
     * Approve containerize → materialize step 2, advance to publish-config.
     */
    private step_containerize_approve(
        state: FederationState,
        projectBase: string,
        dag: FederationDagPaths,
    ): CalypsoResponse {
        this.dag_step2ContainerizeMaterialize(projectBase);
        try {
            this.vfs.file_create(`${projectBase}/.containerized`, new Date().toISOString());
        } catch { /* ignore */ }
        state.step = 'federate-publish-config';

        return this.response_create(
            [
                '● STEP 2/8 COMPLETE: CONTAINER BUILD.',
                '',
                '○ RESOLVING BASE IMAGE + RUNTIME DEPENDENCIES...',
                '○ STAGING FEDERATED ENTRYPOINT + FLOWER HOOKS...',
                '○ BUILDING OCI IMAGE LAYERS...',
                '○ WRITING SBOM + IMAGE DIGEST + BUILD LOG...',
                '',
                `○ ARTIFACTS MATERIALIZED: ${dag.containerizeData}`,
                '',
                'Next: configure publication metadata:',
                `  \`config name <app-name>\` — Set application name (current: ${state.publish.appName ?? '(unset)'})`,
                `  \`config org <namespace>\`  — Set organization`,
                `  \`config visibility <public|private>\``,
                '  `approve`                — Accept defaults and publish',
            ].join('\n'),
            [],
            true
        );
    }

    /**
     * Approve publish-config → advance to publish-execute.
     */
    private step_publishConfig_approve(
        state: FederationState,
        projectBase: string,
        dag: FederationDagPaths,
    ): CalypsoResponse {
        if (!state.publish.appName) {
            return this.response_create(
                [
                    '>> APP NAME REQUIRED BEFORE PUBLICATION.',
                    '○ SET: `config name <app-name>`',
                    '○ THEN: `approve`'
                ].join('\n'),
                [],
                false
            );
        }

        state.step = 'federate-publish-execute';
        return this.response_create(
            [
                '● PUBLICATION CONFIGURATION CONFIRMED.',
                '',
                ...this.publishSummary_lines(state.publish),
                '',
                'Next: review or approve registry publication:',
                '  `show publish`  — Review publication details',
                '  `approve`       — Push to registry',
            ].join('\n'),
            [],
            true
        );
    }

    /**
     * Approve publish-execute → materialize step 4, advance to dispatch.
     */
    private step_publishExecute_approve(
        state: FederationState,
        projectBase: string,
        dag: FederationDagPaths,
        projectName: string,
    ): CalypsoResponse {
        this.dag_step4PublishMaterialize(projectBase, state.publish);
        try {
            this.vfs.file_create(`${projectBase}/.published`, new Date().toISOString());
        } catch { /* ignore */ }
        state.step = 'federate-dispatch';

        return this.response_create(
            [
                '● STEP 5/8 COMPLETE: REGISTRY PUBLICATION.',
                '',
                '○ SIGNING IMAGE REFERENCE + REGISTRY MANIFEST...',
                '○ WRITING APP METADATA + PUBLISH RECEIPTS...',
                ...this.publishSummary_lines(state.publish),
                '',
                `○ ARTIFACTS MATERIALIZED: ${dag.publishData}`,
                '',
                'Next: dispatch to federation network:',
                '  `dispatch`                  — Dispatch to all sites',
                '  `dispatch --sites BCH,MGH`  — Dispatch to specific sites',
            ].join('\n'),
            [],
            true
        );
    }

    /**
     * show: Route to appropriate display based on subcommand or current step.
     */
    private step_show(
        state: FederationState,
        rawArgs: string[],
        projectBase: string,
        dag: FederationDagPaths,
    ): CalypsoResponse {
        const sub = rawArgs.join(' ').toLowerCase().trim();

        if (sub.startsWith('transcompile') || sub.startsWith('transpile')) {
            return this.response_create(
                [
                    '● TRANSCOMPILATION REVIEW',
                    '',
                    `○ SOURCE: ${projectBase}/src/train.py`,
                    `○ OUTPUT: ${dag.crosscompileData}`,
                    '○ ARTIFACTS: node.py, flower_hooks.py, transcompile.log, artifact.json',
                    '',
                    '○ The transcompiler wraps your training loop in Flower client hooks',
                    '  and generates a federated entrypoint (node.py) for site-local execution.',
                    '',
                    state.step === 'federate-transcompile' ? '  `approve` — Proceed with transcompilation' : '○ (already completed)',
                ].join('\n'),
                [], true
            );
        }

        if (sub.startsWith('container')) {
            return this.response_create(
                [
                    '● CONTAINER BUILD REVIEW',
                    '',
                    `○ BASE IMAGE: python:3.11-slim`,
                    `○ OUTPUT: ${dag.containerizeData}`,
                    '○ ARTIFACTS: Dockerfile, image.tar, image.digest, sbom.json, build.log',
                    '',
                    '○ The container packages your transcompiled code, dependencies, and',
                    '  Flower client into a MERIDIAN-compliant OCI image.',
                    '',
                    state.step === 'federate-containerize' ? '  `approve` — Build container image' : '○ (already completed)',
                ].join('\n'),
                [], true
            );
        }

        if (sub.startsWith('publish')) {
            return this.response_create(
                [
                    '● PUBLICATION REVIEW',
                    '',
                    ...this.publishSummary_lines(state.publish),
                    `○ OUTPUT: ${dag.publishData}`,
                    '',
                    state.step === 'federate-publish-execute' ? '  `approve` — Push to registry' : '○ (already completed or not yet configured)',
                ].join('\n'),
                [], true
            );
        }

        if (sub.startsWith('metric')) {
            return this.step_showMetrics(projectBase, dag);
        }

        if (sub.startsWith('round')) {
            return this.step_showRounds(projectBase, dag);
        }

        if (sub.startsWith('provenance')) {
            return this.step_showProvenance(state, projectBase, dag);
        }

        // Bare "show" — context-dependent
        return this.response_create(
            [
                '● FEDERATION SHOW COMMANDS',
                '',
                '  `show transcompile` — Review transcompilation output',
                '  `show container`    — Review container build',
                '  `show publish`      — Review publication config',
                '  `show metrics`      — Show training metrics',
                '  `show rounds`       — Show per-round details',
                '  `show provenance`   — Show full provenance chain',
            ].join('\n'),
            [], true
        );
    }

    /**
     * config: Update publish metadata during federate-publish-config step.
     */
    private step_config(
        state: FederationState,
        rawArgs: string[],
        args: FederationArgs,
    ): CalypsoResponse {
        // Parse "config name X", "config org Y", "config visibility public"
        const sub = rawArgs[0]?.toLowerCase();
        if (sub === 'name' && rawArgs[1]) {
            state.publish.appName = rawArgs.slice(1).join(' ');
        } else if (sub === 'org' && rawArgs[1]) {
            state.publish.org = rawArgs.slice(1).join(' ');
        } else if (sub === 'visibility' && rawArgs[1]) {
            const vis = rawArgs[1].toLowerCase();
            if (vis === 'public' || vis === 'private') {
                state.publish.visibility = vis;
            }
        } else {
            // Also handle --name/--org from args_parse
            this.publish_mutate(args);
        }

        return this.response_create(
            [
                '● PUBLISH METADATA UPDATED.',
                '',
                ...this.publishSummary_lines(state.publish),
                '',
                'Continue configuring or approve:',
                '  `config name <app-name>`',
                '  `config org <namespace>`',
                '  `config visibility <public|private>`',
                '  `approve` — Accept configuration',
            ].join('\n'),
            [],
            true
        );
    }

    /**
     * dispatch: Initiate federation dispatch.
     */
    private step_dispatch(
        state: FederationState,
        projectBase: string,
        dag: FederationDagPaths,
        projectName: string,
        args: FederationArgs,
    ): CalypsoResponse {
        if (state.step !== 'federate-dispatch') {
            return this.response_create(
                `○ Cannot dispatch yet — current step is ${state.step}. Complete earlier steps first.`,
                [], false
            );
        }

        // Materialize dispatch + round artifacts
        this.dag_phase3Materialize(projectBase);
        state.step = 'federate-execute';

        const participants = ['BCH', 'MGH', 'BIDMC'];
        return this.response_create(
            [
                '● STEP 6/8 COMPLETE: FEDERATION DISPATCH.',
                '',
                '○ RESOLVING PARTICIPANT ENDPOINTS...',
                '○ DISTRIBUTING CONTAINER TO TRUSTED DOMAINS...',
                ...participants.map(s => `  [${s}] -> DISPATCHED`),
                '',
                `○ ARTIFACTS MATERIALIZED: ${dag.dispatchData}`,
                '',
                '● STEP 7/8: FEDERATED TRAINING EXECUTION.',
                '',
                '○ FEDERATED COMPUTE ROUNDS:',
                '  ROUND 1/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.62',
                '  ROUND 2/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.71',
                '  ROUND 3/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.79',
                '  ROUND 4/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.84',
                '  ROUND 5/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.89',
                '',
                `○ ROUND METRICS MATERIALIZED: ${dag.roundsData}`,
                '',
                'Training complete. Publish the aggregated model:',
                '  `publish model`    — Publish trained model to marketplace',
                '  `show provenance`  — View full provenance chain',
                '  `show rounds`      — View per-round details',
            ].join('\n'),
            [],
            true
        );
    }

    /**
     * status: Show current federation training status.
     */
    private step_status(
        state: FederationState,
        projectBase: string,
        dag: FederationDagPaths,
    ): CalypsoResponse {
        if (state.step === 'federate-execute' || state.step === 'federate-model-publish') {
            return this.response_create(
                [
                    '● FEDERATION TRAINING STATUS: COMPLETE',
                    '',
                    '○ 5/5 rounds completed.',
                    '○ Final aggregate accuracy: 0.89',
                    '○ All 3 sites participated successfully.',
                    '',
                    `○ Metrics: ${dag.roundsData}/aggregate-metrics.json`,
                    '',
                    state.step === 'federate-execute'
                        ? 'Next:\n  `publish model` — Publish trained model'
                        : '○ Ready for model publication.',
                ].join('\n'),
                [], true
            );
        }

        return this.response_create(
            `○ Federation training has not started yet. Current step: ${state.step}`,
            [], true
        );
    }

    /**
     * publish model: Publish the aggregated model and complete the handshake.
     */
    private step_publish(
        state: FederationState,
        projectBase: string,
        dag: FederationDagPaths,
        projectName: string,
    ): CalypsoResponse {
        // Only "publish model" triggers completion
        if (state.step !== 'federate-execute' && state.step !== 'federate-model-publish') {
            return this.response_create(
                `○ Cannot publish model yet — current step is ${state.step}. Complete federation first.`,
                [], false
            );
        }

        // Write final markers
        try {
            this.vfs.file_create(`${projectBase}/.federated`, new Date().toISOString());
        } catch { /* ignore */ }

        // Materialize session tree artifact
        if (this.federateArtifactPath) {
            try {
                const dataDir = this.federateArtifactPath.substring(0, this.federateArtifactPath.lastIndexOf('/'));
                this.vfs.dir_create(dataDir);
                const envelope: ArtifactEnvelope = {
                    stage: 'federate-brief',
                    timestamp: new Date().toISOString(),
                    parameters_used: {},
                    content: { projectName: projectName, status: 'COMPLETED' },
                    _fingerprint: '',
                    _parent_fingerprints: {},
                };
                this.vfs.file_create(this.federateArtifactPath, JSON.stringify(envelope));
            } catch { /* ignore */ }
        }

        this.federationState = null;

        return this.response_create(
            [
                '● STEP 8/8 COMPLETE: MODEL PUBLICATION.',
                '',
                '○ AGGREGATED MODEL WEIGHTS PACKAGED.',
                '○ PROVENANCE CHAIN ATTACHED (search → gather → harmonize → code → train → federate).',
                '○ MODEL PUBLISHED TO ATLAS MARKETPLACE.',
                '',
                `○ PROJECT: ${projectName}`,
                `○ MARKER: ${projectBase}/.federated`,
                '',
                '<span class="success">● FEDERATION COMPLETE.</span>',
                '',
                '>> NEXT: Ask `next?` for post-federation guidance.',
            ].join('\n'),
            [{ type: 'federation_start' }],
            true
        );
    }

    // ─── Show Sub-Handlers ────────────────────────────────────────────

    private step_showMetrics(projectBase: string, dag: FederationDagPaths): CalypsoResponse {
        return this.response_create(
            [
                '● FEDERATION METRICS',
                '',
                '○ Final aggregate accuracy: 0.89',
                '○ Loss trajectory: 0.38 → 0.11',
                '○ Rounds: 5/5 complete',
                '○ Participants: BCH, MGH, BIDMC (3/3)',
                '',
                `○ Details: ${dag.roundsData}/aggregate-metrics.json`,
            ].join('\n'),
            [], true
        );
    }

    private step_showRounds(projectBase: string, dag: FederationDagPaths): CalypsoResponse {
        return this.response_create(
            [
                '● FEDERATION ROUNDS',
                '',
                '  ROUND 1/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.62',
                '  ROUND 2/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.71',
                '  ROUND 3/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.79',
                '  ROUND 4/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.84',
                '  ROUND 5/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.89',
                '',
                `○ Details: ${dag.roundsData}`,
            ].join('\n'),
            [], true
        );
    }

    private step_showProvenance(
        state: FederationState,
        projectBase: string,
        dag: FederationDagPaths,
    ): CalypsoResponse {
        return this.response_create(
            [
                '● PROVENANCE CHAIN',
                '',
                '  search → gather → harmonize → code → train → federate',
                '',
                `  ○ Source: ${projectBase}/src/train.py`,
                `  ○ Transcompiled: ${dag.crosscompileData}`,
                `  ○ Containerized: ${dag.containerizeData}`,
                `  ○ Published: ${dag.publishData}`,
                `  ○ Dispatched: ${dag.dispatchData}`,
                `  ○ Rounds: ${dag.roundsData}`,
            ].join('\n'),
            [], true
        );
    }

    // ─── Argument Parsing ─────────────────────────────────────────────

    /**
     * Parse federate arguments into structured flags.
     * Preserves backward compatibility with --yes, --name, --org, etc.
     */
    private args_parse(rawArgs: string[]): FederationArgs {
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

    // ─── State Management ─────────────────────────────────────────────

    /**
     * Create initial federation state for a project.
     */
    private state_create(projectId: string, projectName: string): FederationState {
        return {
            projectId,
            step: 'federate-brief',
            publish: {
                appName: `${projectName}-fedapp`,
                org: null,
                visibility: 'public'
            }
        };
    }

    /**
     * Apply publish config mutations from command arguments.
     */
    private publish_mutate(args: FederationArgs): boolean {
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

    // ─── Display Helpers ──────────────────────────────────────────────

    private publishSummary_lines(publish: FederationPublishConfig): string[] {
        return [
            `○ APP: ${publish.appName ?? '(unset)'}`,
            `○ ORG: ${publish.org ?? '(none)'}`,
            `○ VISIBILITY: ${publish.visibility.toUpperCase()}`,
        ];
    }

    // ─── DAG Materialization ──────────────────────────────────────────

    private dag_paths(projectBase: string): FederationDagPaths {
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
            crosscompileBase, crosscompileData,
            containerizeBase, containerizeData,
            publishBase, publishData,
            dispatchBase, dispatchData, dispatchReceipts,
            roundsBase, roundsData
        };
    }

    private dag_write(path: string, content: string): void {
        const parent: string = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '/';
        this.vfs.dir_create(parent);
        this.vfs.node_write(path, content);
    }

    private dag_step1TranscompileMaterialize(projectBase: string): void {
        const dag: FederationDagPaths = this.dag_paths(projectBase);
        const now: string = new Date().toISOString();
        this.vfs.dir_create(dag.crosscompileData);
        this.vfs.dir_create(dag.containerizeBase);

        this.dag_write(
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
        this.dag_write(
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
        this.dag_write(
            `${dag.crosscompileData}/transcompile.log`,
            `TRANSPILE START: ${now}\nSOURCE: ${projectBase}/src/train.py\nSTATUS: COMPLETE\n`
        );
        this.dag_write(
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

    private dag_step2ContainerizeMaterialize(projectBase: string): void {
        const dag: FederationDagPaths = this.dag_paths(projectBase);
        const now: string = new Date().toISOString();
        this.vfs.dir_create(dag.containerizeData);
        this.vfs.dir_create(dag.publishBase);

        this.dag_write(
            `${dag.containerizeData}/Dockerfile`,
            [
                'FROM python:3.11-slim',
                'WORKDIR /app',
                'COPY ../source-crosscompile/data/node.py /app/node.py',
                'COPY ../source-crosscompile/data/flower_hooks.py /app/flower_hooks.py',
                'CMD ["python", "/app/node.py"]'
            ].join('\n')
        );
        this.dag_write(`${dag.containerizeData}/image.tar`, 'SIMULATED OCI IMAGE TAR\n');
        this.dag_write(`${dag.containerizeData}/image.digest`, 'sha256:simulatedfedmlimage0001\n');
        this.dag_write(
            `${dag.containerizeData}/sbom.json`,
            JSON.stringify({ format: 'spdx-json', generatedAt: now, packages: ['python', 'flwr'] }, null, 2)
        );
        this.dag_write(
            `${dag.containerizeData}/build.log`,
            `BUILD START: ${now}\nLAYER CACHE: HIT\nIMAGE: COMPLETE\n`
        );
    }

    private dag_step4PublishMaterialize(projectBase: string, publish: FederationPublishConfig): void {
        const dag: FederationDagPaths = this.dag_paths(projectBase);
        const now: string = new Date().toISOString();
        this.vfs.dir_create(dag.publishData);
        this.vfs.dir_create(dag.dispatchBase);

        const appName: string = publish.appName || 'unnamed-fedml-app';
        this.dag_write(
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
        this.dag_write(
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
        this.dag_write(`${dag.publishData}/registry-ref.txt`, `internal://argus-marketplace/${appName}:latest\n`);
        this.dag_write(
            `${dag.publishData}/publish.log`,
            `PUBLISH START: ${now}\nAPP: ${appName}\nSTATUS: COMPLETE\n`
        );
    }

    private dag_phase3Materialize(projectBase: string): void {
        const dag: FederationDagPaths = this.dag_paths(projectBase);
        const now: string = new Date().toISOString();
        const participants: string[] = ['BCH', 'MGH', 'BIDMC'];

        this.vfs.dir_create(dag.dispatchData);
        this.vfs.dir_create(dag.dispatchReceipts);
        this.vfs.dir_create(dag.roundsData);

        this.dag_write(
            `${dag.dispatchData}/participants.json`,
            JSON.stringify(
                participants.map((site: string) => ({ site, endpoint: `federation://${site.toLowerCase()}/node`, status: 'ready' })),
                null,
                2
            )
        );
        this.dag_write(
            `${dag.dispatchData}/dispatch.log`,
            `DISPATCH START: ${now}\nTARGETS: ${participants.join(', ')}\nSTATUS: COMPLETE\n`
        );
        this.dag_write(
            `${dag.dispatchReceipts}/bch.json`,
            JSON.stringify({ site: 'BCH', status: 'accepted', timestamp: now }, null, 2)
        );
        this.dag_write(
            `${dag.dispatchReceipts}/mgh.json`,
            JSON.stringify({ site: 'MGH', status: 'accepted', timestamp: now }, null, 2)
        );
        this.dag_write(
            `${dag.dispatchReceipts}/bidmc.json`,
            JSON.stringify({ site: 'BIDMC', status: 'accepted', timestamp: now }, null, 2)
        );

        const rounds: number[] = [1, 2, 3, 4, 5];
        const aggregate: number[] = [0.62, 0.71, 0.79, 0.84, 0.89];
        rounds.forEach((round: number, idx: number): void => {
            this.dag_write(
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
        this.dag_write(
            `${dag.roundsData}/aggregate-metrics.json`,
            JSON.stringify({ finalAggregate: 0.89, rounds: aggregate, completedAt: now }, null, 2)
        );
        this.dag_write(`${dag.roundsData}/final-checkpoint.bin`, 'SIMULATED_CHECKPOINT_PAYLOAD\n');

        this.dag_write(
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

    // ─── Helpers ──────────────────────────────────────────────────────

    private response_create(
        message: string,
        actions: CalypsoAction[],
        success: boolean
    ): CalypsoResponse {
        return { message, actions, success };
    }
}
