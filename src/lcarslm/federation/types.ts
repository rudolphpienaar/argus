/**
 * @file Federation Types
 *
 * Type definitions for the multi-phase federation handshake protocol.
 *
 * @module
 */

export type FederationVisibility = 'public' | 'private';

export type FederationStep =
    | 'transcompile'
    | 'containerize'
    | 'publish_prepare'
    | 'publish_configure'
    | 'dispatch_compute';

export interface FederationPublishConfig {
    appName: string | null;
    org: string | null;
    visibility: FederationVisibility;
}

export interface FederationState {
    projectId: string;
    step: FederationStep;
    publish: FederationPublishConfig;
}

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
    confirm: boolean;
    abort: boolean;
    restart: boolean;
    name: string | null;
    org: string | null;
    visibility: FederationVisibility | null;
}
