/**
 * @file Plugin: Federation Dispatch
 *
 * Stage plugin for `federate-dispatch`.
 *
 * @module plugins/federate-dispatch
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';
import { dagPaths_resolve, dispatch_materialize, dispatchSites_parse, projectRoot_resolve } from './federationShared.js';
import { simDelay_wait } from './simDelay.js';

export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    return context.comms.execute(async (): Promise<PluginResult> => {
        if (context.command !== 'dispatch') {
            return {
                message: `>> ERROR: UNKNOWN DISPATCH VERB '${context.command}'. Use 'dispatch'.`,
                statusCode: CalypsoStatusCode.ERROR,
            };
        }

        const projectRoot: string = projectRoot_resolve(context);
        const dag = dagPaths_resolve(projectRoot);
        const sites: string[] = dispatchSites_parse(context.args);

        context.ui.log('○ INITIATING FEDERATION DISPATCH...');
        for (let i = 0; i < sites.length; i++) {
            const percent: number = Math.round(((i + 1) / sites.length) * 100);
            context.ui.progress(`Dispatching to site ${sites[i]}`, percent);
            await simDelay_wait(400);
        }

        context.ui.log('● STEP 7/8: FEDERATED TRAINING EXECUTION.');
        const rounds: number = 5;
        context.ui.log('○ FEDERATED COMPUTE ROUNDS INITIATED:');
        for (let r = 1; r <= rounds; r++) {
            const agg: string = (0.6 + (0.3 * (r / rounds)) + Math.random() * 0.05).toFixed(2);
            context.ui.log(`  ROUND ${r}/${rounds}  ${sites.map((s: string) => `[${s}:OK]`).join(' ')}  AGG=${agg}`);
            await simDelay_wait(600);
        }
        context.ui.log('  ● Convergence threshold met.');

        dispatch_materialize(context.vfs, projectRoot, dag, sites);
        return {
            message: [
                '● STEP 6/8 COMPLETE: FEDERATION DISPATCH.',
                '',
                '○ RESOLVING PARTICIPANT ENDPOINTS...',
                '○ DISTRIBUTING CONTAINER TO TRUSTED DOMAINS...',
                ...sites.map((site: string) => `  [${site}] -> DISPATCHED`),
                '',
                `○ ARTIFACTS MATERIALIZED: ${dag.dispatchData}`,
                '',
                'Training complete. Publish the aggregated model:',
                '  `publish model`',
                '  `show provenance`',
                '  `show rounds`',
            ].join('\n'),
            statusCode: CalypsoStatusCode.OK,
            artifactData: {
                step: 'federate-dispatch',
                sites,
                output: dag.dispatchData,
            },
            ui_hints: { render_mode: 'streaming', stream_delay_ms: 100 },
        };
    });
}
