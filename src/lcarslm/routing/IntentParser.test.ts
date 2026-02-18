import { describe, it, expect } from 'vitest';
import { IntentParser } from './IntentParser.js';
import { SearchProvider } from '../SearchProvider.js';
import { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import { Shell } from '../../vfs/Shell.js';
import type { CalypsoStoreActions, CalypsoAction, QueryResponse } from '../types.js';
import type { AppState, Dataset, FederationState, Project } from '../../core/models/types.js';
import { LCARSEngine } from '../engine.js';

function storeActions_create(activeProject: { id: string; name: string } | null): CalypsoStoreActions {
    const state: Partial<AppState> = {
        activeProject: activeProject
            ? {
                id: activeProject.id,
                name: activeProject.name,
                description: '',
                created: new Date(),
                lastModified: new Date(),
                datasets: []
            }
            : null
    };

    return {
        state_get(): Partial<AppState> {
            return state;
        },
        state_set(nextState: Partial<AppState>): void {
            Object.assign(state, nextState);
        },
        reset(): void {
            state.activeProject = null;
        },
        dataset_select(): void {},
        dataset_deselect(): void {},
        datasets_getSelected(): Dataset[] {
            return [];
        },
        project_getActive(): { id: string; name: string; } | null {
            const active: Project | null | undefined = state.activeProject;
            return active ? { id: active.id, name: active.name } : null;
        },
        project_getActiveFull(): Project | null {
            return state.activeProject ?? null;
        },
        project_setActive(project: Project): void {
            state.activeProject = project;
        },
        stage_set(): void {},
        session_getPath(): string | null {
            return null;
        },
        session_setPath(): void {},
        federation_getState(): FederationState | null {
            return null;
        },
        federation_setState(): void {}
    };
}

function parser_create(activeProject: { id: string; name: string } | null = null): IntentParser {
    const vfs: VirtualFileSystem = new VirtualFileSystem('tester');
    const shell: Shell = new Shell(vfs, 'tester');
    const searchProvider: SearchProvider = new SearchProvider(vfs, shell);
    return new IntentParser(searchProvider, storeActions_create(activeProject));
}

function modelStub_create(answer: string): LCARSEngine {
    const modelStub: Pick<LCARSEngine, 'query'> = {
        async query(): Promise<QueryResponse> {
            return {
                answer,
                relevantDatasets: []
            };
        }
    };
    return modelStub as LCARSEngine;
}

describe('IntentParser', (): void => {
    it('resolves deterministic rename commands without model assistance', async (): Promise<void> => {
        const parser: IntentParser = parser_create();
        const intent = await parser.intent_resolve('rename to New-Project');

        expect(intent.type).toBe('workflow');
        expect(intent.command).toBe('rename');
        expect(intent.args).toEqual(['new-project']);
        expect(intent.isModelResolved).toBe(false);
    });

    it('compiles model-resolved workflow intents from JSON payloads', async (): Promise<void> => {
        const parser: IntentParser = parser_create();
        const model: LCARSEngine = modelStub_create(
            '{"type":"workflow","command":"search","args":["histology"]}'
        );
        const intent = await parser.intent_resolve('find me histology cohorts please', model);

        expect(intent.type).toBe('workflow');
        expect(intent.command).toBe('search');
        expect(intent.args).toEqual(['histology']);
        expect(intent.isModelResolved).toBe(true);
    });

    it('falls back to llm intent when model payload is invalid', async (): Promise<void> => {
        const parser: IntentParser = parser_create();
        const model: LCARSEngine = modelStub_create('not json at all');
        const intent = await parser.intent_resolve('do something odd', model);

        expect(intent.type).toBe('llm');
        expect(intent.isModelResolved).toBe(true);
    });

    it('extracts deterministic actions from LLM tags and cleans response text', (): void => {
        const parser: IntentParser = parser_create({ id: 'p-01', name: 'demo-project' });
        const llmText: string = [
            '[SELECT: ds-001]',
            '[ACTION: SHOW_DATASETS]',
            '[FILTER: ds-001]',
            '[ACTION: RENAME project-v2]',
            '[ACTION: PROCEED fedml]',
            'Proceeding with selected dataset.'
        ].join(' ');

        const extracted: { actions: CalypsoAction[]; cleanText: string; } = parser.actions_extractFromLLM(llmText);

        const selectAction: CalypsoAction | undefined = extracted.actions.find(
            (action: CalypsoAction): boolean => action.type === 'dataset_select'
        );
        const workspaceAction: CalypsoAction | undefined = extracted.actions.find(
            (action: CalypsoAction): boolean => action.type === 'workspace_render'
        );
        const renameAction: CalypsoAction | undefined = extracted.actions.find(
            (action: CalypsoAction): boolean => action.type === 'project_rename'
        );
        const proceedAction: CalypsoAction | undefined = extracted.actions.find(
            (action: CalypsoAction): boolean =>
                action.type === 'stage_advance' && action.stage === 'process'
        );

        expect(selectAction).toBeDefined();
        expect(workspaceAction).toBeDefined();
        expect(renameAction).toBeDefined();
        expect(proceedAction).toBeDefined();
        expect(extracted.cleanText).toContain('Proceeding with selected dataset.');
        expect(extracted.cleanText).not.toContain('[ACTION:');
        expect(extracted.cleanText).not.toContain('[SELECT:');
    });
});
