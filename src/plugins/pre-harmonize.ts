/**
 * @file Auto-Execute Plugin: Pre-Harmonize
 *
 * View resolver for the harmonization stage. Picks the authoritative
 * data view from the topological join by dynamic inspection — prefers
 * any entry whose artifact is not a skip sentinel, falls back to the
 * first entry (primary parent by first-in-previous rule).
 *
 * No sibling stage names are hardcoded here.
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

        // DYNAMIC AUTHORITATIVE SELECTION:
        // Prefer any entry whose artifact is not a skip sentinel.
        // A skip sentinel has { skipped: true } in its meta artifact.
        // Falls back to the first entry (primary parent by first-in-previous rule).
        let sourceId: string | null = null;
        for (const entry of joinedEntries) {
            // Look for a meta artifact in this entry's directory.
            try {
                const entryMeta = vfs.dir_list(`${joinOutputDir}/${entry.name}/meta`);
                const artifactFile = entryMeta.find(f => f.name.endsWith('.json'));
                if (artifactFile) {
                    const raw = vfs.node_read(`${joinOutputDir}/${entry.name}/meta/${artifactFile.name}`);
                    const parsed = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
                    if (!parsed['skipped']) {
                        sourceId = entry.name;
                        break;
                    }
                }
            } catch {
                // Entry has no readable meta — treat as non-skipped (present but unstructured)
                sourceId = entry.name;
                break;
            }
        }

        // Fallback: first entry is the primary parent by first-in-previous rule
        if (!sourceId && joinedEntries.length > 0) {
            sourceId = joinedEntries[0].name;
        }

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
