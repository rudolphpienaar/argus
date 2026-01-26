/**
 * @file Mock Dataset Repository
 *
 * Central repository for all mock medical imaging datasets used in the prototype.
 *
 * @module
 */

import type { Dataset } from '../models/types.js';

export const DATASETS: Dataset[] = [
    {
        id: 'ds-001',
        name: 'BCH Chest X-ray Cohort',
        description: 'Pediatric chest radiographs from Boston Children\'s Hospital. Suitable for pneumonia and pathology detection in children.',
        modality: 'xray',
        annotationType: 'classification',
        imageCount: 293,
        size: '1.2 GB',
        cost: 45.00,
        provider: 'Boston Children\'s Hospital',
        thumbnail: 'data/BCH/BCH_001.jpg'
    },
    {
        id: 'ds-002',
        name: 'MGH COVID Collection',
        description: 'Adult chest X-rays with COVID-19 annotations. High-quality labels for viral pneumonia differentiation.',
        modality: 'xray',
        annotationType: 'classification',
        imageCount: 249,
        size: '1.1 GB',
        cost: 35.00,
        provider: 'Mass General Hospital',
        thumbnail: 'data/MGH/MGH_001.jpg'
    },
    {
        id: 'ds-003',
        name: 'BIDMC Pneumonia Set',
        description: 'Emergency department chest films labeled for pneumonia. Includes bounding boxes for opacities.',
        modality: 'xray',
        annotationType: 'detection',
        imageCount: 177,
        size: '0.8 GB',
        cost: 25.00,
        provider: 'Beth Israel Deaconess',
        thumbnail: 'data/BIDMC/BIDMC_001.jpg'
    },
    {
        id: 'ds-004',
        name: 'BWH Thoracic Segments',
        description: 'High-resolution chest X-rays with organ segmentation (lungs, heart, clavicles). Pixel-level masks provided.',
        modality: 'xray',
        annotationType: 'segmentation',
        imageCount: 223,
        size: '1.5 GB',
        cost: 40.00,
        provider: 'Brigham and Women\'s',
        thumbnail: 'data/BWH/BWH_001.jpg'
    },
    {
        id: 'ds-005',
        name: 'Brain MRI Segmentation',
        description: 'Brain Tumor MRI Dataset (Glioma) with generated masks. T1-weighted, contrast-enhanced images.',
        modality: 'mri',
        annotationType: 'segmentation',
        imageCount: 20,
        size: '18 MB',
        cost: 15.00,
        provider: 'Kaggle (Masoud Nickparvar)',
        thumbnail: 'data/KaggleBrain/Training/glioma/Tr-gl_0010.jpg'
    },
    {
        id: 'ds-006',
        name: 'Histology Segmentation',
        description: 'Microscopic white blood cell images with ground truth masks. Peripheral blood smear samples.',
        modality: 'pathology',
        annotationType: 'segmentation',
        imageCount: 20,
        size: '15 MB',
        cost: 5.00,
        provider: 'Jiangxi University',
        thumbnail: 'data/WBC/images/WBC_001.bmp'
    }
];
