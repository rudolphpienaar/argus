/**
 * @file Structural Plugin: Workspace Commit
 * 
 * Causal work-file scrounger. Explicitly clones user workshop files 
 * (scripts, READMEs) from parent to child while linking large data assets.
 * 
 * @module plugins/workspace-commit
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';

/**
 * Execute the workspace commit (Link-Merge).
 */
export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    const { vfs, dataDir } = context;
    const inputDir = dataDir.replace(/\/output$/, '/input');

    try {
        const parents = vfs.dir_list(inputDir);
        if (parents.length === 0) {
            return { message: '○ NO PARENT DATA TO MERGE.', statusCode: CalypsoStatusCode.OK };
        }

        // Simplistic: Merge from the first parent
        const parentId = parents[0].name;
        const parentOutputDir = `${inputDir}/${parentId}`;

        // v12.0: Pure Plugin Transformation
        // We use the relative helper to merge. 
        // Note: we link large data and clone small work.
        merge_causal(vfs, parentOutputDir, dataDir, parentId);

        return {
            message: `● WORKSPACE COMMITTED FROM ${parentId.toUpperCase()}`,
            statusCode: CalypsoStatusCode.OK,
            artifactData: {
                mergedFrom: parentId,
                timestamp: new Date().toISOString()
            }
        };

    } catch (e) {
        return {
            message: `>> ERROR: WORKSPACE COMMIT FAILED. ${e instanceof Error ? e.message : String(e)}`,
            statusCode: CalypsoStatusCode.ERROR
        };
    }
}

/**
 * Implementation of Link-Merge logic.
 */
function merge_causal(vfs: any, src: string, dest: string, parentId: string): void {
    const nodes = vfs.dir_list(src);

    for (const node of nodes) {
        // v12.0: Skip system-owned infrastructure dirs
        if (['meta', 'input', 'output'].includes(node.name)) {
            continue;
        }

        const targetPath = `${dest}/${node.name}`;

        if (node.type === 'folder') {
            // Link all subdirectories to parent — no domain-specific name checks
            vfs.link_create(targetPath, `../input/${parentId}/${node.name}`);
        } else {
            // Clone small files (scripts, configs)
            vfs.tree_clone(node.path, targetPath);
        }
    }
}
