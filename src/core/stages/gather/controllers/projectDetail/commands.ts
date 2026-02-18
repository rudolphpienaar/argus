/**
 * @file Project Detail Command Handlers
 *
 * Command-column rendering and interactions for project detail overlay.
 *
 * Responsibilities:
 * - Render project detail command pills.
 * - Handle upload and rename interactions.
 * - Route CODE action to workspace expand or template initialization.
 *
 * @module core/stages/gather/controllers/projectDetail/commands
 */

import { store } from '../../../../state/store.js';
import { files_ingest, files_prompt } from '../../../../logic/FileUploader.js';
import { projectContext_get } from '../../../../logic/ProjectContext.js';
import { project_rename } from '../../../../logic/ProjectManager.js';
import type { Project } from '../../../../models/types.js';
import type { ProjectDetailDeps } from './types.js';
import { workspace_expand } from '../../workspace/lifecycle.js';
import { workspace_interactInitialize } from '../../workspace/templates.js';

/**
 * Command renderer input contract.
 */
export interface ProjectDetailCommandsContext {
    project: Project;
    projectId: string;
    deps: ProjectDetailDeps;
    onClose(): void;
    onRefresh(): void;
}

/**
 * Render command column and bind project actions.
 */
export function projectDetailCommands_render(context: ProjectDetailCommandsContext): void {
    const commandSlot: HTMLElement | null = document.getElementById('overlay-command-slot');
    if (!commandSlot) {
        return;
    }

    commandSlot.style.setProperty('--module-color', 'var(--honey)');
    commandSlot.innerHTML = `
        <button class="pill-btn additional-data-pill" id="project-upload-btn" style="margin-bottom: 0;">
            <span class="btn-text">UPLOAD</span>
        </button>
        <button class="pill-btn additional-data-pill" id="project-rename-btn">
            <span class="btn-text">RENAME</span>
        </button>
        <button class="pill-btn close-pill" id="project-close-btn">
            <span class="btn-text">CLOSE</span>
        </button>
        <button class="pill-btn install-pill" id="project-code-btn">
            <span class="btn-text">CODE</span>
        </button>
    `;

    document.getElementById('project-upload-btn')?.addEventListener('click', async (event: Event): Promise<void> => {
        event.stopPropagation();
        await projectDetailUpload_handle(context.project, context.onRefresh);
    });

    document.getElementById('project-rename-btn')?.addEventListener('click', (event: Event): void => {
        event.stopPropagation();
        projectRename_interact(context.project, context.deps, context.onRefresh);
    });

    document.getElementById('project-close-btn')?.addEventListener('click', (): void => {
        context.onClose();
    });

    document.getElementById('project-code-btn')?.addEventListener('click', (event: Event): void => {
        event.stopPropagation();
        projectCode_handle(context.project, context.projectId);
    });
}

/**
 * Prompt file upload and refresh project detail panel.
 */
async function projectDetailUpload_handle(
    project: Project,
    onRefresh: () => void,
): Promise<void> {
    try {
        const files: File[] = await files_prompt();
        if (files.length === 0) {
            return;
        }

        const projectBase: string = projectContext_get(project).root;
        const fileCount: number = await files_ingest(files, projectBase);

        if (store.globals.terminal) {
            store.globals.terminal.println(`● UPLOAD COMPLETE: ${fileCount} FILES ADDED TO [${project.name}].`);
        }

        onRefresh();
    } catch (error: unknown) {
        console.error('Upload failed', error);
    }
}

/**
 * Prompt project rename, update model, and refresh active detail view.
 */
function projectRename_interact(
    project: Project,
    deps: ProjectDetailDeps,
    onRefresh: () => void,
): void {
    const oldName: string = project.name;
    const newNameRaw: string | null = prompt('ENTER NEW PROJECT NAME:', oldName);

    if (!newNameRaw || newNameRaw === oldName) {
        return;
    }

    const newName: string = newNameRaw.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!newName) {
        alert('Invalid name. Use alphanumeric characters only.');
        return;
    }

    project_rename(project, newName);
    deps.projectStrip_render();

    const nameEl: HTMLElement | null = document.getElementById('detail-name');
    if (nameEl) {
        nameEl.textContent = newName.toUpperCase();
    }

    const overlay: HTMLElement | null = document.getElementById('asset-detail-overlay');
    if (overlay && !overlay.classList.contains('hidden')) {
        onRefresh();
    }
}

/**
 * Route CODE action to workspace expand or template selector.
 */
function projectCode_handle(project: Project, projectId: string): void {
    const hasSourceTree: boolean = Boolean(store.globals.vcs.node_stat(`${projectContext_get(project).root}/src`));
    if (hasSourceTree) {
        workspace_expand(project);
        return;
    }

    workspace_interactInitialize(projectId);
}
