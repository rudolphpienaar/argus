/**
 * @file Process Runtime State
 *
 * Holds mutable runtime references for Process-stage modules.
 *
 * @module core/stages/process/runtime/state
 */

import { FileBrowser } from '../../../../ui/components/FileBrowser.js';

/**
 * Mutable runtime state for Process-stage handlers.
 */
export interface ProcessStageRuntimeState {
    ideBrowser: FileBrowser | null;
}

/**
 * Singleton Process-stage runtime state.
 */
export const processStage_state: ProcessStageRuntimeState = {
    ideBrowser: null,
};
