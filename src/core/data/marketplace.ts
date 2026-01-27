/**
 * @file Marketplace Assets Data
 */

export interface MarketplaceAsset {
    id: string;
    name: string;
    type: 'plugin' | 'dataset' | 'model' | 'workflow';
    version: string;
    description: string;
    author: string;
    stars: number;
    size: string;
    installed: boolean;
}

export const MARKETPLACE_ASSETS: MarketplaceAsset[] = [
    {
        id: 'pl-fetal-brain-mask',
        name: 'pl-fetal-brain-mask',
        type: 'plugin',
        version: '1.2.0',
        description: 'Automated 3D masking of fetal brain MRIs using deep learning.',
        author: 'FNNDSC',
        stars: 124,
        size: '450 MB',
        installed: false
    },
    {
        id: 'pl-med2img',
        name: 'pl-med2img',
        type: 'plugin',
        version: '2.3.1',
        description: 'Utility to convert medical image formats (DICOM, NIfTI) to PNG/JPG.',
        author: 'ChRIS Project',
        stars: 89,
        size: '12 MB',
        installed: false
    },
    {
        id: 'ds-standard-atlas-liver',
        name: 'Standard Liver Atlas',
        type: 'dataset',
        version: 'v2',
        description: 'High-resolution reference dataset for liver segmentation.',
        author: 'NIH',
        stars: 210,
        size: '15 GB',
        installed: false
    },
    {
        id: 'mdl-resnet50-chest-xray',
        name: 'ResNet50-Chest-v4',
        type: 'model',
        version: '4.0.0',
        description: 'Pre-trained weights for 14-class chest X-ray classification.',
        author: 'Stanford ML',
        stars: 450,
        size: '102 MB',
        installed: false
    }
];
