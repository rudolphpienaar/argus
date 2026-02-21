/**
 * @file Plugin: Federation Transcompile
 *
 * Stage plugin for `federate-transcompile`.
 *
 * @module plugins/federate-transcompile
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';
import { dagPaths_resolve, projectRoot_resolve, transcompile_materialize } from './federationShared.js';
import { simDelay_wait } from './simDelay.js';

export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    return context.comms.execute(async (): Promise<PluginResult> => {
        const projectRoot: string = projectRoot_resolve(context);
        const dag = dagPaths_resolve(projectRoot);

        if (context.command === 'show') {
            return {
                message: [
                    '● TRANSCOMPILATION REVIEW',
                    '',
                    `○ SOURCE: ${projectRoot}/src/train.py`,
                    `○ OUTPUT: ${dag.crosscompileData}`,
                    '○ ARTIFACTS: node.py, flower_hooks.py, transcompile.log, artifact.json',
                    '',
                    '○ The transcompiler wraps your training loop in Flower client hooks',
                    '  and generates a federated entrypoint (node.py) for site-local execution.',
                    '',
                    '  `transcompile` — Proceed with transcompilation',
                ].join('\n'),
                statusCode: CalypsoStatusCode.CONVERSATIONAL,
            };
        }

        if (context.command !== 'transcompile') {
            return {
                message: `>> ERROR: UNKNOWN TRANSCOMPILE VERB '${context.command}'.`,
                statusCode: CalypsoStatusCode.ERROR,
            };
        }

        context.ui.log('○ INITIATING FLOWER TRANSCOMPILATION...');
        const steps: string[] = [
            'Reading source: train.py',
            'Parsing AST and contract discovery',
            'Injecting Flower client/server hooks',
            'Emitting federated entrypoint: node.py',
            'Writing execution adapters: flower_hooks.py',
        ];
        for (let i = 0; i < steps.length; i++) {
            const percent: number = Math.round(((i + 1) / steps.length) * 100);
            context.ui.progress(steps[i], percent);
            await simDelay_wait(200);
        }

        transcompile_materialize(context.vfs, projectRoot, dag);
        return {
            message: [
                '● STEP 1/8 COMPLETE: FLOWER TRANSCOMPILATION.',
                '',
                '○ READING SOURCE: train.py',
                '○ PARSING TRAIN LOOP AND DATA LOADER CONTRACTS...',
                '○ INJECTING FLOWER CLIENT/SERVER HOOKS...',
                '○ EMITTING FEDERATED ENTRYPOINT: node.py',
                '○ WRITING EXECUTION ADAPTERS: flower_hooks.py',
                '',
                `○ ARTIFACTS MATERIALIZED: ${dag.crosscompileData}`,
                '',
                'Next: review container build or continue directly:',
                '  `show container` — Review container configuration',
                '  `containerize`   — Build container image',
            ].join('\n'),
            statusCode: CalypsoStatusCode.OK,
            artifactData: {
                step: 'federate-transcompile',
                output: dag.crosscompileData,
            },
        };
    });
}
