/**
 * @file Plugin: Gather
 *
 * Implements cohort assembly logic. v12.0: Acts as the "Commit" trigger
 * that materializes the selection buffer from Search stage into provenance.
 *
 * @module plugins/gather
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import type { CalypsoStoreActions } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';
import type { Dataset, Project } from '../core/models/types.js';
import type { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import { CalypsoPresenter } from '../lcarslm/CalypsoPresenter.js';
import { simDelay_wait } from './simDelay.js';
import { cohortTree_build, type DatasetInput } from '../vfs/providers/DatasetProvider.js';

/** Shape of an atomic add-artifact written by the search plugin. */
interface AddArtifact {
    id: string;
}

/**
 * Execute the gather logic based on the command verb.
 *
 * @param context - The Argus VM standard library.
 * @returns Standard plugin result.
 */
export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    return context.comms.execute(async (): Promise<PluginResult> => {
        const { command, ui } = context;

        switch (command) {
            case 'gather':
                return await handle_gather(context);
            case 'mount':
                return mount_finalize(ui);
            default:
                return {
                    message: `>> ERROR: UNKNOWN GATHER VERB '${command}'.`,
                    statusCode: CalypsoStatusCode.ERROR
                };
        }
    });
}

/**
 * Main orchestration for the 'gather' command.
 *
 * @param context - The Argus VM standard library.
 * @returns Plugin result indicating success or failure.
 */
async function handle_gather(context: PluginContext): Promise<PluginResult> {
    const { store, ui, dataDir, vfs, comms } = context;

    // 1. Scan for inputs
    const datasetIds: string[] = gatherInputs_scan(vfs, dataDir);

    // 2. Resolve datasets
    const resolution = await comms.datasetTargets_resolve(datasetIds);
    const selected: Dataset[] = resolution.datasets;

    if (selected.length === 0) {
        return {
            message: CalypsoPresenter.error_format('COHORT ASSEMBLY FAILED: NO ADD-ARTIFACTS FOUND IN SEARCH INPUT.'),
            statusCode: CalypsoStatusCode.BLOCKED_MISSING
        };
    }

    // 3. Ensure project context
    const project: Project = projectContext_ensure(store);

    // 4. Materialize data
    ui.status(`CALYPSO: ASSEMBLING WORKSPACE`);
    await vfs_mountAnimate({ ui, sleep: simDelay_wait }, selected.length);
    datasets_materialize(vfs, selected, dataDir);

    // 5. Finalize artifact
    const markerPath: string = `${dataDir}/.cohort`;
    vfs.file_create(markerPath, `COHORT ASSEMBLED: DETERMINISTIC_SIMULATION\nDATASETS: ${selected.map(d => d.id).join(',')}\n`);

    return {
        message: CalypsoPresenter.success_format(`COHORT REVIEW: ${selected.length} SELECTED:`) +
                 `\n${selected.map((d: Dataset): string => `  [${d.id}] ${d.name}`).join('\n')}`,
        statusCode: CalypsoStatusCode.OK,
        actions: [{ type: 'stage_advance', stage: 'gather' }],
        artifactData: { cohort: selected.map((d: Dataset): string => d.id) },
        materialized: ['.cohort'],
        physicalDataDir: dataDir
    };
}

/**
 * Scan the stage input directory for atomic selection artifacts.
 *
 * @param vfs - Virtual File System instance.
 * @param dataDir - Current stage output directory path.
 * @returns Array of dataset IDs found in the input buffer.
 */
function gatherInputs_scan(vfs: VirtualFileSystem, dataDir: string): string[] {
    const inputDir: string = dataDir.replace(/\/output$/, '/input');
    const searchInputDir: string = `${inputDir}/search`;
    const datasetIds: string[] = [];

    try {
        const files = vfs.dir_list(searchInputDir);
        for (const file of files) {
            if (file.name.startsWith('add-') && file.name.endsWith('.json')) {
                const raw: string | null = vfs.node_read(file.path);
                if (raw) {
                    const data: AddArtifact = JSON.parse(raw) as AddArtifact;
                    if (data.id) datasetIds.push(data.id);
                }
            }
        }
    } catch { /* ignore missing input */ }

    return datasetIds;
}

/**
 * Materialize datasets into the output directory using the Cohort Tree model.
 * Gather preserves dataset directories at the gather root; no synthetic
 * training/validation repacking is applied in this stage.
 *
 * @param vfs - Virtual File System instance.
 * @param datasets - Selected datasets to materialize.
 * @param dataDir - Stage output directory path to materialize into.
 */
function datasets_materialize(vfs: VirtualFileSystem, datasets: Dataset[], dataDir: string): void {
    const cohortTree = cohortTree_build(datasets as DatasetInput[]);
    const rootChildren = cohortTree.children || [];
    const trainingDir = rootChildren.find((node) => node.type === 'folder' && node.name === 'training');

    // Preferred path: mount each cohort dataset directly at gather root.
    const preferredDatasetDirs = (trainingDir?.children || []).filter((node) => node.type === 'folder');
    const fallbackDatasetDirs = rootChildren.filter((node) =>
        node.type === 'folder' && node.name !== 'training' && node.name !== 'validation'
    );
    const datasetDirs = preferredDatasetDirs.length > 0 ? preferredDatasetDirs : fallbackDatasetDirs;

    for (const datasetDir of datasetDirs) {
        vfs.tree_mount(`${dataDir}/${datasetDir.name}`, datasetDir);
    }
}

/**
 * Ensure a valid project record exists in the store.
 *
 * @param store - The Calypso store actions interface.
 * @returns The active project, creating a session-scoped one if none exists.
 */
function projectContext_ensure(store: CalypsoStoreActions): Project {
    const active: Project | null = store.project_getActiveFull();
    if (active) return active;

    const sessionId: string = store.sessionId_get() || 'unknown';
    const project: Project = {
        id: `proj-${sessionId}`,
        name: '',
        description: 'Session-scoped research project',
        created: new Date(),
        lastModified: new Date(),
        datasets: [],
    };
    store.project_setActive(project);
    return project;
}

/**
 * Finalize mount and transition to process.
 *
 * @param ui - Plugin UI interface for status output.
 * @returns Plugin result advancing to the process stage.
 */
function mount_finalize(ui: PluginContext['ui']): PluginResult {
    ui.log('● FINALIZING COHORT MOUNT...');
    return {
        message: CalypsoPresenter.success_format('MOUNT COMPLETE.'),
        statusCode: CalypsoStatusCode.OK,
        actions: [{ type: 'stage_advance', stage: 'process' }]
    };
}

/**
 * Simulate VFS mount latency with progress reporting.
 *
 * @param deps - Dependencies: UI interface and async sleep function.
 * @param datasetCount - Number of datasets being mounted.
 */
async function vfs_mountAnimate(deps: { ui: PluginContext['ui'], sleep: (ms: number) => Promise<void> }, datasetCount: number): Promise<void> {
    const { ui, sleep } = deps;
    ui.log(`○ Mounting ${datasetCount} dataset(s) into project input tree...`);

    for (let i = 1; i <= datasetCount; i++) {
        const percent: number = Math.round((i / datasetCount) * 100);
        ui.progress(`Binding dataset ${i}/${datasetCount}`, percent);
        await sleep(250);
    }
    ui.log('  ● Mount successful.');
}
