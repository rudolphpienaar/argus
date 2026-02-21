/**
 * @file Plugin: Federation Containerize
 *
 * Stage plugin for `federate-containerize`.
 *
 * @module plugins/federate-containerize
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';
import { containerize_materialize, dagPaths_resolve, projectRoot_resolve, publishConfig_load, publishSummary_lines } from './federationShared.js';
import { simDelay_wait } from './simDelay.js';

export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    return context.comms.execute(async (): Promise<PluginResult> => {
        const projectRoot: string = projectRoot_resolve(context);
        const dag = dagPaths_resolve(projectRoot);

        if (context.command === 'show') {
            return {
                message: [
                    '● CONTAINER BUILD REVIEW',
                    '',
                    '○ BASE IMAGE: python:3.11-slim',
                    `○ OUTPUT: ${dag.containerizeData}`,
                    '○ ARTIFACTS: Dockerfile, image.tar, image.digest, sbom.json, build.log',
                    '',
                    '○ The container packages your transcompiled code, dependencies, and',
                    '  Flower client into a MERIDIAN-compliant OCI image.',
                    '',
                    '  `containerize` — Build container image',
                ].join('\n'),
                statusCode: CalypsoStatusCode.CONVERSATIONAL,
            };
        }

        if (context.command !== 'containerize') {
            return {
                message: `>> ERROR: UNKNOWN CONTAINERIZE VERB '${context.command}'.`,
                statusCode: CalypsoStatusCode.ERROR,
            };
        }

        context.ui.log('○ INITIATING REPRODUCIBLE CONTAINER BUILD...');
        const layers: string[] = [
            'FROM python:3.11-slim',
            'COPY requirements.txt .',
            'RUN pip install -r requirements.txt',
            'COPY src/ .',
            'EXPORT image.tar',
        ];
        for (let i = 0; i < layers.length; i++) {
            const percent: number = Math.round(((i + 1) / layers.length) * 100);
            context.ui.progress(`Building layer ${i + 1}/${layers.length}: ${layers[i]}`, percent);
            await simDelay_wait(300);
        }

        containerize_materialize(context.vfs, dag);
        const publish = publishConfig_load(context.vfs, projectRoot);
        return {
            message: [
                '● STEP 2/8 COMPLETE: CONTAINER BUILD.',
                '',
                '○ RESOLVING BASE IMAGE + RUNTIME DEPENDENCIES...',
                '○ STAGING FEDERATED ENTRYPOINT + FLOWER HOOKS...',
                '○ BUILDING OCI IMAGE LAYERS...',
                '',
                `○ ARTIFACTS MATERIALIZED: ${dag.containerizeData}`,
                '',
                'Next: configure publication metadata:',
                ...publishSummary_lines(publish),
                '',
                '  `config name <app-name>`',
                '  `config org <namespace>`',
                '  `config visibility <public|private>`',
                '  `publish-config`',
            ].join('\n'),
            statusCode: CalypsoStatusCode.OK,
            artifactData: {
                step: 'federate-containerize',
                output: dag.containerizeData,
            },
        };
    });
}
