/**
 * @file Federation Briefing Phase
 *
 * Handles the initial federation briefing and metadata setup.
 *
 * @module
 */

import type { CalypsoResponse } from '../../types.js';
import type { FederationArgs, FederationDagPaths, FederationState } from '../types.js';
import { publish_mutate, response_create } from '../utils.js';

/**
 * Show federation briefing and advance to transcompile.
 */
export function step_brief(
    state: FederationState,
    projectBase: string,
    dag: FederationDagPaths,
    args: FederationArgs,
): CalypsoResponse {
    const metadataUpdated: boolean = publish_mutate(state, args);
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
    // State mutation happens in-place on the object, caller must persist it.
    
    return response_create(lines.join('\n'), [], true);
}
