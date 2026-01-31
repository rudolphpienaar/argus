/**
 * @file Stage Lifecycle Logic
 *
 * Defines the standard hooks for stage-specific initialization and teardown.
 *
 * @module
 */

/**
 * Interface for a stage lifecycle handler.
 */
export interface StageHandler {
    /** Called when entering the stage. */
    onEnter: () => void;
    /** Called when exiting the stage. */
    onExit: () => void;
}
