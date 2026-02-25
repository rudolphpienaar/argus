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
import { simDelay_wait } from './simDelay.js';

/**
 * Execute the training logic via shell.
 *
 * @param context - The Argus VM standard library.
 * @returns Standard plugin result.
 */
export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    return context.comms.execute(async (): Promise<PluginResult> => {
        const { command, args, shell, ui, parameters, dataDir } = context;
        
        // Map 'train' alias to the actual simulator command
        const executable: string = command === 'train' ? 'python' : command;
        const executableArgs: string[] = command === 'train' && args.length === 0 ? ['train.py'] : args;
        const input: string = executable + (executableArgs.length > 0 ? ' ' + executableArgs.join(' ') : '');

        // 1. Resolve hyperparameters
        const epochs: number = (parameters.epochs as number) || 5;

        // 2. Perform Simulated Training (The Live Feed)
        const label = context.stageId === 'test' ? 'TESTING' : 'VALIDATION';
        ui.status(`CALYPSO: INITIATING LOCAL ${label}...`);
        ui.log(`● [PHANTOM SIMULATOR] LOADING SOURCE: ${executableArgs[0] || 'code'}`);
        
        await training_animate(context, epochs);

        // 3. Delegate to the shell capability (The Deterministic Logic)
        // v10.2: Pass physical provenance dataDir to the shell for marker materialization
        const originalDataDir = shell.env_get('DATA_DIR');
        shell.env_set('DATA_DIR', dataDir);
        const result: ShellResult = await shell.command_execute(input);
        if (originalDataDir) shell.env_set('DATA_DIR', originalDataDir);
        else shell.env_all().delete('DATA_DIR');

        const returnLabel = context.stageId === 'test' ? 'TESTING' : 'TRAINING';
        return {
            message: result.stderr ? `${result.stdout}\n<error>${result.stderr}</error>` : result.stdout,
            statusCode: result.exitCode === 0 ? CalypsoStatusCode.OK : CalypsoStatusCode.ERROR,
            artifactData: { 
                step: context.stageId,
                command: input,
                exitCode: result.exitCode,
                stdout: result.stdout
            },
            materialized: ['.local_pass', `${context.stageId}.json`],
            physicalDataDir: dataDir,
            ui_hints: {
                render_mode: 'training',
                spinner_label: `● LOCAL ${returnLabel} COMPLETE.`
            }
        };
    });
}

/**
 * Simulated training loop with epoch telemetry.
 */
async function training_animate(context: PluginContext, epochs: number): Promise<void> {
    const { ui } = context;
    
    await simDelay_wait(400); // Loader lag
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
            await simDelay_wait(100);
        }
    }
    
    const finalLabel = context.stageId === 'test' ? 'TESTING' : 'TRAINING';
    ui.log(`● LOCAL ${finalLabel} COMPLETE. CONVERGENCE ACHIEVED.`);
    ui.log('  ○ Model weights saved to: /home/$USER/projects/$PROJECT/output/model.pth');
    ui.log('  ○ Validation metrics saved to: /home/$USER/projects/$PROJECT/output/val_metrics.json');
}
