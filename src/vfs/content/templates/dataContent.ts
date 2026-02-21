/**
 * @file Data Content Template Generators
 *
 * Generates synthetic content for dataset files in the cohort tree:
 * medical images (placeholder), masks, metadata, annotations, and labels.
 *
 * @module
 */

import type { ContentContext, ContentGenerator } from '../../types.js';

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Extracts the dataset directory name from a file path.
 * E.g. `/data/training/Pneumonia_CXR/images/RSNA_001.jpg` → `Pneumonia_CXR`
 */
function datasetName_extract(filePath: string): string {
    const parts: string[] = filePath.split('/');
    const trainingIdx: number = parts.indexOf('training');
    if (trainingIdx >= 0 && parts.length > trainingIdx + 1) {
        return parts[trainingIdx + 1];
    }
    const validationIdx: number = parts.indexOf('validation');
    if (validationIdx >= 0 && parts.length > validationIdx + 1) {
        return parts[validationIdx + 1];
    }
    return 'unknown';
}

/**
 * Extracts the filename from a path.
 */
function fileName_extract(filePath: string): string {
    return filePath.split('/').pop() || 'unknown';
}

// ─── Image Placeholder ──────────────────────────────────────

function imageContent_generate(context: ContentContext): string {
    const name: string = fileName_extract(context.filePath);
    const dataset: string = datasetName_extract(context.filePath);
    const ext: string = name.split('.').pop()?.toUpperCase() || 'JPG';

    return `[BINARY ${ext} IMAGE DATA]
──────────────────────────────────────
  File:     ${name}
  Dataset:  ${dataset}
  Format:   ${ext} (DICOM-derived)
  Encoding: 8-bit grayscale / RGB
  Dims:     512 × 512 px (typical)
──────────────────────────────────────

  This is a synthetic medical imaging file.
  In a production environment this would contain
  pixel data from the federated data source.

  ┌─────────────────────────┐
  │  ░░░▒▒▒▓▓▓█████▓▓▓▒▒░  │
  │  ░░▒▒▓▓████████████▓▒  │
  │  ░▒▓████   DICOM  ███▓ │
  │  ░▒███  ${ext.padEnd(5)} IMAGE ██▓ │
  │  ░▒▓████         ███▓  │
  │  ░░▒▒▓▓████████████▓▒  │
  │  ░░░▒▒▒▓▓▓█████▓▓▓▒▒░  │
  └─────────────────────────┘
`;
}

export const dataImageGenerator: ContentGenerator = {
    pattern: 'data-image',
    generate: imageContent_generate
};

// ─── Mask Placeholder ───────────────────────────────────────

function maskContent_generate(context: ContentContext): string {
    const name: string = fileName_extract(context.filePath);
    const dataset: string = datasetName_extract(context.filePath);

    return `[BINARY PNG MASK DATA]
──────────────────────────────────────
  File:     ${name}
  Dataset:  ${dataset}
  Format:   PNG (segmentation mask)
  Encoding: 1-bit / indexed color
  Dims:     512 × 512 px (matches source)
──────────────────────────────────────

  Segmentation mask for paired image.
  Pixel values encode anatomical regions:
    0 = background
    1 = region of interest (ROI)
    2 = secondary structure

  ┌─────────────────────────┐
  │  ░░░░░░░░░░░░░░░░░░░░  │
  │  ░░░░░░███████░░░░░░░  │
  │  ░░░░████ ROI ████░░░  │
  │  ░░░████ MASK  ████░░  │
  │  ░░░░████     ████░░░  │
  │  ░░░░░░███████░░░░░░░  │
  │  ░░░░░░░░░░░░░░░░░░░░  │
  └─────────────────────────┘
`;
}

export const dataMaskGenerator: ContentGenerator = {
    pattern: 'data-mask',
    generate: maskContent_generate
};

// ─── Metadata JSON ──────────────────────────────────────────

function metadataContent_generate(context: ContentContext): string {
    const dataset: string = datasetName_extract(context.filePath);
    const meta: Record<string, unknown> = {
        dataset: dataset,
        version: '1.0.0',
        created: new Date().toISOString().split('T')[0],
        source: 'ATLAS Federated Data Network',
        license: 'Research Use Only',
        modality: 'unknown',
        annotation_type: 'unknown',
        image_format: 'DICOM-derived',
        dimensions: { width: 512, height: 512, channels: 1 },
        preprocessing: {
            normalized: true,
            resized: true,
            augmented: false
        },
        privacy: {
            differential_privacy: true,
            epsilon: 3.0,
            anonymized: true
        }
    };

    // Try to infer modality from context
    if (context.selectedDatasets.length > 0) {
        const match = context.selectedDatasets.find(
            ds => ds.name.replace(/\s+/g, '_') === dataset
        );
        if (match) {
            meta.modality = match.modality;
            meta.annotation_type = match.annotationType;
        }
    }

    return JSON.stringify(meta, null, 2) + '\n';
}

export const dataMetadataGenerator: ContentGenerator = {
    pattern: 'data-metadata',
    generate: metadataContent_generate
};

// ─── Annotations JSON (detection) ───────────────────────────

function annotationsContent_generate(context: ContentContext): string {
    const dataset: string = datasetName_extract(context.filePath);
    const annotations: Record<string, unknown> = {
        dataset: dataset,
        format: 'COCO-style',
        annotation_type: 'detection',
        categories: [
            { id: 1, name: 'lesion', supercategory: 'pathology' },
            { id: 2, name: 'nodule', supercategory: 'pathology' },
            { id: 3, name: 'mass', supercategory: 'pathology' }
        ],
        annotations: [
            { image_id: 1, category_id: 1, bbox: [120, 200, 80, 60], area: 4800, iscrowd: 0 },
            { image_id: 1, category_id: 2, bbox: [300, 150, 45, 45], area: 2025, iscrowd: 0 },
            { image_id: 2, category_id: 1, bbox: [95, 180, 110, 75], area: 8250, iscrowd: 0 }
        ],
        info: {
            description: `Detection annotations for ${dataset}`,
            version: '1.0',
            contributor: 'ATLAS Federation'
        }
    };

    return JSON.stringify(annotations, null, 2) + '\n';
}

export const dataAnnotationsGenerator: ContentGenerator = {
    pattern: 'data-annotations',
    generate: annotationsContent_generate
};

// ─── Labels CSV (classification) ────────────────────────────

function labelsContent_generate(context: ContentContext): string {
    const dataset: string = datasetName_extract(context.filePath);
    const header: string = 'filename,label,confidence,split';
    const rows: string[] = [
        `# Classification labels for ${dataset}`,
        `# Generated by ARGUS VCS ContentRegistry`,
        `# Format: filename, class label, annotator confidence, data split`,
        '',
        header
    ];

    const labels: string[] = ['normal', 'abnormal', 'uncertain'];
    for (let i = 1; i <= 10; i++) {
        const label: string = labels[i % labels.length];
        const conf: string = (0.75 + Math.random() * 0.24).toFixed(2);
        rows.push(`IMG_${String(i).padStart(3, '0')}.jpg,${label},${conf},train`);
    }

    return rows.join('\n') + '\n';
}

export const dataLabelsGenerator: ContentGenerator = {
    pattern: 'data-labels',
    generate: labelsContent_generate
};
