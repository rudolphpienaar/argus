/**
 * @file Plugin: Search
 *
 * Implements dataset discovery logic for the ATLAS catalog.
 * v10.2: Compute-driven telemetry for catalog scanning.
 *
 * @module plugins/search
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';
import type { Dataset } from '../core/models/types.js';
import { SearchProvider, type SearchMaterialization } from '../lcarslm/SearchProvider.js';
import { CalypsoPresenter } from '../lcarslm/CalypsoPresenter.js';

/**
 * Execute the search logic.
 *
 * @param context - The Argus VM standard library.
 * @returns Standard plugin result.
 */
export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    const { parameters, vfs, shell, command, args, ui } = context;
    
    // 1. Resolve query
    const query: string = (parameters.query as string) || args.join(' ');
    if (!query) {
        return {
            message: '>> ERROR: NO SEARCH QUERY PROVIDED.',
            statusCode: CalypsoStatusCode.ERROR
        };
    }

    // 2. Perform Simulated Compute (The Experience)
    ui.status('CALYPSO: SEARCHING ATLAS CATALOG...');
    ui.log(CalypsoPresenter.info_format(`QUERY: "${query}"`));
    
    await catalog_scan(context);

    // 3. Resolve results (The Logic)
    const searchProvider: SearchProvider = new SearchProvider(vfs, shell);
    const results: Dataset[] = searchProvider.search(query);
    const snap: SearchMaterialization = searchProvider.snapshot_materialize(query, results);

    // 4. Format response
    if (results.length === 0) {
        return {
            message: CalypsoPresenter.info_format(`NO MATCHING DATASETS FOUND FOR "${query}".`),
            statusCode: CalypsoStatusCode.OK,
            artifactData: snap.content
        };
    }

    const displayPath: string | null = searchProvider.displayPath_resolve(snap.path);
    const snapLine: string = displayPath ? `\n${CalypsoPresenter.info_format(`SEARCH SNAPSHOT: ${displayPath}`)}` : '';

    return {
        message: CalypsoPresenter.success_format(`FOUND ${results.length} MATCHING DATASET(S):`) + 
                 `\n${CalypsoPresenter.searchListing_format(results)}\n\n` +
                 `${CalypsoPresenter.searchDetails_format(results)}${snapLine}`,
        statusCode: CalypsoStatusCode.OK,
        actions: [{ type: 'workspace_render', datasets: results }],
        artifactData: snap.content
    };
}

/**
 * Simulated catalog index scan.
 */
async function catalog_scan(context: PluginContext): Promise<void> {
    const { ui, sleep } = context;
    const shards = 8;
    
    for (let i = 1; i <= shards; i++) {
        const percent = Math.round((i / shards) * 100);
        ui.progress(`Scanning catalog shard ${i}/${shards}`, percent);
        // Simulated latency
        await sleep(150);
    }
    
    ui.log('  ● Catalog scan complete. Resolving rank heuristics...');
    await sleep(300);
}
