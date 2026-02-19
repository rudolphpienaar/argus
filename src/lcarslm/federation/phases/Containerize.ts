/**
 * @file Federation Containerize Phase
 *
 * Handles the approval and materialization of the container build step.
 * v10.2: Compute-driven telemetry for OCI image build.
 *
 * @module
 */

import type { VirtualFileSystem } from '../../../vfs/VirtualFileSystem.js';
import type { PluginTelemetry, CalypsoResponse } from '../../types.js';
import type { FederationContentProvider } from '../FederationContentProvider.js';
import type { FederationDagPaths, FederationState } from '../types.js';
import { response_create } from '../utils.js';

/**
 * Approve containerize → materialize step 2, advance to publish-config.
 */
export async function step_containerize_approve(
    state: FederationState,
    projectBase: string,
    dag: FederationDagPaths,
    contentProvider: FederationContentProvider,
    vfs: VirtualFileSystem,
    ui: PluginTelemetry,
    sleep: (ms: number) => Promise<void>
): Promise<CalypsoResponse> {
    // 1. Simulate Build Compute
    ui.log('○ INITIATING REPRODUCIBLE CONTAINER BUILD...');
    await containerize_animate(ui, sleep);

    // 2. Materialize Artifacts (The Logic)
    contentProvider.containerize_materialize(dag);
    state.step = 'federate-publish-config';

    return response_create(
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
 * Simulated container build latency.
 */
async function containerize_animate(ui: PluginTelemetry, sleep: (ms: number) => Promise<void>): Promise<void> {
    const layers = [
        'FROM python:3.11-slim',
        'COPY requirements.txt .',
        'RUN pip install -r requirements.txt',
        'COPY src/ .',
        'EXPORT image.tar'
    ];

    for (let i = 0; i < layers.length; i++) {
        const percent = Math.round(((i + 1) / layers.length) * 100);
        ui.progress(`Building layer ${i + 1}/${layers.length}: ${layers[i]}`, percent);
        await sleep(300);
    }
}
