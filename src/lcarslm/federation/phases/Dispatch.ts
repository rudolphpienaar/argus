/**
 * @file Federation Dispatch Phase
 *
 * Handles federation dispatch, status monitoring, and final model publication.
 *
 * @module
 */

import type { VirtualFileSystem } from '../../../vfs/VirtualFileSystem.js';
import type { CalypsoResponse } from '../../types.js';
import type { FederationContentProvider } from '../FederationContentProvider.js';
import type { FederationArgs, FederationDagPaths, FederationState } from '../types.js';
import type { ArtifactEnvelope } from '../../../dag/store/types.js';
import { response_create } from '../utils.js';

/**
 * dispatch: Initiate federation dispatch.
 */
export function step_dispatch(
    state: FederationState,
    projectBase: string,
    dag: FederationDagPaths,
    projectName: string,
    args: FederationArgs,
    contentProvider: FederationContentProvider
): CalypsoResponse {
    if (state.step !== 'federate-dispatch') {
        return response_create(
            `○ Cannot dispatch yet — current step is ${state.step}. Complete earlier steps first.`,
            [], false
        );
    }

    // Materialize dispatch + round artifacts
    contentProvider.dispatch_materialize(projectBase, dag);
    state.step = 'federate-execute';

    const participants: string[] = ['BCH', 'MGH', 'BIDMC'];
    return response_create(
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
        true,
        { render_mode: 'streaming', stream_delay_ms: 200 }
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
 * Returns null state to indicate completion.
 */
export function step_publish(
    state: FederationState,
    projectBase: string,
    dag: FederationDagPaths,
    projectName: string,
    vfs: VirtualFileSystem,
    federateArtifactPath: string
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
