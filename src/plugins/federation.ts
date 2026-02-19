/**
 * @file Plugin: Federation
 *
 * Implements the multi-phase federation handshake protocol by delegating
 * to the FederationOrchestrator service.
 *
 * @module plugins/federation
 */

import type { CalypsoResponse, PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';

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
    const response: CalypsoResponse = federation.command(command, args, username);

    return {
        message: response.message,
        statusCode: response.statusCode ?? (response.success ? CalypsoStatusCode.OK : CalypsoStatusCode.ERROR),
        actions: response.actions,
        artifactData: { 
            step: command,
            success: response.success,
            timestamp: new Date().toISOString()
        },
        ui_hints: response.ui_hints
    };
}
