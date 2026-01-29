/**
 * @file .meridian/manifest.json Template Generator
 *
 * Generates the MERIDIAN federation manifest with node assignments,
 * dataset mappings, and deployment configuration.
 *
 * @module
 */

import type { ContentContext, ContentGenerator } from '../../types.js';
import type { Dataset } from '../../../core/models/types.js';

/**
 * Generates the .meridian/manifest.json content.
 * Produces a JSON manifest describing the federation topology,
 * dataset-to-node assignments, and security configuration.
 *
 * @param context - The content generation context.
 * @returns Pretty-printed JSON manifest string.
 */
function content_generate(context: ContentContext): string {
    const datasets: Dataset[] = context.selectedDatasets;
    const nodeAssignments: Array<{ nodeId: string; institution: string; datasetId: string }> = datasets.map(
        (ds: Dataset, i: number): { nodeId: string; institution: string; datasetId: string } => ({
            nodeId: `node-${String(i + 1).padStart(3, '0')}`,
            institution: ds.provider || `institution-${i + 1}`,
            datasetId: ds.id
        })
    );

    const manifest: Record<string, unknown> = {
        version: '1.0.0',
        project: context.activeProject?.name || 'untitled',
        persona: context.persona,
        federation: {
            strategy: 'FedAvg',
            rounds: 50,
            minNodes: Math.max(2, datasets.length),
            hub: 'MOC-HUB'
        },
        nodes: nodeAssignments,
        security: {
            differentialPrivacy: {
                enabled: true,
                epsilon: 3.0,
                delta: 1e-5
            },
            securAggregation: true,
            attestation: 'TPM-2.0'
        },
        generated: new Date().toISOString()
    };

    return JSON.stringify(manifest, null, 2) + '\n';
}

/**
 * ContentGenerator for .meridian/manifest.json files.
 */
export const manifestGenerator: ContentGenerator = {
    pattern: 'manifest',
    generate: content_generate
};
