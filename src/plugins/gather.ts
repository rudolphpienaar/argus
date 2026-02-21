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
import { CalypsoPresenter } from '../lcarslm/CalypsoPresenter.js';
import { cohortTree_build } from '../vfs/providers/DatasetProvider.js';
import { simDelay_wait } from './simDelay.js';

interface GatherDeps {
    store: CalypsoStoreActions;
    vfs: PluginContext['vfs'];
    shell: PluginContext['shell'];
    comms: PluginContext['comms'];
    ui: PluginContext['ui'];
    sleep: (ms: number) => Promise<void>;
}

interface GatherMutationResult {
    project: Project;
    dataDir: string;
}

/**
 * Execute the gather logic based on the command verb.
 *
 * @param context - The Argus VM standard library.
 * @returns Standard plugin result.
 */
export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    return context.comms.execute(async (): Promise<PluginResult> => {
        const { command, args, vfs, shell, store, ui, dataDir, comms } = context;
        const sleep = simDelay_wait;
        const deps: GatherDeps = { store, vfs, shell, comms, ui, sleep };

        switch (command) {
            case 'add':
                return plugin_add(args, deps, dataDir);
            case 'remove':
            case 'deselect':
                return plugin_remove(args, store, ui);
            case 'gather':
            case 'review':
                return plugin_review(args, deps, dataDir);
            case 'mount':
                return plugin_mount(ui);
            default:
                return {
                    message: `>> ERROR: UNKNOWN GATHER VERB '${command}'.`,
                    statusCode: CalypsoStatusCode.ERROR
                };
        }
    });
}

/**
 * Add datasets to the selection buffer.
 */
async function plugin_add(
    ids: string[],
    deps: GatherDeps,
    dataDir: string
): Promise<PluginResult> {
    if (ids.length === 0) {
        return {
            message: CalypsoPresenter.error_format('NO DATASET ID PROVIDED.'),
            statusCode: CalypsoStatusCode.ERROR
        };
    }

    const resolution = await deps.comms.datasetTargets_resolve(ids);
    const datasets: Dataset[] = resolution.datasets;

    if (datasets.length === 0) {
        return {
            message: CalypsoPresenter.error_format(`DATASET(S) "${ids.join(', ')}" NOT FOUND OR UNRESOLVED.`),
            statusCode: CalypsoStatusCode.ERROR
        };
    }

    const mutation: GatherMutationResult = await gatherMutations_apply(datasets, deps, dataDir);
    const idsStr: string = datasets.map((dataset: Dataset): string => dataset.id).join(', ');

    const selected: Dataset[] = deps.store.datasets_getSelected();

    return {
        message: CalypsoPresenter.success_format(`DATASET(S) GATHERED: ${idsStr}`) +
                 `\n${CalypsoPresenter.info_format(`MOUNTED TO PROJECT [${mutation.project.name}]`)}` +
                 `\n${CalypsoPresenter.info_format(`PROVENANCE PATH: ${mutation.dataDir}`)}`,
        statusCode: CalypsoStatusCode.OK,
        actions: datasets.map((dataset: Dataset) => ({ type: 'dataset_select', id: dataset.id })),
        artifactData: { cohort: selected.map((d: Dataset): string => d.id) },
        materialized: ['.cohort'],
        physicalDataDir: mutation.dataDir,
    };
}

/**
 * Remove datasets from the selection buffer.
 */
function plugin_remove(
    ids: string[],
    store: CalypsoStoreActions,
    ui: PluginContext['ui']
): PluginResult {
    if (ids.length === 0) {
        return {
            message: CalypsoPresenter.error_format('NO DATASET ID PROVIDED.'),
            statusCode: CalypsoStatusCode.ERROR
        };
    }

    const datasets: Dataset[] = ids
        .map(id => store.dataset_getById(id))
        .filter((ds): ds is Dataset => !!ds);

    if (datasets.length === 0) {
        return {
            message: CalypsoPresenter.error_format(`DATASET(S) "${ids.join(', ')}" NOT FOUND IN BUFFER.`),
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
    ids: string[],
    deps: GatherDeps,
    dataDir: string
): Promise<PluginResult> {
    let physicalDataDir: string = dataDir;
    if (ids.length > 0) {
        const datasets: Dataset[] = ids
            .map(id => deps.store.dataset_getById(id))
            .filter((ds): ds is Dataset => !!ds);
        
        if (datasets.length > 0) {
            const mutation = await gatherMutations_apply(datasets, deps, dataDir);
            physicalDataDir = mutation.dataDir;
        }
    }

    const selected: Dataset[] = deps.store.datasets_getSelected();
    if (selected.length === 0) {
        return {
            message: CalypsoPresenter.error_format('COHORT ASSEMBLY FAILED: NO DATASETS SELECTED.'),
            statusCode: CalypsoStatusCode.BLOCKED_MISSING
        };
    }

    const markerPath: string = `${physicalDataDir}/.cohort`;
    deps.vfs.file_create(
        markerPath,
        `COHORT ASSEMBLED: DETERMINISTIC_SIMULATION\nDATASETS: ${selected.map((d: Dataset): string => d.id).join(',')}\n`,
    );

    return {
        message: CalypsoPresenter.success_format(`COHORT REVIEW: ${selected.length} SELECTED:`) + 
                 `\n${selected.map((d: Dataset): string => `  [${d.id}] ${d.name}`).join('\n')}`,
        statusCode: CalypsoStatusCode.OK,
        actions: [{ type: 'stage_advance', stage: 'gather' }],
        artifactData: { cohort: selected.map((d: Dataset): string => d.id) },
        materialized: ['.cohort'],
        physicalDataDir,
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
async function gatherMutations_apply(datasets: Dataset[], deps: GatherDeps, dataDir: string): Promise<GatherMutationResult> {
    const activeProject = deps.store.project_getActiveFull();
    const project: Project = projectActive_ensure(deps);
    const username: string = deps.shell.env_get('USER') || 'user';
    
    // v10.2: If we are transitioning from a DRAFT or different project,
    // move the physical data tree to preserve provenance.
    if (!activeProject || activeProject.id !== project.id) {
        const newDataPath = `/home/${username}/projects/${project.name}/data`;
        const oldDataPath = sessionRoot_resolve(dataDir);
        try {
            if (oldDataPath !== newDataPath && deps.vfs.node_stat(oldDataPath)) {
                deps.vfs.tree_clone(oldDataPath, newDataPath);
                // Clear the old provenance to prevent stale artifacts from triggering branching
                deps.vfs.node_remove(oldDataPath, true);
            }
        } catch { /* ignore */ }
    }

    // v10.2: Recalculate effective dataDir in case project was renamed
    const effectiveDataDir = dataDir.replace(
        /\/projects\/[^/]+\/data\//,
        `/projects/${project.name}/data/`
    );

    datasets.forEach((dataset: Dataset): void => deps.store.dataset_select(dataset));

    const selected: Dataset[] = deps.store.datasets_getSelected();
    const hydratedProject: Project = projectWithDatasets_sync(project, selected);

    deps.store.project_setActive(hydratedProject);
    await projectWorkspace_materialize(hydratedProject, selected, deps, effectiveDataDir);

    // v10.2: Materialize VFS proof-of-work marker into our physical leaf
    const markerPath: string = `${effectiveDataDir}/.cohort`;
    deps.vfs.file_create(markerPath, `COHORT ASSEMBLED: DETERMINISTIC_SIMULATION\nDATASETS: ${selected.map(d => d.id).join(',')}\n`);

    return {
        project: hydratedProject,
        dataDir: effectiveDataDir,
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
async function projectWorkspace_materialize(project: Project, selected: Dataset[], deps: GatherDeps, dataDir: string): Promise<void> {
    const username: string = deps.shell.env_get('USER') || 'user';
    const projectRootPath: string = `/home/${username}/projects/${project.name}`;

    deps.ui.status(`CALYPSO: ASSEMBLING WORKSPACE [${project.name}]`);
    deps.vfs.dir_create(projectRootPath);
    
    // Simulate mount compute
    await vfs_mountAnimate(deps, selected.length);
    
    // v10.2: Materialize directly into the physical provenance directory (our current leaf)
    deps.vfs.tree_mount(dataDir, cohortTree_build(selected));
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

/**
 * Resolve session root (/home/<user>/projects/<name>/data) from stage dataDir.
 */
function sessionRoot_resolve(dataDir: string): string {
    const marker = '/data/';
    const markerIndex = dataDir.indexOf(marker);
    if (markerIndex >= 0) {
        return dataDir.substring(0, markerIndex + '/data'.length);
    }
    if (dataDir.endsWith('/data')) {
        return dataDir;
    }
    return dataDir;
}
