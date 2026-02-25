/**
 * @file Plugin: Federation Publish Config
 *
 * Stage plugin for `federate-publish-config`.
 *
 * @module plugins/federate-publish-config
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';
import { publishConfig_load, publishConfig_save, publishSummary_lines, projectRoot_resolve } from './federationShared.js';

export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    return context.comms.execute(async (): Promise<PluginResult> => {
        const projectRoot: string = projectRoot_resolve(context);
        const publish = publishConfig_load(context.vfs, projectRoot);

        if (context.command === 'config') {
            const sub: string = (context.args[0] || '').toLowerCase();
            const value: string = context.args.slice(1).join(' ').trim();

            if (sub === 'name' && value) {
                publish.appName = value;
            } else if (sub === 'org' && value) {
                publish.org = value;
            } else if (sub === 'visibility' && (value === 'public' || value === 'private')) {
                publish.visibility = value;
            }

            publishConfig_save(context.vfs, projectRoot, publish);
            return {
                message: [
                    '● PUBLISH METADATA UPDATED.',
                    '',
                    ...publishSummary_lines(publish),
                    '',
                    'Continue configuring or finalize:',
                    '  `config name <app-name>`',
                    '  `config org <namespace>`',
                    '  `config visibility <public|private>`',
                    '  `publish-config`',
                ].join('\n'),
                statusCode: CalypsoStatusCode.OK,
            };
        }

        if (context.command !== 'publish-config') {
            return {
                message: `>> ERROR: UNKNOWN PUBLISH-CONFIG VERB '${context.command}'.`,
                statusCode: CalypsoStatusCode.ERROR,
            };
        }

        if (!publish.appName) {
            return {
                message: [
                    '>> APP NAME REQUIRED BEFORE PUBLICATION.',
                    '○ SET: `config name <app-name>`',
                    '○ THEN: `publish-config`',
                ].join('\n'),
                statusCode: CalypsoStatusCode.ERROR,
            };
        }

        publishConfig_save(context.vfs, projectRoot, publish);
        return {
            message: [
                '● PUBLICATION CONFIGURATION CONFIRMED.',
                '',
                ...publishSummary_lines(publish),
                '',
                'Next: review or execute registry publication:',
                '  `show publish`',
                '  `publish-execute`',
            ].join('\n'),
            statusCode: CalypsoStatusCode.OK,
            artifactData: {
                step: 'federate-publish-config',
                publish,
            },
        };
    });
}
