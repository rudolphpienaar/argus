/**
 * @file Plugin: Scaffold
 *
 * Implements project scaffolding logic for different workflow types (FedML, ChRIS).
 * v10.2: Compute-driven telemetry for code generation.
 *
 * @module plugins/scaffold
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';
import { CalypsoPresenter } from '../lcarslm/CalypsoPresenter.js';
import { simDelay_wait } from './simDelay.js';

/**
 * Execute the project scaffolding logic.
 *
 * @param context - The Argus VM standard library.
 * @returns Standard plugin result.
 */
export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    return context.comms.execute(async (): Promise<PluginResult> => {
        const { args, store, vfs, shell, parameters, ui, dataDir } = context;
        
        // 1. Resolve workflow identity
        const workflowId: string = args[0] || (parameters.workflowId as string) || 'fedml';
        const active: { id: string; name: string; } | null = store.project_getActive();
        
        const outputDir = `${dataDir}/output`;
        try { vfs.dir_create(outputDir); } catch { /* ignore */ }

        if (active) {
            ui.status(`CALYPSO: SCAFFOLDING ${workflowId.toUpperCase()} WORKSPACE...`);
            
            const username: string = shell.env_get('USER') || 'user';
            // v10.2: Materialize into the output subdirectory for DAG linking
            shell.env_set('PROJECT', active.name);
            
            // 2. Perform Simulated Compute (The Experience)
            await codeGeneration_animate(context, workflowId);

            // 3. Perform actual scaffolding (The Logic)
            const { projectDir_populate, chrisProject_populate } = await import('../vfs/providers/ProjectProvider.js');
            if (workflowId === 'chris') {
                chrisProject_populate(vfs, username, active.name, outputDir);
            } else {
                projectDir_populate(vfs, username, active.name, outputDir);
            }
            
            // 4. Update working directory
            vfs.cwd_set(outputDir);
            shell.env_set('PWD', outputDir);
        }

        const materialized = workflowId === 'chris'
            ? ['main.py', 'Dockerfile', 'requirements.txt', 'README.md', 'setup.py', 'chris_plugin_info.json']
            : ['train.py', 'config.yaml', 'requirements.txt', 'README.md', '.meridian/manifest.json'];

        return {
            message: CalypsoPresenter.success_format(`PROCEEDING WITH ${workflowId.toUpperCase()} WORKFLOW.`),
            statusCode: CalypsoStatusCode.OK,
            actions: [{ type: 'stage_advance', stage: 'process', workflow: workflowId }],
            artifactData: { workflowId, scaffolded: true },
            materialized,
            physicalDataDir: outputDir
        };
    });
}

/**
 * Simulated code generation latency.
 */
async function codeGeneration_animate(context: PluginContext, workflowId: string): Promise<void> {
    const { ui } = context;
    ui.log(`○ Generating ${workflowId} manifest and scaffold source...`);
    
    const assets = ['src/train.py', 'Dockerfile', 'plugin.json', 'requirements.txt', '.gitignore'];
    for (let i = 0; i < assets.length; i++) {
        const percent = Math.round(((i + 1) / assets.length) * 100);
        ui.progress(`Materializing ${assets[i]}`, percent);
        await simDelay_wait(150);
    }
    ui.log('  ● Scaffold complete. Validation environment initialized.');
}
