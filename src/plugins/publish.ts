/**
 * @file Plugin: Publish
 *
 * Generic shell execution plugin for the model publication stage.
 * v10.2: Compute-driven telemetry for registry push.
 *
 * @module plugins/publish
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';
import type { ShellResult } from '../vfs/types.js';

/**
 * Execute the publication logic via shell.
 *
 * @param context - The Argus VM standard library.
 * @returns Standard plugin result.
 */
export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    const { command, args, shell, ui, sleep } = context;
    
    // v10.2: Start Live Telemetry
    ui.status('CALYPSO: PUBLISHING MODEL TO MARKETPLACE...');
    
    // Delegate to the shell capability
    const input: string = command + (args.length > 0 ? ' ' + args.join(' ') : '');
    const result: ShellResult = await shell.command_execute(input);

    // If shell command not found but it's the 'publish' verb, simulate success with telemetry
    if (result.exitCode === 127 && command === 'publish') {
        await publish_animate(context);
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

/**
 * Simulated registry push latency.
 */
async function publish_animate(context: PluginContext): Promise<void> {
    const { ui, sleep } = context;
    ui.log('○ PACKAGING ARTIFACTS AND SIGNING MANIFEST...');
    await sleep(400);
    
    const chunks = 10;
    for (let i = 1; i <= chunks; i++) {
        const percent = Math.round((i / chunks) * 100);
        ui.progress(`Pushing image blob chunk ${i}/${chunks}`, percent);
        await sleep(150);
    }
    ui.log('  ● Registry push successful. Manifest signed.');
}
