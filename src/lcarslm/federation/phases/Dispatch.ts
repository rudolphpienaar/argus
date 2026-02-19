/**
 * @file Federation Dispatch Phase
 *
 * Handles federation dispatch, status monitoring, and final model publication.
 * v10.2: Compute-driven telemetry for federated compute rounds.
 *
 * @module
 */

import type { VirtualFileSystem } from '../../../vfs/VirtualFileSystem.js';
import type { PluginTelemetry, CalypsoResponse } from '../../types.js';
import type { FederationContentProvider } from '../FederationContentProvider.js';
import type { FederationArgs, FederationDagPaths, FederationState } from '../types.js';
import type { ArtifactEnvelope } from '../../../dag/store/types.js';
import { response_create } from '../utils.js';

/**
 * dispatch: Initiate federation dispatch.
 */
export async function step_dispatch(
    state: FederationState,
    projectBase: string,
    dag: FederationDagPaths,
    projectName: string,
    args: FederationArgs,
    contentProvider: FederationContentProvider,
    ui: PluginTelemetry,
    sleep: (ms: number) => Promise<void>
): Promise<CalypsoResponse> {
    if (state.step !== 'federate-dispatch') {
        return response_create(
            `○ Cannot dispatch yet — current step is ${state.step}. Complete earlier steps first.`,
            [], false
        );
    }

    // 1. Simulate Dispatch & Compute (The Experience)
    ui.log('○ INITIATING FEDERATION DISPATCH...');
    await dispatch_animate(ui, sleep);
    
    ui.log('● STEP 7/8: FEDERATED TRAINING EXECUTION.');
    await computeRounds_animate(ui, sleep);

    // 2. Materialize Artifacts (The Logic)
    contentProvider.dispatch_materialize(projectBase, dag);
    state.step = 'federate-execute';

    return response_create(
        [
            '● STEP 6/8 COMPLETE: FEDERATION DISPATCH.',
            '',
            '○ RESOLVING PARTICIPANT ENDPOINTS...',
            '○ DISTRIBUTING CONTAINER TO TRUSTED DOMAINS...',
            '  [BCH] -> DISPATCHED',
            '  [MGH] -> DISPATCHED',
            '  [BIDMC] -> DISPATCHED',
            '',
            `○ ARTIFACTS MATERIALIZED: ${dag.dispatchData}`,
            '',
            'Training complete. Publish the aggregated model:',
            '  `publish model`    — Publish trained model to marketplace',
            '  `show provenance`  — View full provenance chain',
            '  `show rounds`      — View per-round details',
        ].join('\n'),
        [],
        true,
        { render_mode: 'streaming', stream_delay_ms: 100 }
    );
}

/**
 * status: Show current federation training status.
 */
export function step_status(
    state: FederationState,
    projectBase: string,
    dag: FederationDagPaths,
): CalypsoResponse {
    if (state.step === 'federate-execute' || state.step === 'federate-model-publish') {
        return response_create(
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
            [], 
            true,
            { render_mode: 'streaming', stream_delay_ms: 100 }
        );
    }

    return response_create(
        `○ Federation training has not started yet. Current step: ${state.step}`,
        [], 
        true,
        { render_mode: 'plain' }
    );
}

/**
 * publish model: Publish the aggregated model and complete the handshake.
 */
export function step_publish(
    state: FederationState,
    projectBase: string,
    dag: FederationDagPaths,
    projectName: string,
    vfs: VirtualFileSystem,
    federateArtifactPath: string,
    ui: PluginTelemetry,
    sleep: (ms: number) => Promise<void>
): { response: CalypsoResponse, completed: boolean } {
    // Only "publish model" triggers completion
    if (state.step !== 'federate-execute' && state.step !== 'federate-model-publish') {
        return {
            response: response_create(
                `○ Cannot publish model yet — current step is ${state.step}. Complete federation first.`,
                [], false
            ),
            completed: false
        };
    }

    ui.log('○ PACKAGING AGGREGATED MODEL WEIGHTS...');
    ui.log('○ ATTACHING MERKLE PROVENANCE CHAIN...');

    // Materialize session tree artifact
    if (federateArtifactPath) {
        try {
            const dataDir = federateArtifactPath.substring(0, federateArtifactPath.lastIndexOf('/'));
            vfs.dir_create(dataDir);
            const envelope: ArtifactEnvelope = {
                stage: 'federate-brief',
                timestamp: new Date().toISOString(),
                parameters_used: {},
                content: { projectName: projectName, status: 'COMPLETED' },
                _fingerprint: '',
                _parent_fingerprints: {},
            };
            vfs.file_create(federateArtifactPath, JSON.stringify(envelope));
        } catch { /* ignore */ }
    }

    return {
        response: response_create(
            [
                '● STEP 8/8 COMPLETE: MODEL PUBLICATION.',
                '',
                '○ AGGREGATED MODEL WEIGHTS PACKAGED.',
                '○ PROVENANCE CHAIN ATTACHED (search → gather → harmonize → code → train → federate).',
                '○ MODEL PUBLISHED TO ATLAS MARKETPLACE.',
                '',
                `○ PROJECT: ${projectName}`,
                '',
                '<span class="success">● FEDERATION COMPLETE.</span>',
                '',
                '>> NEXT: Ask `next?` for post-federation guidance.',
            ].join('\n'),
            [{ type: 'federation_start' }],
            true,
            { spinner_label: 'Finalizing provenance' }
        ),
        completed: true
    };
}

/**
 * Simulated dispatch latency.
 */
async function dispatch_animate(ui: PluginTelemetry, sleep: (ms: number) => Promise<void>): Promise<void> {
    const sites = ['BCH', 'MGH', 'BIDMC'];
    for (let i = 0; i < sites.length; i++) {
        const percent = Math.round(((i + 1) / sites.length) * 100);
        ui.progress(`Dispatching to site ${sites[i]}`, percent);
        await sleep(400);
    }
}

/**
 * Simulated federated compute rounds.
 */
async function computeRounds_animate(ui: PluginTelemetry, sleep: (ms: number) => Promise<void>): Promise<void> {
    const rounds = 5;
    ui.log('○ FEDERATED COMPUTE ROUNDS INITIATED:');
    for (let r = 1; r <= rounds; r++) {
        const agg = (0.6 + (0.3 * (r / rounds)) + Math.random() * 0.05).toFixed(2);
        ui.log(`  ROUND ${r}/${rounds}  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=${agg}`);
        await sleep(600);
    }
    ui.log('  ● Convergence threshold met.');
}
