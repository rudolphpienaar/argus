/**
 * @file Filesystem generation logic for ARGUS.
 *
 * Provides pure functions for creating virtual filesystem structures
 * from selected datasets.
 *
 * @module
 */

import type { Dataset, FileNode } from '../models/types.js';

/**
 * Creates a virtual filesystem tree from a list of datasets.
 *
 * @param datasets - The list of datasets to include in the filesystem.
 * @returns The root FileNode of the virtual filesystem.
 */
export function filesystem_create(datasets: Dataset[]): FileNode {
    return {
        name: 'cohort',
        type: 'folder',
        path: '/cohort',
        children: [
            {
                name: 'training',
                type: 'folder',
                path: '/cohort/training',
                children: datasets.map(ds => {
                    // Extract provider code from thumbnail path
                    const parts: string[] = ds.thumbnail.split('/');
                    const providerCode: string = parts.length > 2 ? parts[1] : 'UNK';
                    
                    // Generate image nodes based on count
                    const imageNodes: FileNode[] = [];
                    for (let i = 1; i <= ds.imageCount; i++) {
                        // Special handling for exemplars
                        if (providerCode === 'WBC') {
                            const fileName: string = `WBC_${String(i).padStart(3, '0')}.bmp`;
                            imageNodes.push({
                                name: fileName,
                                type: 'image',
                                path: `data/WBC/images/${fileName}`
                            });
                        } else if (providerCode === 'KaggleBrain') {
                            // Map index to real filenames (0010 to 0029)
                            const num: number = 10 + (i - 1);
                            const fileName: string = `Tr-gl_${String(num).padStart(4, '0')}.jpg`;
                            imageNodes.push({
                                name: fileName,
                                type: 'image',
                                path: `data/KaggleBrain/Training/glioma/${fileName}`
                            });
                        } else {
                            const fileName: string = `${providerCode}_${String(i).padStart(3, '0')}.jpg`;
                            imageNodes.push({
                                name: fileName,
                                type: 'image',
                                path: `data/${providerCode}/${fileName}`
                            });
                        }
                    }

                    // Build children based on annotation type
                    const children: FileNode[] = [
                        { 
                            name: 'images', 
                            type: 'folder' as const, 
                            path: '', 
                            children: imageNodes 
                        }
                    ];

                    // Add auxiliary files based on type
                    if (ds.annotationType === 'segmentation') {
                        // Add masks folder
                        const maskNodes: FileNode[] = [];
                        for (let i = 1; i <= ds.imageCount; i++) {
                            if (providerCode === 'WBC') {
                                const maskName: string = `WBC_${String(i).padStart(3, '0')}_mask.png`;
                                maskNodes.push({
                                    name: maskName,
                                    type: 'image',
                                    path: `data/WBC/masks/${maskName}`
                                });
                            } else if (providerCode === 'KaggleBrain') {
                                const num: number = 10 + (i - 1);
                                const maskName: string = `Tr-gl_${String(num).padStart(4, '0')}_mask.png`;
                                maskNodes.push({
                                    name: maskName,
                                    type: 'image',
                                    path: `data/KaggleBrain/masks/${maskName}`
                                });
                            } else {
                                const maskName: string = `${providerCode}_${String(i).padStart(3, '0')}_mask.png`;
                                maskNodes.push({
                                    name: maskName,
                                    type: 'image',
                                    path: `data/${providerCode}/masks/${maskName}`
                                });
                            }
                        }
                        children.push({
                            name: 'masks',
                            type: 'folder' as const,
                            path: '',
                            children: maskNodes
                        });
                    } else if (ds.annotationType === 'detection') {
                        // Add annotations.json
                        children.push({ 
                            name: 'annotations.json', 
                            type: 'file' as const, 
                            path: '', 
                            size: `${(ds.imageCount * 0.15).toFixed(1)} KB` 
                        });
                    } else {
                        // Default classification: labels.csv
                        children.push({ 
                            name: 'labels.csv', 
                            type: 'file' as const, 
                            path: '', 
                            size: `${(ds.imageCount * 0.05).toFixed(1)} KB` 
                        });
                    }
                    
                    // Always add metadata
                    children.push({ name: 'metadata.json', type: 'file' as const, path: '', size: '4 KB' });

                    return {
                        name: ds.name.replace(/\s+/g, '_'),
                        type: 'folder' as const,
                        path: `/cohort/training/${ds.name.replace(/\s+/g, '_')}`,
                        children: children
                    };
                })
            },
            {
                name: 'validation',
                type: 'folder',
                path: '/cohort/validation',
                children: (() => {
                    // Determine dominant modality
                    const modalityCount: Record<string, number> = {};
                    datasets.forEach(ds => {
                        modalityCount[ds.modality] = (modalityCount[ds.modality] || 0) + 1;
                    });
                    const dominantModality = Object.keys(modalityCount).reduce((a, b) => modalityCount[a] > modalityCount[b] ? a : b, 'xray');

                    if (dominantModality === 'mri') {
                        return [
                            { name: 'images', type: 'folder' as const, path: '', children: [
                                { name: 'val_001.jpg', type: 'image' as const, path: 'data/KaggleBrain/Training/glioma/Tr-gl_0011.jpg' },
                                { name: 'val_002.jpg', type: 'image' as const, path: 'data/KaggleBrain/Training/glioma/Tr-gl_0012.jpg' }
                            ]},
                            { name: 'masks', type: 'folder' as const, path: '', children: [
                                { name: 'val_001_mask.png', type: 'image' as const, path: 'data/KaggleBrain/masks/Tr-gl_0011_mask.png' },
                                { name: 'val_002_mask.png', type: 'image' as const, path: 'data/KaggleBrain/masks/Tr-gl_0012_mask.png' }
                            ]}
                        ];
                    } else if (dominantModality === 'pathology') {
                        return [
                            { name: 'images', type: 'folder' as const, path: '', children: [
                                { name: 'val_001.bmp', type: 'image' as const, path: 'data/WBC/images/WBC_010.bmp' },
                                { name: 'val_002.bmp', type: 'image' as const, path: 'data/WBC/images/WBC_011.bmp' }
                            ]},
                            { name: 'masks', type: 'folder' as const, path: '', children: [
                                { name: 'val_001_mask.png', type: 'image' as const, path: 'data/WBC/masks/WBC_010_mask.png' },
                                { name: 'val_002_mask.png', type: 'image' as const, path: 'data/WBC/masks/WBC_011_mask.png' }
                            ]}
                        ];
                    } else {
                        // Default to X-Ray (NIH)
                        return [
                            { name: 'images', type: 'folder' as const, path: '', children: [
                                { name: 'val_001.jpg', type: 'image' as const, path: 'data/NIH/NIH_001.jpg' },
                                { name: 'val_002.jpg', type: 'image' as const, path: 'data/NIH/NIH_002.jpg' }
                            ]},
                            { name: 'labels.csv', type: 'file' as const, path: '', size: '256 KB' }
                        ];
                    }
                })()
            }
        ]
    };
}
