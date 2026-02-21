/**
 * @file Plugin: Federation Briefing
 *
 * Stage plugin for `federate-brief`.
 *
 * @module plugins/federate-brief
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';
import { dagPaths_resolve, projectRoot_resolve, publishConfig_load, publishConfig_save, publishSummary_lines } from './federationShared.js';

export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    return context.comms.execute(async (): Promise<PluginResult> => {
        if (context.command !== 'federate') {
            return {
                message: `>> ERROR: UNKNOWN FEDERATION BRIEF VERB '${context.command}'.`,
                statusCode: CalypsoStatusCode.ERROR,
            };
        }

        const projectRoot: string = projectRoot_resolve(context);
        const dag = dagPaths_resolve(projectRoot);
        const publish = publishConfig_load(context.vfs, projectRoot);
        publishConfig_save(context.vfs, projectRoot, publish);

        return {
            message: [
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
                `○ SOURCE: ${projectRoot}/src/train.py`,
                `○ DAG ROOT: ${dag.crosscompileBase}`,
                '',
                ...publishSummary_lines(publish),
                '',
                'Review complete. Begin transcompilation:',
                '  `transcompile`',
            ].join('\n'),
            statusCode: CalypsoStatusCode.OK,
            artifactData: {
                step: 'federate-brief',
                publish,
                projectRoot,
            },
        };
    });
}
