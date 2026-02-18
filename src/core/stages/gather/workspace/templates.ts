/**
 * @file Gather Workspace Template Selection
 *
 * Handles project template initialization UI and template materialization.
 *
 * Responsibilities:
 * - Render template-selector view for uninitialized projects.
 * - Bind template selection actions.
 * - Materialize selected project scaffold in VFS.
 * - Transition initialized project into expanded workspace mode.
 *
 * @module core/stages/gather/workspace/templates
 */

import { store } from '../../../state/store.js';
import { MOCK_PROJECTS } from '../../../data/projects.js';
import { chrisProject_populate, projectDir_populate } from '../../../../vfs/providers/ProjectProvider.js';
import type { Project } from '../../../models/types.js';
import { projectTemplateSelectorHtml_render } from '../ui/view.js';
import { workspace_expand } from './lifecycle.js';

/**
 * Supported project template identifiers.
 */
export type WorkspaceTemplateType = 'fedml' | 'chris';

/**
 * Materialize selected template and activate workspace mode.
 */
export function template_select(projectId: string, type: WorkspaceTemplateType): void {
    const project: Project | undefined = MOCK_PROJECTS.find((entry: Project): boolean => entry.id === projectId);
    if (!project) {
        return;
    }

    const username: string = store.globals.shell?.env_get('USER') || 'user';
    if (type === 'chris') {
        chrisProject_populate(store.globals.vcs, username, project.name);
    } else {
        projectDir_populate(store.globals.vcs, username, project.name);
    }

    workspace_expand(project);
}

/**
 * Render template selector and bind template action buttons.
 */
export function workspace_interactInitialize(projectId: string): void {
    const contentSlot: HTMLElement | null = document.getElementById('overlay-content-slot');
    if (!contentSlot) {
        return;
    }

    const project: Project | undefined = MOCK_PROJECTS.find((entry: Project): boolean => entry.id === projectId);
    if (!project) {
        return;
    }

    contentSlot.innerHTML = projectTemplateSelectorHtml_render(project.name);
    workspaceTemplateButtons_bind(projectId);
}

/**
 * Bind template picker button actions.
 */
function workspaceTemplateButtons_bind(projectId: string): void {
    setTimeout((): void => {
        document.getElementById('btn-tmpl-fedml')?.addEventListener('click', (): void => {
            template_select(projectId, 'fedml');
        });
        document.getElementById('btn-tmpl-chris')?.addEventListener('click', (): void => {
            template_select(projectId, 'chris');
        });
    }, 0);
}
