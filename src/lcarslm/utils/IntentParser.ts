/**
 * @file Intent Parser
 *
 * Extracts structured intents from LLM natural language responses.
 *
 * @module lcarslm/utils/intent
 */

import type { CalypsoAction } from '../types.js';
import type { SearchProvider } from '../SearchProvider.js';
import type { CalypsoStoreActions } from '../types.js';
import type { Project } from '../../core/models/types.js';
import { MOCK_PROJECTS } from '../../core/data/projects.js';
import { project_rename, project_harmonize } from '../../core/logic/ProjectManager.js';

export class IntentParser {
    constructor(
        private searchProvider: SearchProvider,
        private storeActions: CalypsoStoreActions
    ) {}

    /**
     * Parse LLM response text and extract actions.
     * Side effects:
     * - Updates search context from text
     * - Executes deterministic mutations (rename, harmonize) for headless VFS
     */
    public parse(text: string): { actions: CalypsoAction[], cleanText: string } {
        const actions: CalypsoAction[] = [];

        // 1. Update conversation context (side effect)
        this.searchProvider.context_updateFromText(text);

        // 2. Extract [SELECT: ds-xxx]
        const selectMatches = Array.from(text.matchAll(/\[SELECT: (ds-[0-9]+)\]/g));
        for (const match of selectMatches) {
            actions.push({ type: 'dataset_select', id: match[1] });
        }

        // 3. Extract [ACTION: PROCEED]
        const proceedMatch = text.match(/\[ACTION: PROCEED(?:\s+(fedml|chris))?\]/i);
        if (proceedMatch) {
            actions.push({
                type: 'stage_advance',
                stage: 'process',
                workflow: proceedMatch[1] as any
            });
        }

        // 4. Extract [ACTION: SHOW_DATASETS]
        if (text.includes('[ACTION: SHOW_DATASETS]')) {
            let datasetsToShow = [...this.searchProvider.lastMentioned_get()];
            const filterMatch = text.match(/\[FILTER: (.*?)\]/);
            if (filterMatch) {
                const ids = filterMatch[1].split(',').map(s => s.trim());
                datasetsToShow = datasetsToShow.filter(ds => ids.includes(ds.id));
            }
            actions.push({ type: 'workspace_render', datasets: datasetsToShow });
        }

        // 5. Extract [ACTION: RENAME xxx]
        const renameMatch = text.match(/\[ACTION: RENAME (.*?)\]/);
        if (renameMatch) {
            const newName = renameMatch[1].trim();
            const activeMeta = this.storeActions.project_getActive();
            if (activeMeta) {
                const project = MOCK_PROJECTS.find(p => p.id === activeMeta.id);
                if (project) {
                    // Side effect: update VFS
                    project_rename(project, newName);
                }
                actions.push({ type: 'project_rename', id: activeMeta.id, newName });
            }
        }

        // 6. Extract [ACTION: HARMONIZE]
        if (text.includes('[ACTION: HARMONIZE]')) {
            const activeMeta = this.storeActions.project_getActive();
            if (activeMeta) {
                const project = MOCK_PROJECTS.find(p => p.id === activeMeta.id);
                if (project) {
                    // Side effect: update VFS
                    project_harmonize(project);
                    // Special marker handled by caller
                }
            }
        }

        // 7. Clean up text
        const cleanText = text
            .replace(/\[SELECT: ds-[0-9]+\]/g, '')
            .replace(/\[ACTION: PROCEED(?:\s+(?:fedml|chris))?\]/gi, '')
            .replace(/\[ACTION: SHOW_DATASETS\]/g, '')
            .replace(/\[FILTER:.*?\]/g, '')
            .replace(/\[ACTION: RENAME.*?\]/g, '')
            .replace(/\[ACTION: HARMONIZE\]/g, '')
            .trim();

        return { actions, cleanText };
    }
}
