/**
 * @file Plugin: Gather
 *
 * Implements cohort assembly logic, including adding/removing datasets
 * and project creation.
 * v10.2: Compute-driven telemetry for VFS mounting.
 *
 * @module plugins/gather
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import type { CalypsoStoreActions } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';
import type { Dataset, Project } from '../core/models/types.js';
import { SearchProvider } from '../lcarslm/SearchProvider.js';
import { CalypsoPresenter } from '../lcarslm/CalypsoPresenter.js';
import { cohortTree_build } from '../vfs/providers/DatasetProvider.js';

interface GatherDeps {
    store: CalypsoStoreActions;
    vfs: PluginContext['vfs'];
    shell: PluginContext['shell'];
    ui: PluginContext['ui'];
    sleep: PluginContext['sleep'];
}

interface GatherMutationResult {
    project: Project;
}

/**
 * Execute the gather logic based on the command verb.
 *
 * @param context - The Argus VM standard library.
 * @returns Standard plugin result.
 */
export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    const { command, args, vfs, shell, store, ui, sleep } = context;
    const searchProvider: SearchProvider = new SearchProvider(vfs, shell);
    const deps: GatherDeps = { store, vfs, shell, ui, sleep };

    switch (command) {
        case 'add':
            return plugin_add(args[0], searchProvider, deps);
        case 'remove':
        case 'deselect':
            return plugin_remove(args[0], searchProvider, store, ui);
        case 'gather':
        case 'review':
            return plugin_review(args[0], searchProvider, deps);
        case 'mount':
            return plugin_mount(ui);
        default:
            return {
                message: `>> ERROR: UNKNOWN GATHER VERB '${command}'.`,
                statusCode: CalypsoStatusCode.ERROR
            };
    }
}

/**
 * Add a dataset to the selection buffer.
 */
async function plugin_add(
    targetId: string | undefined,
    searchProvider: SearchProvider,
    deps: GatherDeps,
): Promise<PluginResult> {
    if (!targetId) {
        return {
            message: CalypsoPresenter.error_format('NO DATASET ID PROVIDED.'),
            statusCode: CalypsoStatusCode.ERROR
        };
    }

    const datasets: Dataset[] = searchProvider.resolve(targetId);
    if (datasets.length === 0) {
        return {
            message: CalypsoPresenter.error_format(`DATASET "${targetId}" NOT FOUND.`),
            statusCode: CalypsoStatusCode.ERROR
        };
    }

    const mutation: GatherMutationResult = await gatherMutations_apply(datasets, deps);
    const username: string = deps.shell.env_get('USER') || 'user';
    const projectInputRoot: string = `/home/${username}/projects/${mutation.project.name}/input`;
    const ids: string = datasets.map((dataset: Dataset): string => dataset.id).join(', ');

    return {
        message: CalypsoPresenter.success_format(`DATASET(S) GATHERED: ${ids}`) +
                 `\n${CalypsoPresenter.info_format(`MOUNTED TO PROJECT [${mutation.project.name}]`)}` +
                 `\n${CalypsoPresenter.info_format(`VFS ROOT: ${projectInputRoot}`)}`,
        statusCode: CalypsoStatusCode.OK,
        actions: datasets.map((dataset: Dataset) => ({ type: 'dataset_select', id: dataset.id })),
        artifactData: { added: datasets.map((dataset: Dataset): string => dataset.id) }
    };
}

/**
 * Remove a dataset from the selection buffer.
 */
function plugin_remove(
    targetId: string | undefined,
    searchProvider: SearchProvider,
    store: CalypsoStoreActions,
    ui: PluginContext['ui']
): PluginResult {
    if (!targetId) {
        return {
            message: CalypsoPresenter.error_format('NO DATASET ID PROVIDED.'),
            statusCode: CalypsoStatusCode.ERROR
        };
    }

    const datasets: Dataset[] = searchProvider.resolve(targetId);
    if (datasets.length === 0) {
        return {
            message: CalypsoPresenter.error_format(`DATASET "${targetId}" NOT FOUND IN BUFFER.`),
            statusCode: CalypsoStatusCode.ERROR
        };
    }
    
    ui.log(`  ○ Removing ${datasets.length} dataset(s) from cohort...`);
    for (const ds of datasets) {
        store.dataset_deselect(ds.id);
    }
    
    return {
        message: CalypsoPresenter.success_format(`DATASET(S) REMOVED: ${datasets.map((d: Dataset): string => d.id).join(', ')}`),
        statusCode: CalypsoStatusCode.OK,
        actions: datasets.map((d: Dataset) => ({ type: 'dataset_deselect', id: d.id })),
        artifactData: { removed: datasets.map((d: Dataset): string => d.id) }
    };
}

/**
 * Review the current cohort.
 */
async function plugin_review(
    targetId: string | undefined,
    searchProvider: SearchProvider,
    deps: GatherDeps,
): Promise<PluginResult> {
    if (targetId) {
        const datasets: Dataset[] = searchProvider.resolve(targetId);
        await gatherMutations_apply(datasets, deps);
    }

    const selected: Dataset[] = deps.store.datasets_getSelected();
    if (selected.length === 0) {
        return {
            message: CalypsoPresenter.info_format('NO DATASETS SELECTED.'),
            statusCode: CalypsoStatusCode.OK
        };
    }

    return {
        message: CalypsoPresenter.success_format(`COHORT REVIEW: ${selected.length} SELECTED:`) + 
                 `\n${selected.map((d: Dataset): string => `  [${d.id}] ${d.name}`).join('\n')}`,
        statusCode: CalypsoStatusCode.OK,
        actions: [{ type: 'stage_advance', stage: 'gather' }],
        artifactData: { cohort: selected.map((d: Dataset): string => d.id) }
    };
}

/**
 * Finalize mount.
 */
function plugin_mount(ui: PluginContext['ui']): PluginResult {
    ui.log('● FINALIZING COHORT MOUNT...');
    return {
        message: CalypsoPresenter.success_format('MOUNT COMPLETE.'),
        statusCode: CalypsoStatusCode.OK,
        actions: [{ type: 'stage_advance', stage: 'process' }]
    };
}

/**
 * Apply gather-side state and VFS mutations for datasets.
 */
async function gatherMutations_apply(datasets: Dataset[], deps: GatherDeps): Promise<GatherMutationResult> {
    const project: Project = projectActive_ensure(deps);
    datasets.forEach((dataset: Dataset): void => deps.store.dataset_select(dataset));

    const selected: Dataset[] = deps.store.datasets_getSelected();
    const hydratedProject: Project = projectWithDatasets_sync(project, selected);

    deps.store.project_setActive(hydratedProject);
    await projectWorkspace_materialize(hydratedProject, selected, deps);

    return {
        project: hydratedProject,
    };
}

/**
 * Ensure an active project exists for gather mutations.
 */
function projectActive_ensure(deps: GatherDeps): Project {
    const active: Project | null = deps.store.project_getActiveFull();
    if (active) {
        return active;
    }

    const draft: Project = projectDraft_create();
    deps.store.project_setActive(draft);
    return draft;
}

/**
 * Create a new draft project model.
 */
function projectDraft_create(): Project {
    const timestamp: number = Date.now();
    const shortId: string = timestamp.toString().slice(-4);

    return {
        id: `draft-${timestamp}`,
        name: `DRAFT-${shortId}`,
        description: 'Auto-generated gather workspace',
        created: new Date(),
        lastModified: new Date(),
        datasets: [],
    };
}

/**
 * Return a project copy with dataset membership synchronized to current selection.
 */
function projectWithDatasets_sync(project: Project, selected: Dataset[]): Project {
    return {
        ...project,
        lastModified: new Date(),
        datasets: [...selected],
    };
}

/**
 * Materialize gather workspace tree and completion marker under project input/.
 */
async function projectWorkspace_materialize(project: Project, selected: Dataset[], deps: GatherDeps): Promise<void> {
    const username: string = deps.shell.env_get('USER') || 'user';
    const projectRootPath: string = `/home/${username}/projects/${project.name}`;
    const inputPath: string = `${projectRootPath}/input`;

    deps.ui.status(`CALYPSO: ASSEMBLING WORKSPACE [${project.name}]`);
    deps.vfs.dir_create(projectRootPath);
    deps.vfs.tree_unmount(inputPath);
    
    // Simulate mount compute
    await vfs_mountAnimate(deps, selected.length);
    
    deps.vfs.tree_mount(inputPath, cohortTree_build(selected));
    shellProjectContext_sync(projectRootPath, project.name, deps);
}

/**
 * Simulated VFS mount latency.
 */
async function vfs_mountAnimate(deps: GatherDeps, datasetCount: number): Promise<void> {
    const { ui, sleep } = deps;
    ui.log(`○ Mounting ${datasetCount} dataset(s) into project input tree...`);
    
    for (let i = 1; i <= datasetCount; i++) {
        const percent = Math.round((i / datasetCount) * 100);
        ui.progress(`Binding dataset ${i}/${datasetCount}`, percent);
        await sleep(250);
    }
    ui.log('  ● Mount successful.');
}

/**
 * Keep shell environment aligned with active gather project.
 */
function shellProjectContext_sync(projectRootPath: string, projectName: string, deps: GatherDeps): void {
    deps.shell.vfs.cwd_set(projectRootPath);
    deps.shell.env_set('PROJECT', projectName);
}
