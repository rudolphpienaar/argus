import { describe, it, expect } from 'vitest';
import { filesystem_create } from './filesystem.js';
import type { Dataset, FileNode } from '../models/types.js';

describe('filesystem_create', () => {
    const mockDatasetBase: Dataset = {
        id: 'd1',
        name: 'Test DS',
        description: 'desc',
        modality: 'xray',
        annotationType: 'classification',
        imageCount: 10,
        size: '100MB',
        cost: 10,
        provider: 'BCH',
        thumbnail: 'data/BCH/BCH_001.jpg'
    };

    it('should create a basic folder structure for empty datasets', () => {
        const root: FileNode = filesystem_create([]);
        
        expect(root.name).toBe('cohort');
        expect(root.type).toBe('folder');
        expect(root.children).toHaveLength(2); // training, validation

        const training = root.children?.find(c => c.name === 'training');
        expect(training).toBeDefined();
        expect(training?.children).toHaveLength(0);

        const validation = root.children?.find(c => c.name === 'validation');
        expect(validation).toBeDefined();
        expect(validation?.children).toHaveLength(2); // images, labels.csv
    });

    it('should generate correct structure for classification dataset', () => {
        const ds: Dataset = { ...mockDatasetBase, annotationType: 'classification' };
        const root: FileNode = filesystem_create([ds]);
        
        const training = root.children?.find(c => c.name === 'training');
        const dsFolder = training?.children?.[0];

        expect(dsFolder).toBeDefined();
        expect(dsFolder?.name).toBe('Test_DS');
        
        // Check children: images, labels.csv, metadata.json
        expect(dsFolder?.children).toHaveLength(3);
        expect(dsFolder?.children?.find(c => c.name === 'images')).toBeDefined();
        expect(dsFolder?.children?.find(c => c.name === 'labels.csv')).toBeDefined();
        expect(dsFolder?.children?.find(c => c.name === 'metadata.json')).toBeDefined();
    });

    it('should generate correct structure for detection dataset', () => {
        const ds: Dataset = { ...mockDatasetBase, annotationType: 'detection' };
        const root: FileNode = filesystem_create([ds]);
        
        const training = root.children?.find(c => c.name === 'training');
        const dsFolder = training?.children?.[0];

        // Check children: images, annotations.json, metadata.json
        expect(dsFolder?.children).toHaveLength(3);
        expect(dsFolder?.children?.find(c => c.name === 'annotations.json')).toBeDefined();
    });

    it('should generate correct structure for segmentation dataset (with masks)', () => {
        const ds: Dataset = { ...mockDatasetBase, annotationType: 'segmentation' };
        const root: FileNode = filesystem_create([ds]);
        
        const training = root.children?.find(c => c.name === 'training');
        const dsFolder = training?.children?.[0];

        // Check children: images, masks, metadata.json
        expect(dsFolder?.children).toHaveLength(3);
        expect(dsFolder?.children?.find(c => c.name === 'masks')).toBeDefined();

        const masks = dsFolder?.children?.find(c => c.name === 'masks');
        expect(masks?.children).toHaveLength(10); // Matches imageCount
        expect(masks?.children?.[0].name).toContain('_mask.png');
    });

    it('should handle special provider naming (WBC)', () => {
        const ds: Dataset = { 
            ...mockDatasetBase, 
            provider: 'Jiangxi', 
            thumbnail: 'data/WBC/images/WBC_001.bmp',
            annotationType: 'segmentation',
            imageCount: 5
        };
        const root: FileNode = filesystem_create([ds]);
        
        const training = root.children?.find(c => c.name === 'training');
        const dsFolder = training?.children?.[0];
        
        const images = dsFolder?.children?.find(c => c.name === 'images');
        expect(images?.children?.[0].name).toBe('WBC_001.bmp');

        const masks = dsFolder?.children?.find(c => c.name === 'masks');
        expect(masks?.children?.[0].name).toBe('WBC_001_mask.png');
    });

    it('should handle special provider naming (KaggleBrain)', () => {
        const ds: Dataset = { 
            ...mockDatasetBase, 
            provider: 'Kaggle', 
            thumbnail: 'data/KaggleBrain/Training/glioma/Tr-gl_0010.jpg',
            annotationType: 'segmentation',
            imageCount: 5
        };
        const root: FileNode = filesystem_create([ds]);
        
        const training = root.children?.find(c => c.name === 'training');
        const dsFolder = training?.children?.[0];
        
        const images = dsFolder?.children?.find(c => c.name === 'images');
        // Logic starts at 10 for KaggleBrain
        expect(images?.children?.[0].name).toBe('Tr-gl_0010.jpg');

        const masks = dsFolder?.children?.find(c => c.name === 'masks');
        expect(masks?.children?.[0].name).toBe('Tr-gl_0010_mask.png');
    });
});
