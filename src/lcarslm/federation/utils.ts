/**
 * @file Federation Utilities
 *
 * Helper functions for the Federation Orchestrator and its phase handlers.
 *
 * @module lcarslm/federation/utils
 */

import type { CalypsoAction, CalypsoResponse } from '../types.js';
import { CalypsoStatusCode } from '../types.js';
import type { FederationArgs, FederationDagPaths, FederationPublishConfig, FederationState } from './types.js';

// ─── Response Helpers ────────────────────────────────────────────────────────

/**
 * Create a standardized Calypso response.
 */
export function response_create(
    message: string,
    actions: CalypsoAction[],
    success: boolean
): CalypsoResponse {
    return { 
        message, 
        actions, 
        success, 
        statusCode: success ? CalypsoStatusCode.OK : CalypsoStatusCode.ERROR 
    };
}

// ─── Display Helpers ─────────────────────────────────────────────────────────

/**
 * Format publication configuration summary lines.
 */
export function publishSummary_lines(publish: FederationPublishConfig): string[] {
    return [
        `○ APP: ${publish.appName ?? '(unset)'}`,
        `○ ORG: ${publish.org ?? '(none)'}`,
        `○ VISIBILITY: ${publish.visibility.toUpperCase()}`,
    ];
}

// ─── State Management ────────────────────────────────────────────────────────

/**
 * Create initial federation state for a project.
 */
export function state_create(projectId: string, projectName: string): FederationState {
    return {
        projectId,
        step: 'federate-brief',
        publish: {
            appName: `${projectName}-fedapp`,
            org: null,
            visibility: 'public'
        }
    };
}

/**
 * Apply publish config mutations from command arguments.
 * Returns true if the state was mutated.
 */
export function publish_mutate(state: FederationState, args: FederationArgs): boolean {
    let changed: boolean = false;
    if (args.name !== null && args.name !== state.publish.appName) {
        state.publish.appName = args.name;
        changed = true;
    }
    if (args.org !== null && args.org !== state.publish.org) {
        state.publish.org = args.org;
        changed = true;
    }
    if (args.visibility && args.visibility !== state.publish.visibility) {
        state.publish.visibility = args.visibility;
        changed = true;
    }

    return changed;
}

// ─── DAG Paths ──────────────────────────────────────────────────────────────

/**
 * Compute federation DAG paths for a project.
 */
export function dag_paths(projectBase: string): FederationDagPaths {
    const crosscompileBase: string = `${projectBase}/src/source-crosscompile`;
    const crosscompileData: string = `${crosscompileBase}/data`;
    const containerizeBase: string = `${crosscompileBase}/containerize`;
    const containerizeData: string = `${containerizeBase}/data`;
    const publishBase: string = `${containerizeBase}/marketplace-publish`;
    const publishData: string = `${publishBase}/data`;
    const dispatchBase: string = `${publishBase}/dispatch`;
    const dispatchData: string = `${dispatchBase}/data`;
    const dispatchReceipts: string = `${dispatchData}/receipts`;
    const roundsBase: string = `${dispatchBase}/federated-rounds`;
    const roundsData: string = `${roundsBase}/data`;

    return {
        crosscompileBase, crosscompileData,
        containerizeBase, containerizeData,
        publishBase, publishData,
        dispatchBase, dispatchData, dispatchReceipts,
        roundsBase, roundsData
    };
}
