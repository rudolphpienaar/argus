/**
 * @file Plugin: Gather
 *
 * Implements cohort assembly logic, including adding/removing datasets
 * and project creation.
 *
 * @module plugins/gather
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';
import type { Dataset } from '../core/models/types.js';
import { SearchProvider } from '../lcarslm/SearchProvider.js';
import { CalypsoPresenter } from '../lcarslm/CalypsoPresenter.js';
import { project_gather } from '../core/logic/ProjectManager.js';

/**
 * Execute the gather logic based on the command verb.
 *
 * @param context - The Argus VM standard library.
 * @returns Standard plugin result.
 */
export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    const { command, args, vfs, shell, store } = context;
    const searchProvider: SearchProvider = new SearchProvider(vfs, shell);

    switch (command) {
        case 'add':
            return plugin_add(args[0], searchProvider, store);
        case 'remove':
        case 'deselect':
            return plugin_remove(args[0], searchProvider, store);
        case 'gather':
        case 'review':
            return plugin_review(args[0], searchProvider, store);
        case 'mount':
            return plugin_mount();
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
async function plugin_add(targetId: string, searchProvider: SearchProvider, store: any): Promise<PluginResult> {
    const datasets: Dataset[] = searchProvider.resolve(targetId);
    if (datasets.length === 0) {
        return {
            message: CalypsoPresenter.error_format(`DATASET "${targetId}" NOT FOUND.`),
            statusCode: CalypsoStatusCode.ERROR
        };
    }

    let lastProj: any;
    for (const ds of datasets) {
        store.dataset_select(ds);
        lastProj = project_gather(ds);
    }

    return {
        message: CalypsoPresenter.success_format(`DATASET(S) GATHERED: ${datasets.map((d: Dataset): string => d.id).join(', ')}`) + 
                 `\n${CalypsoPresenter.info_format(`MOUNTED TO PROJECT [${lastProj.name}]`)}` +
                 `\n${CalypsoPresenter.info_format(`VFS ROOT: /home/${lastProj.id.split('-').pop()}/projects/${lastProj.name}/input`)}`,
        statusCode: CalypsoStatusCode.OK,
        actions: datasets.map((d: Dataset) => ({ type: 'dataset_select', id: d.id })),
        artifactData: { added: datasets.map(d => d.id) }
    };
}

/**
 * Remove a dataset from the selection buffer.
 */
function plugin_remove(targetId: string, searchProvider: SearchProvider, store: any): PluginResult {
    const datasets: Dataset[] = searchProvider.resolve(targetId);
    if (datasets.length === 0) {
        return {
            message: CalypsoPresenter.error_format(`DATASET "${targetId}" NOT FOUND IN BUFFER.`),
            statusCode: CalypsoStatusCode.ERROR
        };
    }
    for (const ds of datasets) {
        store.dataset_deselect(ds.id);
    }
    return {
        message: CalypsoPresenter.success_format(`DATASET(S) REMOVED: ${datasets.map((d: Dataset): string => d.id).join(', ')}`),
        statusCode: CalypsoStatusCode.OK,
        actions: datasets.map((d: Dataset) => ({ type: 'dataset_deselect', id: d.id })),
        artifactData: { removed: datasets.map(d => d.id) }
    };
}

/**
 * Review the current cohort.
 */
function plugin_review(targetId: string | undefined, searchProvider: SearchProvider, store: any): PluginResult {
    if (targetId) {
        const datasets: Dataset[] = searchProvider.resolve(targetId);
        for (const ds of datasets) {
            store.dataset_select(ds);
            project_gather(ds);
        }
    }

    const selected: Dataset[] = store.datasets_getSelected();
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
        artifactData: { cohort: selected.map(d => d.id) }
    };
}

/**
 * Finalize mount.
 */
function plugin_mount(): PluginResult {
    return {
        message: CalypsoPresenter.success_format('MOUNT COMPLETE.'),
        statusCode: CalypsoStatusCode.OK,
        actions: [{ type: 'stage_advance', stage: 'process' }]
    };
}
