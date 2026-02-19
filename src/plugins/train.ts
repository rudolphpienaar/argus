/**
 * @file Plugin: Train
 *
 * Generic shell execution plugin for the local training stage.
 *
 * @module plugins/train
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';
import type { ShellResult } from '../vfs/types.js';

/**
 * Execute the training logic via shell.
 *
 * @param context - The Argus VM standard library.
 * @returns Standard plugin result.
 */
export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    const { command, args, shell, ui } = context;
    
    // Map 'train' alias to the actual simulator command
    const executable: string = command === 'train' ? 'python' : command;
    const executableArgs: string[] = command === 'train' && args.length === 0 ? ['train.py'] : args;
    
    // v10.2: Start Live Telemetry
    ui.status('CALYPSO: INITIATING LOCAL VALIDATION...');
    ui.log('● [PHANTOM SIMULATOR] LOADING SOURCE: train.py');

    // Delegate to the shell capability
    const input: string = executable + (executableArgs.length > 0 ? ' ' + executableArgs.join(' ') : '');
    const result: ShellResult = await shell.command_execute(input);

    // v10.2: If result looks like training output, we could stream it here, 
    // but the Shell already executed. In a true VM, the Shell itself would 
    // stream to the telemetry bus. For now, we simulate the "Post-Shell" emission.
    if (result.exitCode === 0) {
        ui.log('● LOCAL TRAINING COMPLETE. CONVERGENCE ACHIEVED.');
    }

    return {
        message: result.stderr ? `${result.stdout}
<error>${result.stderr}</error>` : result.stdout,
        statusCode: result.exitCode === 0 ? CalypsoStatusCode.OK : CalypsoStatusCode.ERROR,
        artifactData: { 
            command: input,
            exitCode: result.exitCode,
            stdout: result.stdout
        },
        ui_hints: {
            render_mode: 'streaming',
            stream_delay_ms: 150
        }
    };
}
