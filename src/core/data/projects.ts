/**
 * @file Mock Project Repository
 * 
 * Simulated saved projects for the developer workspace.
 * 
 * @module
 */

import type { Project } from '../models/types.js';
import { DATASETS } from './datasets.js';

export const MOCK_PROJECTS: Project[] = [
    {
        id: 'proj-001',
        name: 'pneumonia-study-v1',
        description: 'Initial cohort for pediatric pneumonia detection model.',
        created: new Date('2025-12-10'),
        lastModified: new Date('2026-01-20'),
        datasets: [DATASETS[0], DATASETS[2]] // BCH + BIDMC
    },
    {
        id: 'proj-002',
        name: 'brain-tumor-segmentation',
        description: 'Glioma segmentation using Kaggle MRI data.',
        created: new Date('2026-01-15'),
        lastModified: new Date('2026-01-22'),
        datasets: [DATASETS[4]] // Brain MRI
    }
];
