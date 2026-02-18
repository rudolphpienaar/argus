/**
 * @file Gather Stage Runtime State
 *
 * Typed mutable state container for Gather-stage orchestration.
 *
 * Responsibilities:
 * - Hold Gather-stage runtime state that spans multiple handlers
 *   (overlay controllers, workspace expansion, gather cache).
 * - Provide a single import point for stateful collaborators so state flow
 *   is explicit and discoverable.
 *
 * Non-responsibilities:
 * - DOM rendering and event registration.
 * - Business decisions (stage transitions, VFS mutations).
 *
 * @module core/stages/gather/runtime/state
 */

import type { Dataset, Project } from '../../../models/types.js';
import type { FileNode as VcsFileNode } from '../../../../vfs/types.js';
import type { FileBrowser } from '../../../../ui/components/FileBrowser.js';

/**
 * Gathered dataset payload used by Gather-stage overlay and workspace logic.
 */
export interface GatheredEntry {
    dataset: Dataset;
    selectedPaths: string[];
    subtree: VcsFileNode;
}

/**
 * Stateful Gather-stage runtime container.
 */
export interface GatherStageState {
    detailBrowser: FileBrowser | null;
    isWorkspaceExpanded: boolean;
    workspaceProjectBase: string;
    workspaceDragCleanup: (() => void) | null;
    browserDragCleanup: (() => void) | null;
    gatherTargetProject: Project | null;
    gatheredDatasets: Map<string, GatheredEntry>;
    datasetBrowser: FileBrowser | null;
    activeDetailDataset: Dataset | null;
}

/**
 * Singleton Gather-stage runtime state.
 */
export const gatherStage_state: GatherStageState = {
    detailBrowser: null,
    isWorkspaceExpanded: false,
    workspaceProjectBase: '',
    workspaceDragCleanup: null,
    browserDragCleanup: null,
    gatherTargetProject: null,
    gatheredDatasets: new Map<string, GatheredEntry>(),
    datasetBrowser: null,
    activeDetailDataset: null,
};
