/**
 * @file Browser Adapter for CalypsoCore
 *
 * Applies CalypsoResponse actions to the browser UI/state layer.
 * Message rendering stays with the terminal command router.
 *
 * @module
 */

import type { CalypsoAction, CalypsoResponse } from '../types.js';
import { store } from '../../core/state/store.js';
import { stage_advanceTo } from '../../core/logic/navigation.js';
import {
    workspace_render,
    dataset_select,
    dataset_deselect,
    datasetDetail_open,
    project_activate
} from '../../core/stages/search.js';
import { training_launch } from '../../core/stages/process.js';

/**
 * Browser adapter that executes response actions against ARGUS modules.
 */
export class BrowserAdapter {
    /**
     * Apply all response actions in order.
     *
     * @param response - Calypso response.
     */
    public response_apply(response: CalypsoResponse): void {
        for (const action of response.actions) {
            this.action_apply(action);
        }
    }

    /**
     * Apply a single action.
     *
     * @param action - Calypso action.
     */
    private action_apply(action: CalypsoAction): void {
        switch (action.type) {
            case 'workspace_render':
                workspace_render(action.datasets, true);
                return;

            case 'dataset_select':
                dataset_select(action.id, true);
                return;

            case 'dataset_deselect':
                dataset_deselect(action.id, true);
                return;

            case 'dataset_open':
                datasetDetail_open(action.id);
                return;

            case 'project_open':
                project_activate(action.id);
                return;

            case 'stage_advance':
                stage_advanceTo(action.stage);
                return;

            case 'federation_start':
                training_launch();
                return;

            case 'marketplace_open':
                store.marketplace_toggle(true);
                return;

            case 'marketplace_close':
                store.marketplace_toggle(false);
                return;

            // Side effects are already performed in CalypsoCore for these;
            // browser path currently requires no additional UI operation.
            case 'overlay_close':
            case 'project_create':
            case 'project_rename':
                return;
        }
    }
}

/** Singleton browser adapter. */
export const browserAdapter: BrowserAdapter = new BrowserAdapter();

