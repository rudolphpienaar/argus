/**
 * @file Plugin: Gather Gate
 *
 * Structural plugin that functions as a causal lock for raw cohort assembly.
 * It clones the output of the 'gather' stage into its own stage directory,
 * providing a stable substrate for downstream analysis and reorganization.
 *
 * @module plugins/gather-gate
 * @see FEDML.md (Dual-Gate Provenance Contract)
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';

/**
 * Execute the causal copy from gather input to gate output.
 *
 * @param context - The Argus VM standard library.
 * @returns Standard plugin result.
 */
export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    const { vfs, dataDir, ui } = context;

    ui.status('GATE: MATERIALIZING CAUSAL COHORT LOCK...');
    
    // Resolve upstream gather output from input mounting.
    // In the dual-gate model, gather is a parent of the join, 
    // which is a parent of this gate. The PluginHost links 
    // immediate parents into input/.
    const gatherInputPath = 'input/gather';
    const gateOutputPath = dataDir; // This is the 'output/' of gather-gate

    try {
        // v12.0: Physical Copy
        // We clone the upstream gather output into our own output directory.
        // This anchors the cohort to this specific point in the DAG.
        vfs.tree_clone(gatherInputPath, gateOutputPath);
        
        ui.log('\u25CF COHORT ASSETS LOCKED IN GATHER-GATE.');
        ui.log(`  ○ Source: ${gatherInputPath}`);
        ui.log(`  ○ Commit: ${gateOutputPath}`);

        return {
            message: 'GATHER OUTPUT LOCKED. READY FOR ANALYSIS.',
            statusCode: CalypsoStatusCode.OK,
            artifactData: {
                timestamp: new Date().toISOString(),
                source: 'gather',
                gate: 'locked'
            }
        };
    } catch (e: any) {
        return {
            message: `>> ERROR: GATHER-GATE FAILED TO LOCK COHORT: ${e.message}`,
            statusCode: CalypsoStatusCode.ERROR
        };
    }
}
