/**
 * @file FederationOrchestrator - Multi-Phase Federation Handshake
 *
 * Manages the 5-step federation workflow: transcompile, containerize,
 * publish prepare, publish configure, and dispatch + compute rounds.
 * Each step materializes DAG artifacts in VFS before advancing.
 *
 * Extracted from CalypsoCore to isolate federation state management.
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
 * The federation flow is a 5-step DAG:
 *   1. Source Code Transcompile
 *   2. Container Compilation
 *   3. Marketplace Publish Preparation
 *   4. Marketplace Publish (configure + execute)
 *   5. Dispatch + Federated Compute Rounds
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
     * @param artifactPath - Full VFS path to federate artifact (e.g. session/gather/.../federate-brief/data/federate-brief.json)
     */
    session_set(artifactPath: string): void {
        this.federateArtifactPath = artifactPath;
    }

    /**
     * Start or advance the federation sequence.
     */
    federate(rawArgs: string[], username: string): CalypsoResponse {
        const activeMeta = this.storeActions.project_getActive();
        if (!activeMeta) {
            return this.response_create('>> ERROR: NO ACTIVE PROJECT CONTEXT.', [], false);
        }

        const projectName: string = activeMeta.name;
        const projectBase: string = `/home/${username}/projects/${projectName}`;
        const args: FederationArgs = this.args_parse(rawArgs);
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
            this.federationState = this.state_create(activeMeta.id, projectName);
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

        const metadataUpdated: boolean = this.publish_mutate(args);
        const dag: FederationDagPaths = this.dag_paths(projectBase);
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

            this.dag_step1TranscompileMaterialize(projectBase);
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

            this.dag_step2ContainerizeMaterialize(projectBase);
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
                        ...this.publish_promptLines(federationState.publish)
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
                    ...this.publish_promptLines(federationState.publish)
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
                    ...this.publish_promptLines(federationState.publish)
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

            this.dag_step4PublishMaterialize(projectBase, federationState.publish);
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
                    ...this.publishSummary_lines(federationState.publish),
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

        this.dag_phase3Materialize(projectBase);
        try {
            this.vfs.file_create(`${projectBase}/.federated`, new Date().toISOString());
        } catch { /* ignore */ }

        // Materialize federate artifact in session tree (topology-aware path)
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

    // ─── Argument Parsing ─────────────────────────────────────────────────

    /**
     * Parse federate arguments into structured flags.
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

    // ─── State Management ─────────────────────────────────────────────────

    /**
     * Create initial federation state for a project.
     */
    private state_create(projectId: string, projectName: string): FederationState {
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

    // ─── Display Helpers ──────────────────────────────────────────────────

    /**
     * Render publish settings summary lines.
     */
    private publishSummary_lines(publish: FederationPublishConfig): string[] {
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
    private publish_promptLines(publish: FederationPublishConfig): string[] {
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

    // ─── DAG Materialization ──────────────────────────────────────────────

    /**
     * Resolve canonical DAG paths for federate stage materialization.
     */
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

    /**
     * Write a DAG artifact, creating parent directories if required.
     */
    private dag_write(path: string, content: string): void {
        const parent: string = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '/';
        this.vfs.dir_create(parent);
        this.vfs.node_write(path, content);
    }

    /**
     * Materialize step-1 (source-crosscompile) DAG artifacts.
     */
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

    /**
     * Materialize step-2 (container compilation) DAG artifacts.
     */
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

    /**
     * Materialize step-4 (marketplace publish execution) DAG artifacts.
     */
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

    /**
     * Materialize phase-3 (dispatch + federated rounds) DAG artifacts.
     */
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

    // ─── Helpers ──────────────────────────────────────────────────────────

    private response_create(
        message: string,
        actions: CalypsoAction[],
        success: boolean
    ): CalypsoResponse {
        return { message, actions, success };
    }
}
