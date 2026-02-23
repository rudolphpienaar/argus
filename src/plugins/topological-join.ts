/**
 * @file Structural Plugin: Topological Join
 *
 * Multiplexes multiple parent outputs into a single unified output directory.
 * Used at DAG convergence points to satisfy multi-parent dependencies.
 *
 * @module plugins/topological-join
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';

/**
 * Execute the topological join.
 *
 * @param context - The Argus VM standard library.
 * @returns Standard plugin result.
 */
export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    const { vfs, dataDir } = context;

    // v12.0: Physical Contract - dataDir is the 'output' directory.
    // In our context, 'input/' is a sibling to 'output/'.
    const inputDir = dataDir.replace(/\/output$/, '/input');

    try {
        const parents = vfs.dir_list(inputDir);
        const parentIds: string[] = [];

        for (const parent of parents) {
            if (parent.type === 'link') {
                const linkName = parent.name;
                parentIds.push(linkName);

                // Link the parent's output into our output
                // Use relative path for portability: ../input/<parentId>
                const relTarget = `../input/${linkName}`;
                vfs.link_create(`${dataDir}/${linkName}`, relTarget);
            }
        }

        return {
            message: `● TOPOLOGICAL JOIN COMPLETE: ${parentIds.join(', ')}`,
            statusCode: CalypsoStatusCode.OK,
            artifactData: {
                parents: parentIds,
                timestamp: new Date().toISOString()
            }
        };
    } catch (e) {
        return {
            message: `>> ERROR: JOIN FAILED. ${e instanceof Error ? e.message : String(e)}`,
            statusCode: CalypsoStatusCode.ERROR
        };
    }
}
