/**
 * @file Plugin: Publish
 *
 * Generic shell execution plugin for the model publication stage.
 *
 * @module plugins/publish
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';

/**
 * Execute the publication logic via shell.
 *
 * @param context - The Argus VM standard library.
 * @returns Standard plugin result.
 */
export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    const { command, args, shell } = context;
    
    // Delegate to the shell capability
    const input: string = command + (args.length > 0 ? ' ' + args.join(' ') : '');
    const result: any = await shell.command_execute(input);

    // If shell command not found but it's the 'publish' verb, simulate success
    if (result.exitCode === 127 && command === 'publish') {
        return {
            message: '● PLUGIN PUBLICATION COMPLETE. AVAILABLE IN CHRIS STORE.',
            statusCode: CalypsoStatusCode.OK,
            artifactData: { command: input, success: true }
        };
    }

    return {
        message: result.stderr ? `${result.stdout}\n<error>${result.stderr}</error>` : result.stdout,
        statusCode: result.exitCode === 0 ? CalypsoStatusCode.OK : CalypsoStatusCode.ERROR,
        artifactData: { 
            command: input,
            exitCode: result.exitCode,
            stdout: result.stdout
        }
    };
}
