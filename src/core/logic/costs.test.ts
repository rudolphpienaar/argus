import { describe, it, expect } from 'vitest';
import { costEstimate_calculate } from './costs.js';
import type { Dataset } from '../models/types.js';

describe('costEstimate_calculate', () => {
    it('should return zero costs for an empty dataset list', () => {
        const result = costEstimate_calculate([]);
        expect(result).toEqual({
            dataAccess: 0,
            compute: 0,
            storage: 0,
            total: 0
        });
    });

    it('should calculate costs correctly for a single dataset', () => {
        const mockDataset: Dataset = {
            id: 'd1',
            name: 'Test DS',
            description: 'desc',
            modality: 'xray',
            annotationType: 'classification',
            imageCount: 100,
            size: '1GB',
            cost: 100,
            provider: 'Test',
            thumbnail: 'thumb.jpg'
        };

        const result = costEstimate_calculate([mockDataset]);

        // dataAccess = 100
        // compute = 100 * 2.5 = 250
        // storage = 100 * 0.3 = 30
        // total = 100 + 250 + 30 = 380

        expect(result.dataAccess).toBe(100);
        expect(result.compute).toBe(250);
        expect(result.storage).toBeCloseTo(30);
        expect(result.total).toBe(380);
    });

    it('should accumulate costs for multiple datasets', () => {
        const ds1 = { cost: 10 } as Dataset;
        const ds2 = { cost: 20 } as Dataset;

        const result = costEstimate_calculate([ds1, ds2]);

        // total data = 30
        expect(result.dataAccess).toBe(30);
        expect(result.compute).toBe(30 * 2.5); // 75
        expect(result.storage).toBe(30 * 0.3); // 9
        expect(result.total).toBe(30 + 75 + 9); // 114
    });
});
