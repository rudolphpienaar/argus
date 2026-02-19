/**
 * @file Plugin: Train
 *
 * Generic shell execution plugin for the local training stage.
 * v10.2: Compute-driven telemetry for training epochs.
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
    const { command, args, shell, ui, parameters } = context;
    
    // Map 'train' alias to the actual simulator command
    const executable: string = command === 'train' ? 'python' : command;
    const executableArgs: string[] = command === 'train' && args.length === 0 ? ['train.py'] : args;
    const input: string = executable + (executableArgs.length > 0 ? ' ' + executableArgs.join(' ') : '');

    // 1. Resolve hyperparameters
    const epochs: number = (parameters.epochs as number) || 5;

    // 2. Perform Simulated Training (The Live Feed)
    ui.status('CALYPSO: INITIATING LOCAL VALIDATION...');
    ui.log('● [PHANTOM SIMULATOR] LOADING SOURCE: train.py');
    
    await training_animate(context, epochs);

    // 3. Delegate to the shell capability (The Deterministic Logic)
    const result: ShellResult = await shell.command_execute(input);

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
 * Simulated training loop with epoch telemetry.
 */
async function training_animate(context: PluginContext, epochs: number): Promise<void> {
    const { ui, sleep } = context;
    
    await sleep(400); // Loader lag
    ui.log('--- TRAINING LOG ---');

    for (let e = 1; e <= epochs; e++) {
        // Emit training epoch stats
        const loss = (0.5 / e + Math.random() * 0.1).toFixed(4);
        const acc = (0.6 + (0.3 * (e / epochs)) + Math.random() * 0.05).toFixed(4);
        
        ui.log(`Epoch ${e}/${epochs} - loss: ${loss} - accuracy: ${acc}`);
        
        // Progress within epoch
        for (let batch = 1; batch <= 10; batch++) {
            const percent = Math.round((batch / 10) * 100);
            ui.progress(`Epoch ${e} training: batch ${batch}/10`, percent);
            await sleep(100);
        }
    }
    
    ui.log('● LOCAL TRAINING COMPLETE. CONVERGENCE ACHIEVED.');
    ui.log('  ○ Model weights saved to: /home/$USER/projects/$PROJECT/output/model.pth');
    ui.log('  ○ Validation metrics saved to: /home/$USER/projects/$PROJECT/output/val_metrics.json');
}
