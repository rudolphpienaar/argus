/**
 * @file Context Builder for ARGUS Search.
 *
 * Converts the structured dataset catalog into a text-heavy representation
 * optimized for consumption by Large Language Models (LLMs).
 *
 * @module
 */

import type { Dataset } from '../core/models/types.js';

/**
 * Vectorizes (textualizes) the dataset catalog for the AI context window.
 *
 * @param datasets - The list of available datasets.
 * @returns A single formatted string describing all datasets.
 */
export function catalog_vectorize(datasets: Dataset[]): string {
    return datasets.map((ds: Dataset): string => {
        return `
ID: ${ds.id}
Name: ${ds.name}
Type: ${ds.modality} (${ds.annotationType})
Provider: ${ds.provider}
Stats: ${ds.imageCount} images, ${ds.size}, $${ds.cost}
Description: ${ds.description}
--------------------------------------------------`;
    }).join('\n');
}
