/**
 * @file Asset Manifest Template Generators
 *
 * Generates content for marketplace-installed asset files.
 * Each asset type gets a different manifest/readme format.
 *
 * @module
 */

import type { ContentContext, ContentGenerator } from '../../types.js';
import type { Dataset } from '../../../core/models/types.js';

/**
 * Generates a generic asset manifest from file metadata.
 *
 * @param context - The content generation context.
 * @param assetType - The type label for the manifest.
 * @returns Pretty-printed JSON manifest string.
 */
function assetManifest_generate(context: ContentContext, assetType: string): string {
    const manifest: Record<string, string> = {
        type: assetType,
        path: context.filePath,
        installed: new Date().toISOString(),
        persona: context.persona
    };
    return JSON.stringify(manifest, null, 2) + '\n';
}

/**
 * ContentGenerator for plugin executables.
 */
export const pluginExecutableGenerator: ContentGenerator = {
    pattern: 'plugin-executable',
    generate: (context: ContentContext): string => {
        return `#!/usr/bin/env atlas-plugin
# Plugin installed from ATLAS Marketplace
# Path: ${context.filePath}
# Persona: ${context.persona}

echo "Plugin ready. Run with --help for usage."
`;
    }
};

/**
 * ContentGenerator for dataset manifests.
 */
export const datasetManifestGenerator: ContentGenerator = {
    pattern: 'dataset-manifest',
    generate: (context: ContentContext): string =>
        assetManifest_generate(context, 'dataset')
};

/**
 * ContentGenerator for model README files.
 */
export const modelReadmeGenerator: ContentGenerator = {
    pattern: 'model-readme',
    generate: (context: ContentContext): string => {
        return `# Model Card

**Path:** ${context.filePath}
**Installed by:** ${context.persona}

## Architecture

Pre-trained model from ATLAS Marketplace.

## Usage

\`\`\`python
from atlas.models import load_model
model = load_model("${context.filePath}")
\`\`\`
`;
    }
};

/**
 * ContentGenerator for annotation tool manifests.
 */
export const annotationManifestGenerator: ContentGenerator = {
    pattern: 'annotation-manifest',
    generate: (context: ContentContext): string =>
        assetManifest_generate(context, 'annotation-tool')
};

/**
 * ContentGenerator for workflow manifests.
 */
export const workflowManifestGenerator: ContentGenerator = {
    pattern: 'workflow-manifest',
    generate: (context: ContentContext): string => {
        return `# Workflow Definition
# Installed from ATLAS Marketplace
# Persona: ${context.persona}

name: "installed-workflow"
version: "1.0.0"
steps:
  - name: "preprocess"
    action: "transform"
  - name: "train"
    action: "federate"
  - name: "evaluate"
    action: "metrics"
`;
    }
};

/**
 * ContentGenerator for cohort-level manifest.json.
 */
export const cohortManifestGenerator: ContentGenerator = {
    pattern: 'cohort-manifest',
    generate: (context: ContentContext): string => {
        const datasetIds: string[] = context.selectedDatasets.map(
            (ds: Dataset): string => ds.id
        );
        const totalCost: number = context.selectedDatasets.reduce(
            (sum: number, ds: Dataset): number => sum + ds.cost, 0
        );
        const manifest: Record<string, unknown> = {
            type: 'cohort',
            datasets: datasetIds,
            totalCost,
            persona: context.persona,
            generated: new Date().toISOString()
        };
        return JSON.stringify(manifest, null, 2) + '\n';
    }
};
