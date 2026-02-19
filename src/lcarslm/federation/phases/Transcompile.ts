/**
 * @file Federation Transcompile Phase
 *
 * Handles the approval and materialization of the transcompilation step.
 *
 * @module
 */

import type { CalypsoResponse } from '../../types.js';
import type { FederationContentProvider } from '../FederationContentProvider.js';
import type { FederationDagPaths, FederationState } from '../types.js';
import { response_create } from '../utils.js';

/**
 * Approve transcompile → materialize step 1, advance to containerize.
 */
export function step_transcompile_approve(
    state: FederationState,
    projectBase: string,
    dag: FederationDagPaths,
    contentProvider: FederationContentProvider,
): CalypsoResponse {
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
        true,
        { spinner_label: 'Transcompiling source' }
    );
}
