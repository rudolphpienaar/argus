/**
 * @file Gather → Process Transition Orchestrator
 *
 * Encapsulates decision logic for advancing from Gather into Process.
 *
 * Responsibilities:
 * - Validate active project context before transition.
 * - Gate transitions for draft naming and heterogeneity warnings.
 * - Route to project activation or initialization flow.
 *
 * @module core/stages/gather/actions/proceed
 */

import { store } from '../../../state/store.js';
import { gatherStage_state } from '../runtime/state.js';
import { project_activate } from './projects.js';

/**
 * Callback dependencies owned by Gather-stage orchestration.
 */
export interface ProceedToCodeDeps {
    projectDetail_open(projectId: string): void;
    workspace_interactInitialize(projectId: string): void;
}

/**
 * Advance from Gather toward Process while enforcing readiness gates.
 */
export async function proceedToCode_execute(deps: ProceedToCodeDeps): Promise<void> {
    if (!gatherStage_state.gatherTargetProject) {
        if (store.globals.terminal) {
            store.globals.terminal.println('<span class="warn">● WARNING: NO ACTIVE PROJECT CONTEXT.</span>');
            store.globals.terminal.println('○ SELECT AN EXISTING PROJECT OR CLICK "+ NEW" BEFORE PROCEEDING TO CODE.');
        }
        return;
    }

    const activeProject = gatherStage_state.gatherTargetProject;
    const isDraft: boolean = activeProject.name.startsWith('DRAFT-');

    if (isDraft && store.globals.terminal) {
        store.globals.terminal.println('<span class="warn">● DRAFT STATUS DETECTED.</span>');
        store.globals.terminal.println('○ BEFORE PROCEEDING, CONSIDER GIVING THIS COHORT A DESCRIPTIVE NAME.');
        store.globals.terminal.println('○ CLICK "RENAME" IN THE PROJECT DETAIL OR USE THE AI COMMAND.');

        setTimeout((): void => {
            deps.projectDetail_open(activeProject.id);
            setTimeout((): void => {
                deps.workspace_interactInitialize(activeProject.id);
            }, 100);
        }, 2000);
        return;
    }

    const username: string = store.globals.shell?.env_get('USER') || 'user';
    const projectBase: string = `/home/${username}/projects/${activeProject.name}`;

    if (store.globals.terminal) {
        try {
            const { cohort_validate } = await import('../../../analysis/CohortProfiler.js');
            const validation = cohort_validate(store.globals.vcs, `${projectBase}/input`);

            if (validation.isMixedModality) {
                store.globals.terminal.println('<span class="error">● WARNING: MIXED MODALITIES DETECTED.</span>');
                store.globals.terminal.println('<span class="warn">○ THIS COHORT CONTAINS INCOMPATIBLE DATA TYPES (NON-IID).</span>');
                store.globals.terminal.println('○ FEDERATED TRAINING MAY DIVERGE. REVIEW COHORT VIA "analyze cohort".');
                await new Promise<void>((resolve: () => void): void => {
                    setTimeout(resolve, 3000);
                });
            }
        } catch {
            // Ignore cohort-analysis failures during transition.
        }
    }

    if (store.globals.vcs.node_stat(`${projectBase}/src`)) {
        project_activate(activeProject.id);
        return;
    }

    deps.projectDetail_open(activeProject.id);
    setTimeout((): void => {
        deps.workspace_interactInitialize(activeProject.id);
    }, 100);
}
