/**
 * @file Plugin: Search
 *
 * Implements dataset discovery logic for the ATLAS catalog.
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
    const { parameters, vfs, shell, command, args } = context;
    
    // 1. Instantiate specialized provider
    const searchProvider: SearchProvider = new SearchProvider(vfs, shell);

    // 2. Extract query from parameters or args
    const query: string = (parameters.query as string) || args.join(' ');
    if (!query) {
        return {
            message: '>> ERROR: NO SEARCH QUERY PROVIDED.',
            statusCode: CalypsoStatusCode.ERROR
        };
    }

    // 3. Perform search
    const results: Dataset[] = searchProvider.search(query);

    // 4. Generate materialization content (for Merkle artifact)
    const snap: SearchMaterialization = searchProvider.snapshot_materialize(query, results);

    // 5. Format response
    if (results.length === 0) {
        return {
            message: CalypsoPresenter.info_format(`NO MATCHING DATASETS FOUND FOR "${query}".`),
            statusCode: CalypsoStatusCode.OK, // Search itself succeeded even if 0 results
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
