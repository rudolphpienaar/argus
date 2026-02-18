/**
 * @file Plugin: Federation
 *
 * Implements the multi-phase federation handshake protocol by delegating
 * to the FederationOrchestrator service.
 *
 * @module plugins/federation
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';
import { FederationOrchestrator } from '../lcarslm/federation/FederationOrchestrator.js';

/**
 * Execute the federation logic based on the command verb.
 *
 * @param context - The Argus VM standard library.
 * @returns Standard plugin result.
 */
export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    const { command, args, shell, federation } = context;
    
    // 1. Delegate to the stateful orchestrator instance
    const username: string = shell.env_get('USER') || 'user';
    const response: any = federation.command(command, args, username);

    return {
        message: response.message,
        statusCode: response.success ? CalypsoStatusCode.OK : CalypsoStatusCode.ERROR,
        actions: response.actions,
        artifactData: { 
            step: command,
            success: response.success,
            timestamp: new Date().toISOString()
        }
    };
}
