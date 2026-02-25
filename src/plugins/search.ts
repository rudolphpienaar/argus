/**
 * @file Plugin: Search
 *
 * Implements dataset discovery logic for the ATLAS catalog.
 * v12.0: Supports incremental buffering and atomic add-artifacts.
 *
 * @module plugins/search
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';
import type { Dataset } from '../core/models/types.js';
import type { SearchMaterialization } from '../lcarslm/SearchProvider.js';
import { CalypsoPresenter } from '../lcarslm/CalypsoPresenter.js';
import { simDelay_wait } from './simDelay.js';

/**
 * Execute the search logic based on the command verb.
 *
 * @param context - The Argus VM standard library.
 * @returns Standard plugin result.
 */
export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    return context.comms.execute(async (): Promise<PluginResult> => {
        const { command, args } = context;

        switch (command) {
            case 'search':
                return await query_handle(context);
            case 'add':
                return await add_handle(args, context);
            case 'remove':
            case 'deselect':
                return remove_handle(args, context);
            case 'show':
                if (args[0] === 'cohort') return cohort_show(context);
                return { message: `○ UNKNOWN SHOW TARGET: ${args[0]}`, statusCode: CalypsoStatusCode.ERROR };
            default:
                return {
                    message: `>> ERROR: UNKNOWN SEARCH VERB '${command}'.`,
                    statusCode: CalypsoStatusCode.ERROR
                };
        }
    });
}

/**
 * Handle 'search <keywords>' - Query catalog and update ledger.
 */
async function query_handle(context: PluginContext): Promise<PluginResult> {
    const { parameters, args, ui, search: searchProvider, dataDir, comms, vfs } = context;
    const query: string = (parameters.query as string) || args.join(' ');
    
    if (!query) {
        return { message: '>> ERROR: NO SEARCH QUERY PROVIDED.', statusCode: CalypsoStatusCode.ERROR };
    }

    ui.status('CALYPSO: SEARCHING ATLAS CATALOG...');
    ui.log(CalypsoPresenter.info_format(`QUERY: "${query}"`));

    await catalog_scan(ui);

    const resolved = await comms.datasetSearch_resolve(query);
    const results: Dataset[] = resolved.results;
    
    // v12.0: Materialize search snapshot in output/ for DAG linking
    const outputDir = `${dataDir}/output`;
    try { vfs.dir_create(outputDir); } catch { /* ignore */ }
    const snap: SearchMaterialization = searchProvider.snapshot_materialize(query, results, outputDir);

    const displayPath: string | null = searchProvider.displayPath_resolve(snap.path);
    const snapLine: string = displayPath ? `\n${CalypsoPresenter.info_format(`SEARCH SNAPSHOT: ${displayPath}`)}` : '';
    const semanticLine: string = resolved.mode === 'semantic'
        ? `\n${CalypsoPresenter.info_format('LEXICAL SEARCH: NO DIRECT MATCH. CALYPSO SEMANTIC RESOLUTION APPLIED.')}`
        : '';

    return {
        message: CalypsoPresenter.success_format(`FOUND ${results.length} MATCHING DATASET(S):`) +
                `\n${CalypsoPresenter.searchListing_format(results)}\n\n` +
                `${CalypsoPresenter.searchDetails_format(results)}${semanticLine}${snapLine}`,
        statusCode: CalypsoStatusCode.OK,
        actions: [{ type: 'workspace_render', datasets: results }],
        artifactData: snap.content,
        physicalDataDir: outputDir
    };
}

/**
 * Handle 'add <datasetId>' - Materialize atomic selection files.
 */
async function add_handle(ids: string[], context: PluginContext): Promise<PluginResult> {
    const { store, comms, vfs, dataDir } = context;
    if (ids.length === 0) return { message: '○ NO DATASET ID PROVIDED.', statusCode: CalypsoStatusCode.ERROR };

    const resolution = await comms.datasetTargets_resolve(ids);
    const datasets: Dataset[] = resolution.datasets;

    if (datasets.length === 0) {
        return { message: `○ DATASET(S) "${ids.join(', ')}" NOT FOUND.`, statusCode: CalypsoStatusCode.ERROR };
    }

    const outputDir = `${dataDir}/output`;
    try { vfs.dir_create(outputDir); } catch { /* ignore */ }

    const addedIds: string[] = [];
    for (const ds of datasets) {
        store.dataset_select(ds);
        
        // Materialize atomic add-file in output directory
        const fileName: string = `add-${ds.id}.json`;
        const content = {
            id: ds.id,
            name: ds.name,
            provider: ds.provider,
            addedAt: new Date().toISOString()
        };
        vfs.file_create(`${outputDir}/${fileName}`, JSON.stringify(content, null, 2));
        addedIds.push(ds.id);
    }

    return {
        message: CalypsoPresenter.success_format(`DATASET(S) ADDED TO BUFFER: ${addedIds.join(', ')}`) +
                 `\n○ Materialized as atomic artifacts in search output.`,
        statusCode: CalypsoStatusCode.OK,
        actions: datasets.map(d => ({ type: 'dataset_select', id: d.id })),
        artifactData: { added: addedIds },
        physicalDataDir: outputDir
    };
}

/**
 * Handle 'remove <datasetId>' - Physically delete selection artifacts.
 */
function remove_handle(ids: string[], context: PluginContext): PluginResult {
    const { store, vfs, dataDir } = context;
    if (ids.length === 0) return { message: '○ NO DATASET ID PROVIDED.', statusCode: CalypsoStatusCode.ERROR };

    const outputDir = `${dataDir}/output`;
    const removedIds: string[] = [];
    for (const id of ids) {
        store.dataset_deselect(id);
        
        const fileName: string = `add-${id}.json`;
        try {
            vfs.node_remove(`${outputDir}/${fileName}`);
            removedIds.push(id);
        } catch { /* ignore missing */ }
    }

    return {
        message: `● DATASET(S) REMOVED FROM BUFFER: ${removedIds.join(', ')}`,
        statusCode: CalypsoStatusCode.OK,
        actions: ids.map(id => ({ type: 'dataset_deselect', id }))
    };
}

/**
 * Handle 'show cohort' - Display active buffer.
 */
function cohort_show(context: PluginContext): PluginResult {
    const selected: Dataset[] = context.store.datasets_getSelected();
    if (selected.length === 0) return { message: '○ SELECTION BUFFER IS EMPTY.', statusCode: CalypsoStatusCode.OK };

    const list: string = selected.map(d => `  [${d.id}] ${d.name} (${d.provider})`).join('\n');
    return {
        message: `● CURRENT COHORT BUFFER:\n${list}`,
        statusCode: CalypsoStatusCode.OK
    };
}

/**
 * Simulated catalog index scan.
 */
async function catalog_scan(ui: PluginContext['ui']): Promise<void> {
    const shards: number = 8;
    for (let i = 1; i <= shards; i++) {
        const percent: number = Math.round((i / shards) * 100);
        ui.progress(`Scanning catalog shard ${i}/${shards}`, percent);
        await simDelay_wait(150);
    }
    ui.log('  ● Catalog scan complete. Resolving rank heuristics...');
    await simDelay_wait(300);
}
