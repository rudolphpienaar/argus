/**
 * @file Gather Project Activation Actions
 *
 * Project-level actions shared by Gather-stage orchestration.
 *
 * Responsibilities:
 * - Activate a project into store/shell/VFS context.
 * - Transition from Gather to Process when a project is mounted.
 *
 * @module core/stages/gather/actions/projects
 */

import { store } from '../../../state/store.js';
import { stage_advanceTo } from '../../../logic/navigation.js';
import { cohortTree_build } from '../../../../vfs/providers/DatasetProvider.js';
import { populate_ide } from '../../process.js';
import { MOCK_PROJECTS } from '../../../data/projects.js';
import type { Project } from '../../../models/types.js';
import type { FileNode as VcsFileNode } from '../../../../vfs/types.js';

/**
 * Activate a project and transition to Process-stage IDE context.
 */
export function project_activate(projectId: string): void {
    const project: Project | undefined = MOCK_PROJECTS.find((entry: Project): boolean => entry.id === projectId);
    if (!project) {
        return;
    }

    store.project_load(project);

    const projectBase: string = `/home/user/projects/${project.name}`;
    const cohortRoot: VcsFileNode = cohortTree_build(project.datasets);
    store.globals.vcs.tree_unmount(`${projectBase}/data`);
    store.globals.vcs.dir_create(`${projectBase}/src`);
    store.globals.vcs.tree_mount(`${projectBase}/data`, cohortRoot);
    store.globals.vcs.cwd_set(projectBase);

    if (store.globals.shell) {
        store.globals.shell.env_set('PROJECT', project.name);
    }

    if (store.globals.terminal) {
        store.globals.terminal.prompt_sync();
        store.globals.terminal.println(`● MOUNTING PROJECT: [${project.name.toUpperCase()}]`);
        store.globals.terminal.println(`○ LOADED ${project.datasets.length} DATASETS.`);
    }

    stage_advanceTo('process');
    populate_ide();
}
