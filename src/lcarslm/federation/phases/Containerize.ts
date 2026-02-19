/**
 * @file Federation Containerize Phase
 *
 * Handles the approval and materialization of the container build step.
 *
 * @module
 */

import type { VirtualFileSystem } from '../../../vfs/VirtualFileSystem.js';
import type { CalypsoResponse } from '../../types.js';
import type { FederationContentProvider } from '../FederationContentProvider.js';
import type { FederationDagPaths, FederationState } from '../types.js';
import { response_create } from '../utils.js';

/**
 * Approve containerize → materialize step 2, advance to publish-config.
 */
export function step_containerize_approve(
    state: FederationState,
    projectBase: string,
    dag: FederationDagPaths,
    contentProvider: FederationContentProvider,
    vfs: VirtualFileSystem
): CalypsoResponse {
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
        true,
        { spinner_label: 'Building OCI image' }
    );
}
