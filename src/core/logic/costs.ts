/**
 * @file Cost calculation logic for ARGUS.
 *
 * Provides pure functions for estimating the costs associated with
 * federated learning tasks, including data access, compute, and storage.
 *
 * @module
 */

import type { Dataset, CostEstimate } from '../models/types.js';

/**
 * Calculates the estimated cost for a set of selected datasets.
 *
 * Computes data access costs based on the sum of dataset costs, and derives
 * compute and storage costs as factors of the data access cost.
 *
 * @param datasets - The list of datasets selected for the operation.
 * @returns A CostEstimate object containing the breakdown and total.
 */
export function costEstimate_calculate(datasets: Dataset[]): CostEstimate {
    const dataAccess = datasets.reduce((sum, ds) => sum + ds.cost, 0);
    // Mock compute cost factor: 2.5x data cost
    const compute = dataAccess * 2.5;
    // Mock storage cost factor: 0.3x data cost
    const storage = dataAccess * 0.3;

    return {
        dataAccess,
        compute,
        storage,
        total: dataAccess + compute + storage
    };
}
