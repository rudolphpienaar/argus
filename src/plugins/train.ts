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
    const { command, args, shell } = context;
    
    // Map 'train' alias to the actual simulator command
    const executable: string = command === 'train' ? 'python' : command;
    const executableArgs: string[] = command === 'train' && args.length === 0 ? ['train.py'] : args;
    
    // Delegate to the shell capability
    const input: string = executable + (executableArgs.length > 0 ? ' ' + executableArgs.join(' ') : '');
    const result: ShellResult = await shell.command_execute(input);

    return {
        message: result.stderr ? `${result.stdout}
<error>${result.stderr}</error>` : result.stdout,
        statusCode: result.exitCode === 0 ? CalypsoStatusCode.OK : CalypsoStatusCode.ERROR,
        artifactData: { 
            command: input,
            exitCode: result.exitCode,
            stdout: result.stdout
        }
    };
}
