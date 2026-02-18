/**
 * @file Gather Stage Logic
 *
 * Composition root for Gather-stage orchestration.
 *
 * Responsibilities:
 * - Own gather-target project context and gathered dataset runtime store.state.
 * - Drive project/dataset detail overlays and workspace transitions.
 * - Coordinate transition gating from Gather to Process.
 * - Maintain legacy gather preview/cost panel updates.
 *
 * @module core/stages/gather
 */

import { store } from '../state/store.js';
import { events, Events } from '../state/events.js';
import { MOCK_PROJECTS } from '../data/projects.js';
import { costEstimate_calculate } from '../logic/costs.js';
import { cohortTree_build } from '../../vfs/providers/DatasetProvider.js';
import { project_rename } from '../logic/ProjectManager.js';
import type { Dataset, Project, CostEstimate } from '../models/types.js';
import type { FileNode as VcsFileNode } from '../../vfs/types.js';
import { proceedToCode_execute } from './gather/actions/proceed.js';
import { project_activate } from './gather/actions/projects.js';
import {
    projectDetail_open as projectDetailController_open,
    type ProjectDetailDeps,
} from './gather/controllers/projectDetail.js';
import {
    datasetDetail_open as datasetDetailController_open,
    dataset_add as datasetController_add,
    type DatasetDetailDeps,
} from './gather/controllers/datasetDetail.js';
import {
    template_select as workspaceTemplate_select,
    workspace_interactInitialize,
    type WorkspaceTemplateType,
} from './gather/workspace/templates.js';
import { workspace_teardown } from './gather/workspace/lifecycle.js';
import { gatherStage_state } from './gather/runtime/state.js';
import { projectStripHtml_render } from './gather/ui/view.js';

export {
    project_activate,
    workspace_teardown,
};

// ============================================================================
// Lifecycle Hooks
// ============================================================================

/**
 * Hook called when entering the Gather stage.
 */
export function stage_enter(): void {
    filesystem_build();
    costs_calculate();
}

/**
 * Hook called when exiting the Gather stage.
 */
export function stage_exit(): void {
    // Teardown if needed.
}

// ============================================================================
// Gather Orchestration
// ============================================================================

/**
 * Return currently active gather target project.
 */
export function gatherTargetProject_get(): Project | null {
    return gatherStage_state.gatherTargetProject;
}

/**
 * Open project detail overlay through dedicated Gather controller.
 */
export function projectDetail_open(projectId: string): void {
    const deps: ProjectDetailDeps = {
        projectStrip_render,
    };
    projectDetailController_open(projectId, deps);
}

/**
 * Open dataset detail overlay through dedicated Gather controller.
 */
export function datasetDetail_open(datasetId: string): void {
    const deps: DatasetDetailDeps = {
        projectStrip_render,
    };
    datasetDetailController_open(datasetId, deps);
}

/**
 * Gather full dataset through dedicated Gather controller.
 */
export function dataset_add(datasetId: string): void {
    const deps: DatasetDetailDeps = {
        projectStrip_render,
    };
    datasetController_add(datasetId, deps);
}

/**
 * Apply chosen template and transition into workspace mode.
 */
export function template_select(projectId: string, type: WorkspaceTemplateType): void {
    workspaceTemplate_select(projectId, type);
}

/**
 * Transition from Gather into Process stage.
 */
export async function proceedToCode_handle(): Promise<void> {
    return proceedToCode_execute({
        projectDetail_open,
        workspace_interactInitialize,
    });
}

/**
 * Wrapper for project rename to satisfy AI-service command bindings.
 */
export function project_rename_execute(project: Project, newName: string): void {
    project_rename(project, newName);
}

/**
 * Render persistent project strip with chip actions.
 */
export function projectStrip_render(): void {
    const strip: HTMLElement | null = document.getElementById('project-strip');
    if (!strip) {
        console.error('ARGUS: project-strip element not found in DOM');
        return;
    }

    strip.innerHTML = projectStripHtml_render(MOCK_PROJECTS, gatherStage_state.gatherTargetProject?.id ?? null);

    strip.querySelectorAll<HTMLElement>('.project-chip[data-id]').forEach((chip: HTMLElement): void => {
        chip.addEventListener('click', (): void => {
            const projectId: string = chip.dataset.id || '';
            projectChip_toggle(projectId);
        });
    });

    strip.querySelector('.project-chip.new-project')?.addEventListener('click', (): void => {
        projectDraft_create();
    });
}

/**
 * Toggle project chip activation or open detail for active project.
 */
function projectChip_toggle(projectId: string): void {
    const project: Project | undefined = MOCK_PROJECTS.find((entry: Project): boolean => entry.id === projectId);
    if (!project) {
        return;
    }

    if (gatherStage_state.gatherTargetProject?.id === projectId) {
        projectDetail_open(projectId);
        return;
    }

    gatherStage_state.gatherTargetProject = project;
    projectStrip_render();

    if (store.globals.terminal) {
        store.globals.terminal.println(`● GATHER TARGET: [${project.name.toUpperCase()}]`);
        store.globals.terminal.println('○ BROWSE DATASETS AND GATHER DATA FOR THIS PROJECT.');
    }
}

/**
 * Create a draft project and switch shell context to its root.
 */
function projectDraft_create(): void {
    const timestamp: number = Date.now();
    const shortId: string = timestamp.toString().slice(-4);

    const draftProject: Project = {
        id: `draft-${timestamp}`,
        name: `DRAFT-${shortId}`,
        description: 'New project workspace',
        created: new Date(),
        lastModified: new Date(),
        datasets: [],
    };

    MOCK_PROJECTS.push(draftProject);
    gatherStage_state.gatherTargetProject = draftProject;

    const projectBase: string = `/home/user/projects/${draftProject.name}`;
    store.globals.vcs.dir_create(projectBase);

    if (store.globals.shell) {
        store.globals.shell.command_execute(`cd ${projectBase}`);
        store.globals.shell.env_set('PROJECT', draftProject.name);
        if (store.globals.terminal) {
            store.globals.terminal.prompt_sync();
        }
    }

    projectStrip_render();

    if (store.globals.terminal) {
        store.globals.terminal.println(`● NEW PROJECT INITIALIZED: [${draftProject.name}].`);
        store.globals.terminal.println(`○ CONTEXT SWITCHED TO ${projectBase}`);
        store.globals.terminal.println('○ TYPE "upload" TO INGEST LOCAL FILES OR CONTINUE SEARCHING.');
    }
}

// ============================================================================
// Legacy Gather Preview / Cost Logic
// ============================================================================

/**
 * Builds the VFS cohort tree from currently selected datasets.
 */
export function filesystem_build(): void {
    const cohortRoot: VcsFileNode = cohortTree_build(store.state.selectedDatasets);

    fileTree_render(cohortRoot);

    store.globals.vcs.tree_unmount('/home/fedml/data/cohort');
    store.globals.vcs.tree_mount('/home/fedml/data/cohort', cohortRoot);
}

/**
 * Calculates and displays the cost estimate for current selection.
 */
export function costs_calculate(): void {
    const estimate: CostEstimate = costEstimate_calculate(store.state.selectedDatasets);
    store.cost_update(estimate);

    const costData: HTMLElement | null = document.getElementById('cost-data');
    const costCompute: HTMLElement | null = document.getElementById('cost-compute');
    const costStorage: HTMLElement | null = document.getElementById('cost-storage');
    const costTotal: HTMLElement | null = document.getElementById('cost-total');

    if (costData) {
        costData.textContent = `$${store.state.costEstimate.dataAccess.toFixed(2)}`;
    }
    if (costCompute) {
        costCompute.textContent = `$${store.state.costEstimate.compute.toFixed(2)}`;
    }
    if (costStorage) {
        costStorage.textContent = `$${store.state.costEstimate.storage.toFixed(2)}`;
    }
    if (costTotal) {
        costTotal.textContent = `$${store.state.costEstimate.total.toFixed(2)}`;
    }

    stageButton_setEnabled('process', true);
}

/**
 * Updates selection count and gather-stage navigation affordances.
 */
export function selectionCount_update(): void {
    const count: number = store.state.selectedDatasets.length;
    const countEl: HTMLElement | null = document.getElementById('selection-count');
    const btnToGather: HTMLButtonElement | null = document.getElementById('btn-to-gather') as HTMLButtonElement;

    if (countEl) {
        countEl.textContent = `${count} dataset${count !== 1 ? 's' : ''} selected`;
    }

    if (btnToGather) {
        btnToGather.disabled = count === 0;
    }

    stageButton_setEnabled('gather', count > 0);
}

events.on(Events.DATASET_SELECTION_CHANGED, (): void => {
    selectionCount_update();
    if (store.state.currentStage === 'gather') {
        filesystem_build();
        costs_calculate();
    }
});

/**
 * Displays a file preview in the Gather stage preview panel.
 */
export function filePreview_show(path: string, type: string): void {
    const preview: HTMLElement | null = document.getElementById('file-preview');
    if (!preview) {
        return;
    }

    if (type === 'image' && path) {
        preview.innerHTML = `<img src="${path}" alt="Preview">`;
    } else if (type === 'file') {
        preview.innerHTML = '<p class="dim">File preview not available</p>';
    } else {
        preview.innerHTML = '<p class="dim">Select a file to preview</p>';
    }
}

/**
 * Renders a VFS file tree into the Gather stage file-tree container.
 */
function fileTree_render(node: VcsFileNode): void {
    const container: HTMLElement | null = document.getElementById('file-tree');
    if (!container) {
        return;
    }

    function nodeHtml_build(fileNode: VcsFileNode): string {
        const typeClass: string = fileNode.type;
        if (fileNode.children && fileNode.children.length > 0) {
            return `
                <li class="${typeClass}">${fileNode.name}
                    <ul>${fileNode.children.map(nodeHtml_build).join('')}</ul>
                </li>
            `;
        }
        return `<li class="${typeClass}" onclick="filePreview_show('${fileNode.path}', '${fileNode.type}')">${fileNode.name}</li>`;
    }

    container.innerHTML = `<ul>${nodeHtml_build(node)}</ul>`;
}

/**
 * Enables or disables a stage indicator button.
 */
function stageButton_setEnabled(stageName: string, enabled: boolean): void {
    const indicator: HTMLElement | null = document.querySelector(`.stage-indicator[data-stage="${stageName}"]`) as HTMLElement;
    if (indicator) {
        indicator.classList.toggle('disabled', !enabled);
    }
}
