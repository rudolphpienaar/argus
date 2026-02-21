/**
 * @file Plugin: Federation Publish Execute
 *
 * Stage plugin for `federate-publish-execute`.
 *
 * @module plugins/federate-publish-execute
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';
import { dagPaths_resolve, projectRoot_resolve, publish_materialize, publishConfig_load, publishSummary_lines } from './federationShared.js';
import { simDelay_wait } from './simDelay.js';

export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    return context.comms.execute(async (): Promise<PluginResult> => {
        const projectRoot: string = projectRoot_resolve(context);
        const dag = dagPaths_resolve(projectRoot);
        const publish = publishConfig_load(context.vfs, projectRoot);

        if (context.command === 'show') {
            return {
                message: [
                    '● PUBLICATION REVIEW',
                    '',
                    ...publishSummary_lines(publish),
                    `○ OUTPUT: ${dag.publishData}`,
                    '',
                    '  `publish-execute` — Push to registry',
                ].join('\n'),
                statusCode: CalypsoStatusCode.CONVERSATIONAL,
            };
        }

        if (context.command !== 'publish-execute') {
            return {
                message: `>> ERROR: UNKNOWN PUBLISH-EXECUTE VERB '${context.command}'.`,
                statusCode: CalypsoStatusCode.ERROR,
            };
        }

        context.ui.log('○ INITIATING REGISTRY PUBLICATION...');
        const chunks: number = 10;
        for (let i = 1; i <= chunks; i++) {
            const percent: number = Math.round((i / chunks) * 100);
            context.ui.progress(`Pushing image blob chunk ${i}/${chunks}`, percent);
            await simDelay_wait(150);
        }
        context.ui.log('  ● Registry push successful. Manifest signed.');

        publish_materialize(context.vfs, dag, publish);
        return {
            message: [
                '● STEP 5/8 COMPLETE: REGISTRY PUBLICATION.',
                '',
                '○ SIGNING IMAGE REFERENCE + REGISTRY MANIFEST...',
                '○ WRITING APP METADATA + PUBLISH RECEIPTS...',
                ...publishSummary_lines(publish),
                '',
                `○ ARTIFACTS MATERIALIZED: ${dag.publishData}`,
                '',
                'Next: dispatch to federation network:',
                '  `dispatch`',
                '  `dispatch --sites BCH,MGH`',
            ].join('\n'),
            statusCode: CalypsoStatusCode.OK,
            artifactData: {
                step: 'federate-publish-execute',
                publish,
                output: dag.publishData,
            },
        };
    });
}
