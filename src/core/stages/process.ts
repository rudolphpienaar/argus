/**
 * @file Process Stage Composition Root
 *
 * Public API facade for SeaGaP Process-stage orchestration.
 * Keeps stage exports stable while implementation is split into
 * focused modules (`lifecycle`, `ide`, `federation`, `terminal`).
 *
 * @module core/stages/process
 */

export { stage_enter, stage_exit } from './process/lifecycle.js';
export { terminal_toggle } from './process/terminal.js';
export { populate_ide, ide_openFile } from './process/ide/view.js';
export { training_launch } from './process/federation/launch.js';
