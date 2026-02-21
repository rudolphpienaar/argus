/**
 * @file Plugin: Federation Execute
 *
 * Stage plugin for `federate-execute`.
 *
 * @module plugins/federate-execute
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';
import { dagPaths_resolve, projectRoot_resolve } from './federationShared.js';

export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    return context.comms.execute(async (): Promise<PluginResult> => {
        const projectRoot: string = projectRoot_resolve(context);
        const dag = dagPaths_resolve(projectRoot);

        if (context.command === 'status') {
            return {
                message: [
                    '● FEDERATION TRAINING STATUS: COMPLETE',
                    '',
                    '○ 5/5 rounds completed.',
                    '○ Final aggregate accuracy: 0.89',
                    '○ All 3 sites participated successfully.',
                    '',
                    `○ Metrics: ${dag.roundsData}/aggregate-metrics.json`,
                    '',
                    'Next:',
                    '  `publish model` — Publish trained model',
                ].join('\n'),
                statusCode: CalypsoStatusCode.OK,
                artifactData: {
                    step: 'federate-execute',
                    status: 'complete',
                    roundsData: dag.roundsData,
                },
                ui_hints: { render_mode: 'streaming', stream_delay_ms: 100 },
            };
        }

        if (context.command === 'show') {
            const sub: string = context.args.join(' ').toLowerCase().trim();
            if (sub.startsWith('metric')) {
                return {
                    message: [
                        '● FEDERATION METRICS',
                        '',
                        '○ Final aggregate accuracy: 0.89',
                        '○ Loss trajectory: 0.38 → 0.11',
                        '○ Rounds: 5/5 complete',
                        '',
                        `○ Details: ${dag.roundsData}/aggregate-metrics.json`,
                    ].join('\n'),
                    statusCode: CalypsoStatusCode.OK,
                    artifactData: { step: 'federate-execute', view: 'metrics' },
                };
            }

            if (sub.startsWith('round')) {
                return {
                    message: [
                        '● FEDERATION ROUNDS',
                        '',
                        '  ROUND 1/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.62',
                        '  ROUND 2/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.71',
                        '  ROUND 3/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.79',
                        '  ROUND 4/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.84',
                        '  ROUND 5/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.89',
                        '',
                        `○ Details: ${dag.roundsData}`,
                    ].join('\n'),
                    statusCode: CalypsoStatusCode.OK,
                    artifactData: { step: 'federate-execute', view: 'rounds' },
                };
            }
        }

        return {
            message: `>> ERROR: UNKNOWN EXECUTE VERB '${context.command}'.`,
            statusCode: CalypsoStatusCode.ERROR,
        };
    });
}
