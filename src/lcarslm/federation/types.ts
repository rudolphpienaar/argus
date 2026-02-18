/**
 * @file Federation Types
 *
 * Type definitions for the multi-phase federation handshake protocol.
 *
 * @module
 */

import type { 
    FederationVisibility, 
    FederationStep, 
    FederationPublishConfig, 
    FederationState 
} from '../../core/models/types.js';

export {
    FederationVisibility,
    FederationStep,
    FederationPublishConfig,
    FederationState
};

export interface FederationDagPaths {
    crosscompileBase: string;
    crosscompileData: string;
    containerizeBase: string;
    containerizeData: string;
    publishBase: string;
    publishData: string;
    dispatchBase: string;
    dispatchData: string;
    dispatchReceipts: string;
    roundsBase: string;
    roundsData: string;
}

export interface FederationArgs {
    abort: boolean;
    restart: boolean;
    name: string | null;
    org: string | null;
    visibility: FederationVisibility | null;
}
