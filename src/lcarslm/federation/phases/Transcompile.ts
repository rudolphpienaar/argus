/**
 * @file Federation Transcompile Phase
 *
 * Handles the approval and materialization of the transcompilation step.
 * v10.2: Compute-driven telemetry for source transcompilation.
 *
 * @module
 */

import type { PluginTelemetry, CalypsoResponse } from '../../types.js';
import type { FederationContentProvider } from '../FederationContentProvider.js';
import type { FederationDagPaths, FederationState } from '../types.js';
import { response_create } from '../utils.js';

/**
 * Approve transcompile → materialize step 1, advance to containerize.
 */
export async function step_transcompile_approve(
    state: FederationState,
    projectBase: string,
    dag: FederationDagPaths,
    contentProvider: FederationContentProvider,
    ui: PluginTelemetry,
    sleep: (ms: number) => Promise<void>
): Promise<CalypsoResponse> {
    // 1. Simulate Transcompile Compute
    ui.log('○ INITIATING FLOWER TRANSCOMPILATION...');
    await transcompile_animate(ui, sleep);

    // 2. Materialize Artifacts (The Logic)
    contentProvider.transcompile_materialize(projectBase, dag);
    state.step = 'federate-containerize';

    return response_create(
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
 * Simulated transcompilation latency.
 */
async function transcompile_animate(ui: PluginTelemetry, sleep: (ms: number) => Promise<void>): Promise<void> {
    const steps = [
        'Reading source: train.py',
        'Parsing AST and contract discovery',
        'Injecting Flower client/server hooks',
        'Emitting federated entrypoint: node.py',
        'Writing execution adapters: flower_hooks.py'
    ];

    for (let i = 0; i < steps.length; i++) {
        const percent = Math.round(((i + 1) / steps.length) * 100);
        ui.progress(steps[i], percent);
        await sleep(200);
    }
}
