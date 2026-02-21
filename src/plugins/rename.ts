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
        const { args, store, shell, vfs, ui } = context;
        
        let newName: string = args.join(' ');
        if (newName.toLowerCase().startsWith('to ')) {
            newName = newName.substring(3).trim();
        } else if (newName.toLowerCase().startsWith('as ')) {
            newName = newName.substring(3).trim();
        }

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
        
        const username: string = shell.env_get('USER') || 'user';
        const oldPath: string = `/home/${username}/projects/${active.name}`;
        const newPath: string = `/home/${username}/projects/${newName}`;

        // Simulate path migration compute
        await pathMigration_animate(context, oldPath, newPath);

        if (vfs.node_stat(oldPath)) {
            vfs.node_move(oldPath, newPath);
        } else {
            vfs.dir_create(newPath);
            vfs.dir_create(`${newPath}/src`);
            vfs.dir_create(`${newPath}/input`);
            vfs.dir_create(`${newPath}/output`);
        }

        shell.env_set('PROJECT', newName);

        const cwd: string = vfs.cwd_get();
        if (cwd.startsWith(oldPath)) {
            const nextCwd: string = cwd.replace(oldPath, newPath);
            vfs.cwd_set(nextCwd);
        }

        const updatedProject: Project = {
            ...active,
            name: newName,
            lastModified: new Date(),
        };
        store.project_setActive(updatedProject);

        return {
            message: `${CalypsoPresenter.success_format(`RENAMED TO [${newName}]`)}\n` +
                    `${CalypsoPresenter.info_format(`VFS PATH MOVED TO ${newPath}`)}`,
            statusCode: CalypsoStatusCode.OK,
            actions: [{ type: 'project_rename', id: active.id, newName }],
            artifactData: { oldName: active.name, newName, path: newPath }
        };
    });
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
