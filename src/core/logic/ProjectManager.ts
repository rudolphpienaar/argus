/**
 * @file Project Manager
 *
 * Centralizes logic for project creation, initialization, and data gathering.
 * Bridges the gap between the UI (Search Stage) and the Headless Core (Calypso).
 *
 * @module
 */

import { store, globals } from '../state/store.js';
import { MOCK_PROJECTS } from '../data/projects.js';
import { projectContext_get } from './ProjectContext.js';
import type { Project, Dataset } from '../models/types.js';
import type { FileNode as VcsFileNode } from '../../vfs/types.js';
import { cohortTree_build } from '../../vfs/providers/DatasetProvider.js';

/**
 * Creates a new Draft Project and adds it to the mock repository.
 *
 * @returns The newly created project.
 */
export function project_createDraft(): Project {
    const timestamp = Date.now();
    const shortId = timestamp.toString().slice(-4);
    const draftProject: Project = {
        id: `draft-${timestamp}`,
        name: `DRAFT-${shortId}`,
        description: 'New project workspace',
        created: new Date(),
        lastModified: new Date(),
        datasets: []
    };
    
    MOCK_PROJECTS.push(draftProject);
    return draftProject;
}

/**
 * Initializes the VFS structure for a project ("Filesystem First" workflow).
 * Creates the root directory but does not scaffold src/input/output yet.
 *
 * @param project - The project to initialize.
 */
export function project_initialize(project: Project): void {
    const paths = projectContext_get(project);
    try {
        if (!globals.vcs.node_stat(paths.root)) {
            globals.vcs.dir_create(paths.root);
        }
    } catch (e) {
        console.error('Failed to initialize project VFS:', e);
    }
}

/**
 * Gathers a dataset into a project.
 * 
 * Logic:
 * 1. Checks for a target project (or active store project).
 * 2. If none, auto-creates a DRAFT project and activates it.
 * 3. Adds dataset to project model.
 * 4. Updates global store selection.
 * 5. Mounts the dataset (or subtree) into the VFS.
 *
 * @param dataset - The dataset to gather.
 * @param subtree - Optional pruned VFS tree (if partial selection). Defaults to full dataset.
 * @param targetProject - Optional specific project to target. Defaults to store.activeProject.
 * @returns The project that received the data.
 */
export function project_gather(
    dataset: Dataset, 
    subtree?: VcsFileNode, 
    targetProject?: Project | null
): Project {
    let project = targetProject || store.state.activeProject;
    let isNewDraft = false;

    // 1. Auto-create if no project context
    if (!project) {
        project = project_createDraft();
        project_initialize(project);
        isNewDraft = true;
        
        // Notify via Terminal if available
        if (globals.terminal) {
             globals.terminal.println('<span class="muthur-text">NO ACTIVE PROJECT DETECTED.</span>');
             globals.terminal.println(`<span class="muthur-text">INITIATING NEW DRAFT WORKSPACE [${project.name}].</span>`);
             globals.terminal.println('<span class="muthur-text">COHORT MOUNTED.</span>');
        }
        
        // Load into store as active (persistence for session)
        store.project_load(project);
        
        // Sync Shell Context
        if (globals.shell) {
            const paths = projectContext_get(project);
            try {
                globals.shell.command_execute(`cd ${paths.root}`);
                globals.shell.env_set('PROJECT', project.name);
                if (globals.terminal) globals.terminal.prompt_sync();
            } catch (e) {
                console.error('Shell sync failed:', e);
            }
        }
    }

    // 2. Add to project model
    const alreadyLinked = project.datasets.some(ds => ds.id === dataset.id);
    if (!alreadyLinked) {
        project.datasets.push(dataset);
    }

    // 3. Update Store Selection
    // This emits DATASET_SELECTION_CHANGED which listeners (like Gather UI) might react to
    store.dataset_select(dataset);

    // 4. Mount to VFS
    const paths = projectContext_get(project);
    
    // Ensure parent dir exists
    try { 
        if (!globals.vcs.node_stat(paths.root)) {
            globals.vcs.dir_create(paths.root); 
        }
    } catch { /* ignore */ }

    if (subtree) {
        // Partial gather: Mount specific subtree at separate path to avoid overwriting unified tree
        // This results in input/Dataset_Name/training/Dataset_Name/... which is redundant but safe for partials
        const dsDir = dataset.name.replace(/\s+/g, '_');
        try {
            // Ensure input dir exists
            if (!globals.vcs.node_stat(paths.input)) {
                globals.vcs.dir_create(paths.input);
            }
            globals.vcs.tree_unmount(`${paths.input}/${dsDir}`);
            globals.vcs.tree_mount(`${paths.input}/${dsDir}`, subtree);
        } catch (e) {
            console.error('VFS Partial Mount failed:', e);
        }
    } else {
        // Full gather: Rebuild unified cohort tree for ALL project datasets
        // This creates standard structure: input/training/DS1, input/training/DS2
        const unifiedTree = cohortTree_build(project.datasets);
        try {
            // Mount at input/ (replacing 'data' root name with 'input')
            globals.vcs.tree_unmount(paths.input);
            globals.vcs.tree_mount(paths.input, unifiedTree);
        } catch (e) {
            console.error('VFS Unified Mount failed:', e);
        }
    }

    return project;
}

/**
 * Renames a project by moving its VFS directory and updating the model.
 * Syncs the shell context if the active project is renamed.
 * 
 * @param project - The project to rename.
 * @param newName - The new name (sanitized).
 */
export function project_rename(project: Project, newName: string): void {
    const oldName = project.name;
    const username = globals.shell?.env_get('USER') || 'user';
    const oldPath = `/home/${username}/projects/${oldName}`;
    const newPath = `/home/${username}/projects/${newName}`;

    try {
        // 1. Move VFS directory
        if (globals.vcs.node_stat(oldPath)) {
            globals.vcs.node_move(oldPath, newPath);
        } else {
            globals.vcs.dir_create(newPath);
            try { globals.vcs.dir_create(`${newPath}/src`); } catch {}
            try { globals.vcs.dir_create(`${newPath}/input`); } catch {}
            try { globals.vcs.dir_create(`${newPath}/output`); } catch {}
        }

        // 2. Update Project Model
        project.name = newName;

        // 3. Update Shell Context if active
        const shellProject = globals.shell?.env_get('PROJECT');
        if (shellProject === oldName) {
            globals.shell?.env_set('PROJECT', newName);
            const currentCwd = globals.vcs.cwd_get();
            if (currentCwd.startsWith(oldPath)) {
                const newCwd = currentCwd.replace(oldPath, newPath);
                globals.shell?.command_execute(`cd ${newCwd}`);
            }
        }

        if (globals.terminal) {
            globals.terminal.println(`● PROJECT RENAMED: [${oldName}] -> [${newName}]`);
            globals.terminal.println(`○ VFS PATH MOVED TO ${newPath}`);
            if (globals.shell) {
                // Force prompt update in case CWD changed
                // (Though command_execute(cd) handles it, prompt_sync forces redraw)
                // In headless, prompt is rendered by CLIAdapter automatically.
            }
        }

    } catch (e: unknown) {
        console.error('Rename failed', e);
        if (globals.terminal) {
            globals.terminal.println(`<span class="error">>> ERROR: RENAME FAILED. ${e instanceof Error ? e.message : String(e)}</span>`);
        }
    }
}
