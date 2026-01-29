/**
 * @file Catalog Template Generators
 *
 * Generates serialized catalog files (datasets.json, models.json)
 * from the application's core data arrays.
 *
 * @module
 */

import type { ContentContext, ContentGenerator } from '../../types.js';
import type { Dataset } from '../../../core/models/types.js';
import { DATASETS } from '../../../core/data/datasets.js';

/**
 * Generates the /data/catalog/datasets.json content.
 * Serializes the full DATASETS array from core data.
 *
 * @param _context - The content generation context (unused).
 * @returns Pretty-printed JSON string of all available datasets.
 */
function datasetsContent_generate(_context: ContentContext): string {
    const catalog: Array<Record<string, string | number>> = DATASETS.map(
        (ds: Dataset): Record<string, string | number> => ({
            id: ds.id,
            name: ds.name,
            description: ds.description,
            modality: ds.modality,
            annotationType: ds.annotationType,
            imageCount: ds.imageCount,
            size: ds.size,
            cost: ds.cost,
            provider: ds.provider
        })
    );
    return JSON.stringify(catalog, null, 2) + '\n';
}

/**
 * Generates the /data/catalog/models.json content.
 * Lists available model architectures by modality.
 *
 * @param _context - The content generation context (unused).
 * @returns Pretty-printed JSON string of model definitions.
 */
function modelsContent_generate(_context: ContentContext): string {
    const models: Array<Record<string, string>> = [
        { id: 'resnet50', name: 'ResNet50', modality: 'xray', framework: 'pytorch' },
        { id: 'densenet121', name: 'DenseNet121', modality: 'ct', framework: 'pytorch' },
        { id: 'unet3d', name: 'UNet3D', modality: 'mri', framework: 'pytorch' },
        { id: 'efficientnetb4', name: 'EfficientNetB4', modality: 'pathology', framework: 'pytorch' }
    ];
    return JSON.stringify(models, null, 2) + '\n';
}

/**
 * ContentGenerator for /data/catalog/datasets.json.
 */
export const catalogDatasetsGenerator: ContentGenerator = {
    pattern: 'catalog-datasets',
    generate: datasetsContent_generate
};

/**
 * ContentGenerator for /data/catalog/models.json.
 */
export const catalogModelsGenerator: ContentGenerator = {
    pattern: 'catalog-models',
    generate: modelsContent_generate
};
