import { describe, it, expect, beforeEach } from 'vitest';
import { IntentParser } from './IntentParser.js';
import { IntentGuard, IntentGuardMode } from './IntentGuard.js';
import { SearchProvider } from '../SearchProvider.js';
import { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import { Shell } from '../../vfs/Shell.js';
import type { CalypsoStoreActions, QueryResponse } from '../types.js';
import type { AppState, Dataset, Project } from '../../core/models/types.js';
import { LCARSEngine } from '../engine.js';
import { DATASETS } from '../../core/data/datasets.js';

function storeActions_create(): CalypsoStoreActions {
    let state: Partial<AppState> = {
        activeProject: null,
        lastMentionedDatasets: []
    };

    return {
        state_get(): Partial<AppState> {
            return state;
        },
        state_set(nextState: Partial<AppState>): void {
            Object.assign(state, nextState);
        },
        reset(): void {
            state = { activeProject: null, lastMentionedDatasets: [] };
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
        sessionId_get(): string | null {
            return (state as any).currentSessionId || null;
        },
        session_start(): void {
            (state as any).currentSessionId = 'sess-new';
        },
        dataset_getById(id: string): Dataset | undefined {
            return DATASETS.find(ds => ds.id === id);
        },
        lastMentioned_set(datasets: Dataset[]): void {
            state.lastMentionedDatasets = datasets;
        },
        lastMentioned_get(): Dataset[] {
            return state.lastMentionedDatasets || [];
        }
    };
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

describe('Anaphora Resolution (Compiler Layer)', (): void => {
    let store: CalypsoStoreActions;
    let parser: IntentParser;
    let searchProvider: SearchProvider;

    beforeEach((): void => {
        const vfs: VirtualFileSystem = new VirtualFileSystem('tester');
        const shell: Shell = new Shell(vfs, 'tester');
        store = storeActions_create();
        searchProvider = new SearchProvider(vfs, shell, store);
        const guard = new IntentGuard({ mode: IntentGuardMode.EXPERIMENTAL });
        parser = new IntentParser(searchProvider, store, guard, {
            activeStageId_get: () => null,
            stage_forCommand: () => null,
            commands_list: () => ['search', 'add', 'gather', 'rename', 'harmonize', 'proceed'],
            systemCommands_list: () => [],
            readyCommands_list: () => []
        });
    });

    it('resolves "this" to the last mentioned dataset ID', async (): Promise<void> => {
        // 1. Setup: User just searched and saw ds-001
        const dataset = DATASETS[0]; // ds-001
        store.lastMentioned_set([dataset]);

        // 2. Act: User says "gather this"
        const model: LCARSEngine = modelStub_create(
            '{"type":"workflow","command":"gather","args":["this"]}'
        );
        const intent = await parser.intent_resolve('gather this', model);

        // 3. Assert: The "it" (IntentParser) resolved "this" -> "ds-001"
        expect(intent.type).toBe('workflow');
        expect(intent.command).toBe('gather');
        expect(intent.args).toEqual([dataset.id]); 
        expect(intent.args).not.toContain('this');
    });

    it('resolves "them" to all last mentioned dataset IDs', async (): Promise<void> => {
        // 1. Setup: User saw multiple datasets
        const datasets = [DATASETS[0], DATASETS[1]]; 
        store.lastMentioned_set(datasets);

        // 2. Act: User says "add them"
        const model: LCARSEngine = modelStub_create(
            '{"type":"workflow","command":"add","args":["them"]}'
        );
        const intent = await parser.intent_resolve('add them', model);

        // 3. Assert: Resolved to multiple IDs
        expect(intent.args).toEqual(datasets.map(d => d.id));
        expect(intent.args).not.toContain('them');
    });
});
