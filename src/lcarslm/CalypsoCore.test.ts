import { describe, it, expect } from 'vitest';
import { CalypsoCore } from './CalypsoCore.js';
import type { CalypsoStoreActions, CalypsoResponse } from './types.js';
import { CalypsoStatusCode } from './types.js';
import { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import { Shell } from '../vfs/Shell.js';
import type { AppState, Dataset, Project } from '../core/models/types.js';
import { DATASETS } from '../core/data/datasets.js';

interface CoreFixture {
    core: CalypsoCore;
}

function storeActions_create(): CalypsoStoreActions {
    const state: Partial<AppState> = {
        currentStage: 'search',
        selectedDatasets: [],
        activeProject: null,
        lastIntent: null
    };
    let sessionPath: string | null = null;

    return {
        state_get(): Partial<AppState> {
            return state;
        },
        state_set(nextState: Partial<AppState>): void {
            Object.assign(state, nextState);
        },
        reset(): void {
            state.currentStage = 'search';
            state.selectedDatasets = [];
            state.activeProject = null;
            state.lastIntent = null;
            sessionPath = null;
        },
        dataset_select(dataset: Dataset): void {
            const selected: Dataset[] = state.selectedDatasets ?? [];
            if (!selected.some((item: Dataset): boolean => item.id === dataset.id)) {
                selected.push(dataset);
            }
            state.selectedDatasets = selected;
        },
        dataset_deselect(id: string): void {
            const selected: Dataset[] = state.selectedDatasets ?? [];
            state.selectedDatasets = selected.filter((item: Dataset): boolean => item.id !== id);
        },
        datasets_getSelected(): Dataset[] {
            return state.selectedDatasets ?? [];
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
            state.selectedDatasets = [...project.datasets];
        },
        stage_set(stage: AppState['currentStage']): void {
            state.currentStage = stage;
        },
        session_getPath(): string | null {
            return sessionPath;
        },
        session_setPath(path: string | null): void {
            sessionPath = path;
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

function fixture_create(): CoreFixture {
    const vfs: VirtualFileSystem = new VirtualFileSystem('tester');
    const shell: Shell = new Shell(vfs, 'tester');
    const storeActions: CalypsoStoreActions = storeActions_create();
    const core: CalypsoCore = new CalypsoCore(vfs, shell, storeActions);
    return { core };
}

describe('CalypsoCore', (): void => {
    it('returns OK for empty command input', async (): Promise<void> => {
        const fixture: CoreFixture = fixture_create();
        const response: CalypsoResponse = await fixture.core.command_execute('   ');

        expect(response.statusCode).toBe(CalypsoStatusCode.OK);
        expect(response.success).toBe(true);
        expect(response.message).toBe('');
    });

    it('handles special commands via fast path', async (): Promise<void> => {
        const fixture: CoreFixture = fixture_create();

        const helpResponse: CalypsoResponse = await fixture.core.command_execute('/help');
        expect(helpResponse.statusCode).toBe(CalypsoStatusCode.OK);
        expect(helpResponse.message).toContain('/status');

        const versionResponse: CalypsoResponse = await fixture.core.command_execute('/version');
        expect(versionResponse.statusCode).toBe(CalypsoStatusCode.OK);
        expect(versionResponse.message.length).toBeGreaterThan(0);
    });

    it('returns ERROR for unknown special command', async (): Promise<void> => {
        const fixture: CoreFixture = fixture_create();
        const response: CalypsoResponse = await fixture.core.command_execute('/does-not-exist');

        expect(response.statusCode).toBe(CalypsoStatusCode.ERROR);
        expect(response.success).toBe(false);
        expect(response.message).toContain('Unknown command');
    });

    it('exposes deterministic helpers for prompt, workflows, and tab completion', async (): Promise<void> => {
        const fixture: CoreFixture = fixture_create();

        expect(fixture.core.prompt_get().length).toBeGreaterThan(0);
        expect(fixture.core.workflows_available().length).toBeGreaterThan(0);

        await fixture.core.command_execute('mkdir projects');
        const completions: string[] = fixture.core.tab_complete('cd pro');
        expect(completions).toContain('projects/');
    });

    it('preserves upstream artifacts when add switches into a draft project', async (): Promise<void> => {
        const fixture: CoreFixture = fixture_create();

        const searchResponse: CalypsoResponse = await fixture.core.command_execute('search histology');
        expect(searchResponse.statusCode).toBe(CalypsoStatusCode.OK);

        const sourceSessionPath: string = fixture.core.session_getPath();
        expect(fixture.core.vfs_exists(`${sourceSessionPath}/search/data/search.json`)).toBe(true);

        const addResponse: CalypsoResponse = await fixture.core.command_execute('add ds-006');
        expect(addResponse.statusCode).toBe(CalypsoStatusCode.OK);

        const draftSessionPath: string = fixture.core.session_getPath();
        expect(draftSessionPath).not.toBe(sourceSessionPath);
        expect(fixture.core.vfs_exists(`${draftSessionPath}/search/data/search.json`)).toBe(true);
    });

    it('treats approve as stage-local affirmative continuation', async (): Promise<void> => {
        const env = globalThis as { process?: { env?: Record<string, string | undefined> } };
        const prevFast: string | undefined = env.process?.env?.CALYPSO_FAST;
        if (env.process?.env) {
            env.process.env.CALYPSO_FAST = 'true';
        }

        try {
            const fixture: CoreFixture = fixture_create();

            await fixture.core.command_execute('search histology');
            await fixture.core.command_execute('add ds-006');
            await fixture.core.command_execute('harmonize');

            const approveResponse: CalypsoResponse = await fixture.core.command_execute('approve');
            expect(approveResponse.statusCode).toBe(CalypsoStatusCode.OK);

            const sessionPath: string = fixture.core.session_getPath();
            expect(fixture.core.vfs_exists(`${sessionPath}/search/gather/harmonize/code/data/code.json`)).toBe(true);
        } finally {
            if (env.process?.env) {
                env.process.env.CALYPSO_FAST = prevFast;
            }
        }
    });
});
