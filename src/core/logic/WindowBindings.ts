/**
 * @file Window Bindings Registry
 *
 * Centralizes all global window extensions and onclick handler assignments.
 * This module ensures type-safe exposure of internal functions to the DOM.
 *
 * @module
 */

import { store } from '../state/store.js';
import { stage_advanceTo, station_click, stage_next } from './navigation.js';
import { catalog_search, dataset_toggle, lcarslm_auth, lcarslm_reset, lcarslm_simulate, project_activate, projectDetail_open, datasetDetail_open, proceedToCode_handle, template_select, dataset_add } from '../stages/search.js';
import { filePreview_show } from '../stages/gather.js';
import { training_launch, terminal_toggle, ide_openFile } from '../stages/process.js';
import { training_abort } from '../stages/monitor.js';
import { model_publish } from '../stages/post.js';
import { persona_switch, user_authenticate, user_logout, role_select } from '../stages/login.js';

/**
 * Interface extension for the global Window object.
 * Defines the signature of every internal function exposed to the DOM.
 */
declare global {
    interface Window {
        stage_advanceTo: typeof stage_advanceTo;
        station_click: typeof station_click;
        stage_next: typeof stage_next;
        catalog_search: typeof catalog_search;
        dataset_toggle: typeof dataset_toggle;
        filePreview_show: typeof filePreview_show;
        training_launch: typeof training_launch;
        training_abort: typeof training_abort;
        model_publish: typeof model_publish;
        persona_switch: typeof persona_switch;
        ui_toggleTopFrame: (event: Event) => void;
        user_authenticate: typeof user_authenticate;
        user_logout: typeof user_logout;
        role_select: typeof role_select;
        lcarslm_auth: typeof lcarslm_auth;
        lcarslm_reset: typeof lcarslm_reset;
        lcarslm_simulate: typeof lcarslm_simulate;
        terminal_toggle: typeof terminal_toggle;
        project_activate: typeof project_activate;
        projectDetail_open: typeof projectDetail_open;
        datasetDetail_open: typeof datasetDetail_open;
        dataset_add: typeof dataset_add;
        proceedToCode_handle: typeof proceedToCode_handle;
        template_select: typeof template_select;
        ide_openFile: typeof ide_openFile;
        store: typeof store;
    }
}

/**
 * Registers all window-level function bindings for HTML onclick handlers.
 *
 * @param uiHandlers - Object containing UI-specific handlers from the main entry point.
 */
export function windowBindings_initialize(uiHandlers: {
    ui_toggleTopFrame: (event: Event) => void;
}): void {
    window.stage_advanceTo = stage_advanceTo;
    window.station_click = station_click;
    window.stage_next = stage_next;
    window.catalog_search = catalog_search;
    window.dataset_toggle = dataset_toggle;
    window.filePreview_show = filePreview_show;
    window.training_launch = training_launch;
    window.training_abort = training_abort;
    window.model_publish = model_publish;
    window.persona_switch = persona_switch;
    window.ui_toggleTopFrame = uiHandlers.ui_toggleTopFrame;
    window.user_authenticate = user_authenticate;
    window.user_logout = user_logout;
    window.role_select = role_select;
    window.lcarslm_auth = lcarslm_auth;
    window.lcarslm_reset = lcarslm_reset;
    window.lcarslm_simulate = lcarslm_simulate;
    window.terminal_toggle = terminal_toggle;
    window.project_activate = project_activate;
    window.projectDetail_open = projectDetail_open;
    window.datasetDetail_open = datasetDetail_open;
    window.dataset_add = dataset_add;
    window.proceedToCode_handle = proceedToCode_handle;
    window.template_select = template_select;
    window.ide_openFile = ide_openFile;
    window.store = store;
}
