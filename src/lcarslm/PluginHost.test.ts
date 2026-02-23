/**
 * @file PluginHost Unit Tests
 *
 * Validates plugin handler boundary behavior and typed execution.
 */

import { describe, it, expect } from 'vitest';
import type { Dataset, AppState, Project } from '../core/models/types.js';
import { DATASETS } from '../core/data/datasets.js';
import { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import { Shell } from '../vfs/Shell.js';
import { PluginHost } from './PluginHost.js';
import { TelemetryBus } from './TelemetryBus.js';
import { SearchProvider } from './SearchProvider.js';
import { WorkflowAdapter } from '../dag/bridge/WorkflowAdapter.js';
import type { CalypsoStoreActions, PluginResult } from './types.js';
import { CalypsoStatusCode } from './types.js';

interface StoreFixture {
    actions: CalypsoStoreActions;
}

function storeFixture_create(): StoreFixture {
    const state: Partial<AppState> = {
        currentPersona: 'fedml',
        currentSessionId: 'sess-test',
        selectedDatasets: [],
        currentStage: 'search',
        activeProject: null,
    };
    let sessionPath: string | null = null;

    const actions: CalypsoStoreActions = {
        state_get(): Partial<AppState> {
            return state;
        },

        state_set(nextState: Partial<AppState>): void {
            Object.assign(state, nextState);
        },

        reset(): void {
            state.selectedDatasets = [];
            state.activeProject = null;
            sessionPath = null;
        },

        sessionId_get(): string | null {
            return state.currentSessionId || null;
        },

        session_start(): void {
            state.currentSessionId = 'sess-new';
        },

        dataset_select(dataset: Dataset): void {
            const selected: Dataset[] = state.selectedDatasets ?? [];
            const alreadySelected: boolean = selected.some((item: Dataset): boolean => item.id === dataset.id);
            if (!alreadySelected) {
                selected.push(dataset);
            }
            state.selectedDatasets = selected;
        },

        dataset_deselect(id: string): void {
            const selected: Dataset[] = state.selectedDatasets ?? [];
            state.selectedDatasets = selected.filter((item: Dataset): boolean => item.id !== id);
        },

        dataset_getById(id: string): Dataset | undefined {
            return DATASETS.find(ds => ds.id === id);
        },

        datasets_getSelected(): Dataset[] {
            return state.selectedDatasets ?? [];
        },

        project_getActive(): { id: string; name: string; } | null {
            const active = state.activeProject;
            if (!active) {
                return null;
            }
            return { id: active.id, name: active.name };
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

        lastMentioned_set(datasets: Dataset[]): void {
            state.lastMentionedDatasets = datasets;
        },

        lastMentioned_get(): Dataset[] {
            return state.lastMentionedDatasets || [];
        },
    };

    return { actions };
}

describe('PluginHost', (): void => {
    it('rejects unknown plugin handlers', async (): Promise<void> => {
        const fixture: StoreFixture = storeFixture_create();
        const vfs: VirtualFileSystem = new VirtualFileSystem('tester');
        const shell: Shell = new Shell(vfs, 'tester');
        const search: SearchProvider = new SearchProvider(vfs, shell, fixture.actions);
        const telemetryBus: TelemetryBus = new TelemetryBus();
        const adapter = WorkflowAdapter.definition_load('fedml');
        const host: PluginHost = new PluginHost(vfs, shell, fixture.actions, search, telemetryBus, adapter, '/tmp');

        const result: PluginResult = await host.plugin_execute(
            '../search',
            {},
            'search',
            ['ct'],
            '/tmp/test-data',
            'search'
        );

        expect(result.statusCode).toBe(CalypsoStatusCode.ERROR);
        expect(result.message).toContain("Unknown plugin handler '../search'");
    });

    it('executes known handlers through dynamic handler module resolution', async (): Promise<void> => {
        const fixture: StoreFixture = storeFixture_create();
        const vfs: VirtualFileSystem = new VirtualFileSystem('tester');
        const shell: Shell = new Shell(vfs, 'tester');
        const search: SearchProvider = new SearchProvider(vfs, shell, fixture.actions);
        const telemetryBus: TelemetryBus = new TelemetryBus();
        const adapter = WorkflowAdapter.definition_load('fedml');
        const host: PluginHost = new PluginHost(vfs, shell, fixture.actions, search, telemetryBus, adapter, '/tmp');

        const result: PluginResult = await host.plugin_execute(
            'search',
            { query: 'ct' },
            'search',
            [],
            '/tmp/test-data',
            'search'
        );

        expect(result.statusCode).toBe(CalypsoStatusCode.OK);
        expect(result.message).not.toContain('PLUGIN EXECUTION FAILED');
    });
});
