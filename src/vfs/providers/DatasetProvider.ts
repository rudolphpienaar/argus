/**
 * @file DatasetProvider — Cohort Filesystem Tree Builder
 *
 * Translates selected datasets into a VCS filesystem tree rooted at
 * `~/data/cohort/`. Each dataset becomes an institution directory with
 * images, masks, annotations, and metadata files.
 *
 * Replaces `filesystem_create()` from `core/logic/filesystem.ts`.
 *
 * All methods follow the RPN naming convention: <subject>_<verb>.
 *
 * @module
 */

import type { FileNode } from '../types.js';

/**
 * Minimal dataset interface — only the fields the provider needs.
 * Avoids coupling to the full `core/models/types.Dataset` type.
 */
interface DatasetInput {
    id: string;
    name: string;
    modality: string;
    annotationType: string;
    imageCount: number;
    size: string;
    cost: number;
    provider: string;
    thumbnail: string;
}

/**
 * Builds a VCS filesystem tree from selected datasets.
 *
 * The tree is structured as:
 * ```
 * cohort/
 * ├── training/
 * │   └── <institution>/
 * │       ├── images/
 * │       ├── masks/          (segmentation only)
 * │       ├── annotations.json (detection only)
 * │       ├── labels.csv       (classification only)
 * │       ├── metadata.json
 * │       └── manifest.json
 * └── validation/
 *     └── ...
 * ```
 *
 * @param datasets - The selected datasets to mount.
 * @returns The root FileNode of the cohort tree.
 */
export function cohortTree_build(datasets: DatasetInput[]): FileNode {
    const trainingChildren: FileNode[] = datasets.map(
        (ds: DatasetInput): FileNode => datasetDir_build(ds)
    );

    const validationChildren: FileNode[] = validationDir_build(datasets);

    const cohortManifest: FileNode = node_file(
        'manifest.json',
        '/data/cohort/manifest.json',
        'cohort-manifest'
    );

    return {
        name: 'cohort',
        type: 'folder',
        path: '/data/cohort',
        size: '0 B',
        content: null,
        contentGenerator: null,
        permissions: 'rw',
        modified: new Date(),
        metadata: {},
        children: [
            {
                name: 'training',
                type: 'folder',
                path: '/data/cohort/training',
                size: '0 B',
                content: null,
                contentGenerator: null,
                permissions: 'rw',
                modified: new Date(),
                metadata: {},
                children: trainingChildren
            },
            {
                name: 'validation',
                type: 'folder',
                path: '/data/cohort/validation',
                size: '0 B',
                content: null,
                contentGenerator: null,
                permissions: 'rw',
                modified: new Date(),
                metadata: {},
                children: validationChildren
            },
            cohortManifest
        ]
    };
}

// ─── Internal Helpers ───────────────────────────────────────

/**
 * Builds a single dataset directory with images, masks, and metadata.
 *
 * @param ds - The dataset to build a directory for.
 * @returns A folder FileNode representing the dataset.
 */
function datasetDir_build(ds: DatasetInput): FileNode {
    const dirName: string = ds.name.replace(/\s+/g, '_');
    const basePath: string = `/data/cohort/training/${dirName}`;
    const providerCode: string = providerCode_extract(ds.thumbnail);

    // Image nodes
    const imageNodes: FileNode[] = imageNodes_build(ds, providerCode, `${basePath}/images`);
    const children: FileNode[] = [
        {
            name: 'images',
            type: 'folder',
            path: `${basePath}/images`,
            size: '0 B',
            content: null,
            contentGenerator: null,
            permissions: 'ro',
            modified: new Date(),
            metadata: {},
            children: imageNodes
        }
    ];

    // Annotation-type-specific files
    if (ds.annotationType === 'segmentation') {
        const maskNodes: FileNode[] = maskNodes_build(ds, providerCode, `${basePath}/masks`);
        children.push({
            name: 'masks',
            type: 'folder',
            path: `${basePath}/masks`,
            size: '0 B',
            content: null,
            contentGenerator: null,
            permissions: 'ro',
            modified: new Date(),
            metadata: {},
            children: maskNodes
        });
    } else if (ds.annotationType === 'detection') {
        children.push(node_file(
            'annotations.json',
            `${basePath}/annotations.json`,
            null,
            `${(ds.imageCount * 0.15).toFixed(1)} KB`
        ));
    } else {
        children.push(node_file(
            'labels.csv',
            `${basePath}/labels.csv`,
            null,
            `${(ds.imageCount * 0.05).toFixed(1)} KB`
        ));
    }

    // Always add metadata and manifest
    children.push(node_file('metadata.json', `${basePath}/metadata.json`, null, '4 KB'));
    children.push(node_file('manifest.json', `${basePath}/manifest.json`, 'dataset-manifest'));

    return {
        name: dirName,
        type: 'folder',
        path: basePath,
        size: ds.size || '0 B',
        content: null,
        contentGenerator: null,
        permissions: 'ro',
        modified: new Date(),
        metadata: {
            datasetId: ds.id,
            modality: ds.modality,
            provider: ds.provider
        },
        children
    };
}

/**
 * Builds image file nodes for a dataset.
 *
 * @param ds - The dataset.
 * @param providerCode - Short provider code extracted from thumbnail.
 * @param basePath - Parent path for the images directory.
 * @returns Array of file FileNodes representing images.
 */
function imageNodes_build(ds: DatasetInput, providerCode: string, basePath: string): FileNode[] {
    const nodes: FileNode[] = [];
    for (let i: number = 1; i <= ds.imageCount; i++) {
        const fileName: string = imageName_generate(providerCode, i);
        nodes.push(node_file(fileName, `${basePath}/${fileName}`, null, '0 B'));
    }
    return nodes;
}

/**
 * Builds mask file nodes for segmentation datasets.
 *
 * @param ds - The dataset.
 * @param providerCode - Short provider code extracted from thumbnail.
 * @param basePath - Parent path for the masks directory.
 * @returns Array of file FileNodes representing masks.
 */
function maskNodes_build(ds: DatasetInput, providerCode: string, basePath: string): FileNode[] {
    const nodes: FileNode[] = [];
    for (let i: number = 1; i <= ds.imageCount; i++) {
        const fileName: string = maskName_generate(providerCode, i);
        nodes.push(node_file(fileName, `${basePath}/${fileName}`, null, '0 B'));
    }
    return nodes;
}

/**
 * Generates an image filename based on provider conventions.
 *
 * @param providerCode - Short provider code.
 * @param index - 1-based image index.
 * @returns Formatted filename.
 */
function imageName_generate(providerCode: string, index: number): string {
    if (providerCode === 'WBC') {
        return `WBC_${String(index).padStart(3, '0')}.bmp`;
    }
    if (providerCode === 'KaggleBrain') {
        const num: number = 10 + (index - 1);
        return `Tr-gl_${String(num).padStart(4, '0')}.jpg`;
    }
    return `${providerCode}_${String(index).padStart(3, '0')}.jpg`;
}

/**
 * Generates a mask filename based on provider conventions.
 *
 * @param providerCode - Short provider code.
 * @param index - 1-based mask index.
 * @returns Formatted filename.
 */
function maskName_generate(providerCode: string, index: number): string {
    if (providerCode === 'WBC') {
        return `WBC_${String(index).padStart(3, '0')}_mask.png`;
    }
    if (providerCode === 'KaggleBrain') {
        const num: number = 10 + (index - 1);
        return `Tr-gl_${String(num).padStart(4, '0')}_mask.png`;
    }
    return `${providerCode}_${String(index).padStart(3, '0')}_mask.png`;
}

/**
 * Builds the validation directory tree based on dominant modality.
 *
 * @param datasets - The selected datasets.
 * @returns Array of children for the validation directory.
 */
function validationDir_build(datasets: DatasetInput[]): FileNode[] {
    const modalityCount: Record<string, number> = {};
    for (const ds of datasets) {
        modalityCount[ds.modality] = (modalityCount[ds.modality] || 0) + 1;
    }
    const dominantModality: string = Object.keys(modalityCount).reduce(
        (a: string, b: string): string => modalityCount[a] > modalityCount[b] ? a : b,
        'xray'
    );

    const valBasePath: string = '/data/cohort/validation';

    if (dominantModality === 'mri' || dominantModality === 'pathology') {
        return [
            {
                name: 'images',
                type: 'folder',
                path: `${valBasePath}/images`,
                size: '0 B',
                content: null,
                contentGenerator: null,
                permissions: 'ro',
                modified: new Date(),
                metadata: {},
                children: [
                    node_file('val_001.jpg', `${valBasePath}/images/val_001.jpg`),
                    node_file('val_002.jpg', `${valBasePath}/images/val_002.jpg`)
                ]
            },
            {
                name: 'masks',
                type: 'folder',
                path: `${valBasePath}/masks`,
                size: '0 B',
                content: null,
                contentGenerator: null,
                permissions: 'ro',
                modified: new Date(),
                metadata: {},
                children: [
                    node_file('val_001_mask.png', `${valBasePath}/masks/val_001_mask.png`),
                    node_file('val_002_mask.png', `${valBasePath}/masks/val_002_mask.png`)
                ]
            }
        ];
    }

    // Default: xray/classification
    return [
        {
            name: 'images',
            type: 'folder',
            path: `${valBasePath}/images`,
            size: '0 B',
            content: null,
            contentGenerator: null,
            permissions: 'ro',
            modified: new Date(),
            metadata: {},
            children: [
                node_file('val_001.jpg', `${valBasePath}/images/val_001.jpg`),
                node_file('val_002.jpg', `${valBasePath}/images/val_002.jpg`)
            ]
        },
        node_file('labels.csv', `${valBasePath}/labels.csv`, null, '256 KB')
    ];
}

/**
 * Extracts a short provider code from a thumbnail path.
 *
 * @param thumbnail - The thumbnail URL (e.g., 'data/NIH/thumb.jpg').
 * @returns Short provider code (e.g., 'NIH').
 */
function providerCode_extract(thumbnail: string): string {
    const parts: string[] = thumbnail.split('/');
    return parts.length > 1 ? parts[1] : 'UNK';
}

/**
 * Creates a file FileNode with sensible defaults.
 *
 * @param name - Filename.
 * @param path - Absolute path.
 * @param contentGenerator - Optional generator key for lazy content.
 * @param size - Optional human-readable size string.
 * @returns A file FileNode.
 */
function node_file(
    name: string,
    path: string,
    contentGenerator: string | null = null,
    size: string = '0 B'
): FileNode {
    return {
        name,
        type: 'file',
        path,
        size,
        content: null,
        contentGenerator,
        permissions: 'ro',
        modified: new Date(),
        metadata: {},
        children: null
    };
}
