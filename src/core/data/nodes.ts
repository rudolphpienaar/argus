/**
 * @file Mock Trusted Domain Nodes
 *
 * Represents the federated nodes available in the prototype.
 *
 * @module
 */

import type { TrustedDomainNode } from '../models/types.js';

export const MOCK_NODES: TrustedDomainNode[] = [
    { id: 'td-001', name: 'BCH-TD-01', institution: "Boston Children's Hospital", status: 'initializing', progress: 0, samplesProcessed: 0, totalSamples: 293 },
    { id: 'td-002', name: 'MGH-TD-01', institution: 'Mass General Hospital', status: 'initializing', progress: 0, samplesProcessed: 0, totalSamples: 249 },
    { id: 'td-003', name: 'BIDMC-TD-01', institution: 'Beth Israel Deaconess', status: 'initializing', progress: 0, samplesProcessed: 0, totalSamples: 177 },
    { id: 'td-004', name: 'BWH-TD-01', institution: "Brigham and Women's", status: 'initializing', progress: 0, samplesProcessed: 0, totalSamples: 223 },
    { id: 'td-005', name: 'MOC-HUB', institution: 'Mass Open Cloud (Aggregator)', status: 'initializing', progress: 0, samplesProcessed: 0, totalSamples: 0 }
];
