/**
 * @file Plugin: Rename
 *
 * Implements project renaming logic.
 * v10.2: Compute-driven telemetry for path migration.
 *
 * @module plugins/rename
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';
import type { Project } from '../core/models/types.js';
import { CalypsoPresenter } from '../lcarslm/CalypsoPresenter.js';
import { simDelay_wait } from './simDelay.js';

/**
 * Execute the rename logic.
 *
 * @param context - The Argus VM standard library.
 * @returns Standard plugin result.
 */
export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    return context.comms.execute(async (): Promise<PluginResult> => {
        const { args, store, shell, vfs, ui, dataDir } = context;
        
        let newName: string = args.join(' ');
        // Strip natural-language connectors: "to <name>", "this as <name>", "X as <name>", etc.
        const toMatch = newName.match(/(?:^|\s)to\s+(\S.*)/i);
        const asMatch = newName.match(/(?:^|\s)as\s+(\S.*)/i);
        if (toMatch) {
            newName = toMatch[1].trim();
        } else if (asMatch) {
            newName = asMatch[1].trim();
        }
        newName = newName.toLowerCase();

        if (!newName) {
            return {
                message: '>> ERROR: NO NEW NAME PROVIDED.',
                statusCode: CalypsoStatusCode.ERROR
            };
        }

        const active: Project | null = store.project_getActiveFull();
        if (!active) {
            return {
                message: CalypsoPresenter.error_format('NO ACTIVE PROJECT.'),
                statusCode: CalypsoStatusCode.ERROR
            };
        }

        ui.status(`CALYPSO: RENAMING PROJECT [${active.name}] -> [${newName}]`);
        
        // v11.0: Alias-Only Rename
        // In the Topological Viewport model, we don't move the physical container.
        // We just update the store. CalypsoCore will handle the viewport rotation.

        const updatedProject: Project = {
            ...active,
            name: newName,
            lastModified: new Date(),
        };
        store.project_setActive(updatedProject);

        shell.env_set('PROJECT', newName);

        // v12.0: Physical Contract - Materialize the view in our output/
        // Dynamically discover the primary parent — no hardcoded stage names.
        const inputDir = dataDir.replace(/\/output$/, '/input');
        const parents = vfs.dir_list(inputDir);
        if (parents.length > 0) {
            const parentId = parents[0].name;
            const parentOutputDir = `${inputDir}/${parentId}`;
            try {
                if (vfs.node_stat(parentOutputDir)) {
                    merge_causal(vfs, parentOutputDir, dataDir, parentId);
                }
            } catch (e) {
                // ignore
            }
        }

        return {
            message: `${CalypsoPresenter.success_format(`RENAMED TO [${newName}]`)}\n` +
                    `${CalypsoPresenter.info_format(`VIEWPORT ALIAS UPDATED IN STORE`)}`,
            statusCode: CalypsoStatusCode.OK,
            actions: [{ type: 'project_rename', id: active.id, newName }],
            artifactData: { oldName: active.name, newName },
            physicalDataDir: dataDir
        };
    });
}

/**
 * Implementation of Link-Merge logic (copied from workspace-commit for autonomy).
 */
function merge_causal(vfs: any, src: string, dest: string, parentId: string): void {
    const nodes = vfs.dir_list(src);

    for (const node of nodes) {
        // Skip system-owned infrastructure dirs
        if (['meta', 'input', 'output'].includes(node.name)) {
            continue;
        }

        const targetPath = `${dest}/${node.name}`;

        if (node.type === 'folder') {
            // Link all subdirectories — this is an alias-only operation
            vfs.link_create(targetPath, `../input/${parentId}/${node.name}`);
        } else {
            // Clone small work files
            vfs.tree_clone(node.path, targetPath);
        }
    }
}

/**
 * Simulated path migration latency.
 */
async function pathMigration_animate(context: PluginContext, oldPath: string, newPath: string): Promise<void> {
    const { ui } = context;
    ui.log(`○ Computing migration plan: ${oldPath} -> ${newPath}`);
    await simDelay_wait(200);
    
    const steps = ['Synchronizing shell context', 'Updating VFS node pointers', 'Verifying directory integrity'];
    for (let i = 0; i < steps.length; i++) {
        const percent = Math.round(((i + 1) / steps.length) * 100);
        ui.progress(steps[i], percent);
        await simDelay_wait(150);
    }
    ui.log('  ● Path migration complete.');
}
