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

/**
 * Execute the project scaffolding logic.
 *
 * @param context - The Argus VM standard library.
 * @returns Standard plugin result.
 */
export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    const { args, store, vfs, shell, parameters, ui } = context;
    
    // 1. Resolve workflow identity
    const workflowId: string = args[0] || (parameters.workflowId as string) || 'fedml';
    const active: { id: string; name: string; } | null = store.project_getActive();
    
    if (active) {
        ui.status(`CALYPSO: SCAFFOLDING ${workflowId.toUpperCase()} WORKSPACE...`);
        
        const username: string = shell.env_get('USER') || 'user';
        const projectPath: string = `/home/${username}/projects/${active.name}/src`;
        shell.env_set('PROJECT', active.name);
        
        // 2. Perform Simulated Compute (The Experience)
        await codeGeneration_animate(context, workflowId);

        // 3. Perform actual scaffolding (The Logic)
        const { projectDir_populate, chrisProject_populate } = await import('../vfs/providers/ProjectProvider.js');
        if (workflowId === 'chris') {
            chrisProject_populate(vfs, username, active.name);
        } else {
            projectDir_populate(vfs, username, active.name);
        }
        
        // 4. Update working directory
        vfs.cwd_set(projectPath);
        shell.env_set('PWD', projectPath);
    }

    return {
        message: CalypsoPresenter.success_format(`PROCEEDING WITH ${workflowId.toUpperCase()} WORKFLOW.`),
        statusCode: CalypsoStatusCode.OK,
        actions: [{ type: 'stage_advance', stage: 'process', workflow: workflowId }],
        artifactData: { workflowId, scaffolded: true }
    };
}

/**
 * Simulated code generation latency.
 */
async function codeGeneration_animate(context: PluginContext, workflowId: string): Promise<void> {
    const { ui, sleep } = context;
    ui.log(`○ Generating ${workflowId} manifest and scaffold source...`);
    
    const assets = ['src/train.py', 'Dockerfile', 'plugin.json', 'requirements.txt', '.gitignore'];
    for (let i = 0; i < assets.length; i++) {
        const percent = Math.round(((i + 1) / assets.length) * 100);
        ui.progress(`Materializing ${assets[i]}`, percent);
        await sleep(150);
    }
    ui.log('  ● Scaffold complete. Validation environment initialized.');
}
