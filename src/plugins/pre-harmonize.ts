/**
 * @file Structural Plugin: Pre-Harmonize
 *
 * View resolver for the harmonization stage. Picks the authoritative
 * data view from the topological join (preferring collect over gather).
 *
 * @module plugins/pre-harmonize
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';

/**
 * Execute the pre-harmonize resolver.
 */
export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    const { vfs, dataDir } = context;
    const inputDir = dataDir.replace(/\/output$/, '/input');

    try {
        // Find our parent join node
        const parents = vfs.dir_list(inputDir);
        const joinNode = parents.find(p => p.name.includes('join'));

        if (!joinNode) {
            throw new Error('Join node not found in input');
        }

        const joinOutputDir = `${inputDir}/${joinNode.name}`;
        const joinedEntries = vfs.dir_list(joinOutputDir);

        // AUTHORITATIVE SELECTION:
        // Prefer 'collect' output if it exists, otherwise 'gather-gate'
        const collectEntry = joinedEntries.find(e => e.name === 'collect');
        const gateEntry = joinedEntries.find(e => e.name === 'gather-gate');

        const sourceId = collectEntry ? 'collect' : (gateEntry ? 'gather-gate' : null);

        if (!sourceId) {
            throw new Error('No valid data source found in join');
        }

        // The join directory contains links named after the stages.
        // e.g. join/data/output/rename -> /.../rename/data/output
        const sourcePath = `${joinOutputDir}/${sourceId}`;

        // v12.0: UNWRAPPING THE VIEW
        // We want the viewport to feel like 'actual data'.
        // We link everything FROM the source output INTO our output.
        const sourceContents = vfs.dir_list(sourcePath);
        for (const item of sourceContents) {
            // Relative link: ../input/<joinNode>/<sourceId>/<itemName>
            const relTarget = `../input/${joinNode.name}/${sourceId}/${item.name}`;
            vfs.link_create(`${dataDir}/${item.name}`, relTarget);
        }

        return {
            message: `● VIEW RESOLVED: ${sourceId.toUpperCase()}`,
            statusCode: CalypsoStatusCode.OK,
            artifactData: {
                resolvedFrom: sourceId,
                timestamp: new Date().toISOString()
            }
        };

    } catch (e) {
        return {
            message: `>> ERROR: VIEW RESOLUTION FAILED. ${e instanceof Error ? e.message : String(e)}`,
            statusCode: CalypsoStatusCode.ERROR
        };
    }
}
