/**
 * @file Federation Types
 *
 * Type definitions for the multi-phase federation handshake protocol.
 *
 * @module
 */

export type FederationVisibility = 'public' | 'private';

/**
 * Federation step IDs — aligned 1:1 with fedml.manifest.yaml stage IDs.
 */
export type FederationStep =
    | 'federate-brief'
    | 'federate-transcompile'
    | 'federate-containerize'
    | 'federate-publish-config'
    | 'federate-publish-execute'
    | 'federate-dispatch'
    | 'federate-execute'
    | 'federate-model-publish';

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
    abort: boolean;
    restart: boolean;
    name: string | null;
    org: string | null;
    visibility: FederationVisibility | null;
}
