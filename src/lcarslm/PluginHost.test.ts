/**
 * @file PluginHost Unit Tests
 *
 * Validates plugin handler boundary behavior and typed execution.
 */

import { describe, it, expect } from 'vitest';
import type { Dataset, AppState, FederationState, Project } from '../core/models/types.js';
import { DATASETS } from '../core/data/datasets.js';
import { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import { Shell } from '../vfs/Shell.js';
import { FederationOrchestrator } from './federation/FederationOrchestrator.js';
import { PluginHost } from './PluginHost.js';
import { TelemetryBus } from './TelemetryBus.js';
import type { CalypsoStoreActions, PluginResult } from './types.js';
import { CalypsoStatusCode } from './types.js';

interface StoreFixture {
    actions: CalypsoStoreActions;
}

function storeFixture_create(): StoreFixture {
    const state: Partial<AppState> = {
        selectedDatasets: [],
        currentStage: 'search',
        activeProject: null,
        federationState: null,
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
            state.federationState = null;
            sessionPath = null;
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

        federation_getState(): FederationState | null {
            return state.federationState ?? null;
        },

        federation_setState(nextState: FederationState | null): void {
            state.federationState = nextState;
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
        const federation: FederationOrchestrator = new FederationOrchestrator(vfs, fixture.actions);
        const telemetryBus: TelemetryBus = new TelemetryBus();
        const host: PluginHost = new PluginHost(vfs, shell, fixture.actions, federation, telemetryBus);

        const result: PluginResult = await host.plugin_execute(
            '../search',
            {},
            'search',
            ['ct'],
        );

        expect(result.statusCode).toBe(CalypsoStatusCode.ERROR);
        expect(result.message).toContain("Unknown plugin handler '../search'");
    });

    it('executes known handlers through the static loader registry', async (): Promise<void> => {
        const fixture: StoreFixture = storeFixture_create();
        const vfs: VirtualFileSystem = new VirtualFileSystem('tester');
        const shell: Shell = new Shell(vfs, 'tester');
        const federation: FederationOrchestrator = new FederationOrchestrator(vfs, fixture.actions);
        const telemetryBus: TelemetryBus = new TelemetryBus();
        const host: PluginHost = new PluginHost(vfs, shell, fixture.actions, federation, telemetryBus);

        const result: PluginResult = await host.plugin_execute(
            'search',
            { query: 'ct' },
            'search',
            [],
        );

        expect(result.statusCode).toBe(CalypsoStatusCode.OK);
        expect(result.message).not.toContain('PLUGIN EXECUTION FAILED');
    });
});
