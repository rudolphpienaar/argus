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
import { MOCK_PROJECTS } from '../core/data/projects.js';
import { project_rename } from '../core/logic/ProjectManager.js';
import { CalypsoPresenter } from '../lcarslm/CalypsoPresenter.js';

/**
 * Execute the rename logic.
 *
 * @param context - The Argus VM standard library.
 * @returns Standard plugin result.
 */
export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    const { args, store } = context;
    
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

    const active: { id: string; name: string; } | null = store.project_getActive();
    if (!active) {
        return {
            message: CalypsoPresenter.error_format('NO ACTIVE PROJECT.'),
            statusCode: CalypsoStatusCode.ERROR
        };
    }

    const project: Project | undefined = MOCK_PROJECTS.find((p: Project): boolean => p.id === active.id);
    if (!project) {
        return {
            message: CalypsoPresenter.error_format('PROJECT NOT FOUND.'),
            statusCode: CalypsoStatusCode.ERROR
        };
    }

    // Side effect: update VFS/Internal mapping
    const username: string = context.shell.env_get('USER') || 'user';
    const newPath: string = `/home/${username}/projects/${newName}`;
    project_rename(project, newName);

    return {
        message: `${CalypsoPresenter.success_format(`RENAMED TO [${newName}]`)}\n` +
                 `${CalypsoPresenter.info_format(`VFS PATH MOVED TO ${newPath}`)}`,
        statusCode: CalypsoStatusCode.OK,
        actions: [{ type: 'project_rename', id: project.id, newName }],
        artifactData: { oldName: active.name, newName, path: newPath }
    };
}
