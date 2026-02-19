/**
 * @file Federation Publish Phase
 *
 * Handles publication configuration and registry execution steps.
 * v10.2: Compute-driven telemetry for registry push.
 *
 * @module
 */

import type { VirtualFileSystem } from '../../../vfs/VirtualFileSystem.js';
import type { PluginTelemetry, CalypsoResponse } from '../../types.js';
import type { FederationContentProvider } from '../FederationContentProvider.js';
import type { FederationArgs, FederationDagPaths, FederationState } from '../types.js';
import { publishSummary_lines, publish_mutate, response_create } from '../utils.js';

/**
 * Approve publish-config → advance to publish-execute.
 */
export function step_publishConfig_approve(
    state: FederationState,
): CalypsoResponse {
    if (!state.publish.appName) {
        return response_create(
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
    return response_create(
        [
            '● PUBLICATION CONFIGURATION CONFIRMED.',
            '',
            ...publishSummary_lines(state.publish),
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
export async function step_publishExecute_approve(
    state: FederationState,
    projectBase: string,
    dag: FederationDagPaths,
    projectName: string,
    contentProvider: FederationContentProvider,
    vfs: VirtualFileSystem,
    ui: PluginTelemetry,
    sleep: (ms: number) => Promise<void>
): Promise<CalypsoResponse> {
    // 1. Simulate Registry Push Compute
    ui.log('○ INITIATING REGISTRY PUBLICATION...');
    await publish_animate(ui, sleep);

    // 2. Materialize Artifacts (The Logic)
    contentProvider.publish_materialize(dag, state.publish);
    state.step = 'federate-dispatch';

    return response_create(
        [
            '● STEP 5/8 COMPLETE: REGISTRY PUBLICATION.',
            '',
            '○ SIGNING IMAGE REFERENCE + REGISTRY MANIFEST...',
            '○ WRITING APP METADATA + PUBLISH RECEIPTS...',
            ...publishSummary_lines(state.publish),
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
 * config: Update publish metadata during federate-publish-config step.
 */
export function step_config(
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
        publish_mutate(state, args);
    }

    return response_create(
        [
            '● PUBLISH METADATA UPDATED.',
            '',
            ...publishSummary_lines(state.publish),
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
 * Simulated registry push latency.
 */
async function publish_animate(ui: PluginTelemetry, sleep: (ms: number) => Promise<void>): Promise<void> {
    const chunks = 10;
    for (let i = 1; i <= chunks; i++) {
        const percent = Math.round((i / chunks) * 100);
        ui.progress(`Pushing image blob chunk ${i}/${chunks}`, percent);
        await sleep(150);
    }
    ui.log('  ● Registry push successful. Manifest signed.');
}
