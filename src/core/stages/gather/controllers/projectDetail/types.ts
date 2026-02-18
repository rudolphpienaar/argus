/**
 * @file Project Detail Controller Types
 *
 * Shared contracts for Gather-stage project detail modules.
 *
 * @module core/stages/gather/controllers/projectDetail/types
 */

/**
 * Dependencies provided by Gather-stage orchestration.
 */
export interface ProjectDetailDeps {
    projectStrip_render(): void;
}

/**
 * Sidebar tab descriptor for project detail browser.
 */
export interface ProjectDetailTab {
    id: string;
    label: string;
    shade: number;
}
