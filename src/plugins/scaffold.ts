/**
 * @file Plugin: Scaffold
 *
 * Implements project scaffolding logic for different workflow types (FedML, ChRIS).
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
    const { args, store, vfs, shell, parameters } = context;
    
    // 1. Resolve workflow identity
    const workflowId: string = args[0] || (parameters.workflowId as string) || 'fedml';
    const active: { id: string; name: string; } | null = store.project_getActive();
    
    if (active) {
        const username: string = shell.env_get('USER') || 'user';
        const projectPath: string = `/home/${username}/projects/${active.name}/src`;
        shell.env_set('PROJECT', active.name);
        
        // 2. Perform dynamic scaffolding
        const { projectDir_populate, chrisProject_populate } = await import('../vfs/providers/ProjectProvider.js');
        if (workflowId === 'chris') {
            chrisProject_populate(vfs, username, active.name);
        } else {
            projectDir_populate(vfs, username, active.name);
        }
        
        // 3. Update working directory
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
