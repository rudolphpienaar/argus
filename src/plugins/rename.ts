/**
 * @file Plugin: Rename
 *
 * Implements project renaming logic.
 *
 * @module plugins/rename
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';
import type { Project } from '../core/models/types.js';
import { CalypsoPresenter } from '../lcarslm/CalypsoPresenter.js';

/**
 * Execute the rename logic.
 *
 * @param context - The Argus VM standard library.
 * @returns Standard plugin result.
 */
export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    const { args, store, shell, vfs } = context;
    
    let newName: string = args.join(' ');
    if (newName.toLowerCase().startsWith('to ')) {
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

    const username: string = shell.env_get('USER') || 'user';
    const oldPath: string = `/home/${username}/projects/${active.name}`;
    const newPath: string = `/home/${username}/projects/${newName}`;

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
}
