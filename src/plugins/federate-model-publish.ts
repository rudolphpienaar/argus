/**
 * @file Plugin: Federation Model Publish
 *
 * Stage plugin for `federate-model-publish`.
 *
 * @module plugins/federate-model-publish
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';
import { dagPaths_resolve, projectRoot_resolve } from './federationShared.js';

export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    return context.comms.execute(async (): Promise<PluginResult> => {
        const projectRoot: string = projectRoot_resolve(context);
        const dag = dagPaths_resolve(projectRoot);

        if (context.command === 'show') {
            const sub: string = context.args.join(' ').toLowerCase().trim();
            if (sub.startsWith('provenance')) {
                return {
                    message: [
                        '● PROVENANCE CHAIN',
                        '',
                        '  search → gather → harmonize → code → train → federate',
                        '',
                        `  ○ Source: ${projectRoot}/src/train.py`,
                        `  ○ Transcompiled: ${dag.crosscompileData}`,
                        `  ○ Containerized: ${dag.containerizeData}`,
                        `  ○ Published: ${dag.publishData}`,
                        `  ○ Dispatched: ${dag.dispatchData}`,
                        `  ○ Rounds: ${dag.roundsData}`,
                    ].join('\n'),
                    statusCode: CalypsoStatusCode.CONVERSATIONAL,
                };
            }
        }

        if (context.command !== 'publish' || context.args[0]?.toLowerCase() !== 'model') {
            return {
                message: `>> ERROR: UNKNOWN MODEL-PUBLISH VERB '${context.command}'. Use 'publish model'.`,
                statusCode: CalypsoStatusCode.ERROR,
            };
        }

        const markerPath: string = `${projectRoot}/.federated`;
        if (context.vfs.node_stat(markerPath)) {
            context.vfs.node_write(markerPath, `FEDERATED: ${new Date().toISOString()}\n`);
        } else {
            context.vfs.file_create(markerPath, `FEDERATED: ${new Date().toISOString()}\n`);
        }

        return {
            message: [
                '● STEP 8/8 COMPLETE: MODEL PUBLICATION.',
                '',
                '○ AGGREGATED MODEL WEIGHTS PACKAGED.',
                '○ PROVENANCE CHAIN ATTACHED (search → gather → harmonize → code → train → federate).',
                '○ MODEL PUBLISHED TO ATLAS MARKETPLACE.',
                '',
                `<span class="success">● FEDERATION COMPLETE.</span>`,
                '',
                '>> NEXT: Ask `next?` for post-federation guidance.',
            ].join('\n'),
            statusCode: CalypsoStatusCode.OK,
            actions: [{ type: 'federation_start' }],
            artifactData: {
                step: 'federate-model-publish',
                projectRoot,
                markerPath,
            },
            ui_hints: { spinner_label: 'Finalizing provenance' },
        };
    });
}
