import { describe, it, expect } from 'vitest';
import { FederationOrchestrator } from './FederationOrchestrator.js';
import { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import type { CalypsoStoreActions, CalypsoResponse, PluginTelemetry } from '../types.js';
import { CalypsoStatusCode } from '../types.js';
import type { AppState, Dataset, FederationState, Project } from '../../core/models/types.js';
import { DATASETS } from '../../core/data/datasets.js';

interface OrchestratorFixture {
    orchestrator: FederationOrchestrator;
    vfs: VirtualFileSystem;
    storeActions: CalypsoStoreActions;
    ui: PluginTelemetry;
    sleep: (ms: number) => Promise<void>;
}

function project_create(id: string, name: string): Project {
    return {
        id,
        name,
        description: 'test project',
        created: new Date(),
        lastModified: new Date(),
        datasets: []
    };
}

function storeActions_create(): CalypsoStoreActions {
    const state: Partial<AppState> = {
        activeProject: null,
        federationState: null,
        selectedDatasets: [],
        currentStage: 'process'
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
            state.activeProject = null;
            state.federationState = null;
            state.selectedDatasets = [];
            sessionPath = null;
        },
        dataset_select(dataset: Dataset): void {
            const selected: Dataset[] = state.selectedDatasets ?? [];
            selected.push(dataset);
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

function fixture_create(): OrchestratorFixture {
    const vfs: VirtualFileSystem = new VirtualFileSystem('tester');
    const storeActions: CalypsoStoreActions = storeActions_create();
    const orchestrator: FederationOrchestrator = new FederationOrchestrator(vfs, storeActions);
    const ui: PluginTelemetry = {
        log: () => {},
        progress: () => {},
        frame_open: () => {},
        frame_close: () => {},
        phase_start: () => {},
        status: () => {}
    };
    const sleep = async () => {};
    return { orchestrator, vfs, storeActions, ui, sleep };
}

describe('FederationOrchestrator', (): void => {
    it('requires an active project context', async (): Promise<void> => {
        const fixture: OrchestratorFixture = fixture_create();
        const response: CalypsoResponse = await fixture.orchestrator.command('federate', [], 'tester', fixture.ui, fixture.sleep);

        expect(response.statusCode).toBe(CalypsoStatusCode.ERROR);
        expect(response.message).toContain('NO ACTIVE PROJECT CONTEXT');
        expect(fixture.orchestrator.active).toBe(false);
    });

    it('initializes handshake and advances through transcompile/containerize approvals', async (): Promise<void> => {
        const fixture: OrchestratorFixture = fixture_create();
        fixture.storeActions.project_setActive(project_create('p-1', 'fedproj'));

        const brief: CalypsoResponse = await fixture.orchestrator.command('federate', [], 'tester', fixture.ui, fixture.sleep);
        expect(brief.statusCode).toBe(CalypsoStatusCode.OK);
        expect(fixture.orchestrator.active).toBe(true);
        expect(fixture.orchestrator.currentStep).toBe('federate-transcompile');

        const transcompileApprove: CalypsoResponse = await fixture.orchestrator.command('approve', [], 'tester', fixture.ui, fixture.sleep);
        expect(transcompileApprove.statusCode).toBe(CalypsoStatusCode.OK);
        expect(fixture.orchestrator.currentStep).toBe('federate-containerize');
        expect(
            fixture.vfs.node_stat('/home/tester/projects/fedproj/src/source-crosscompile/data/node.py')
        ).not.toBeNull();

        const dispatchTooEarly: CalypsoResponse = await fixture.orchestrator.command('dispatch', [], 'tester', fixture.ui, fixture.sleep);
        expect(dispatchTooEarly.statusCode).toBe(CalypsoStatusCode.ERROR);
        expect(dispatchTooEarly.message).toContain('Cannot dispatch yet');

        const containerApprove: CalypsoResponse = await fixture.orchestrator.command('approve', [], 'tester', fixture.ui, fixture.sleep);
        expect(containerApprove.statusCode).toBe(CalypsoStatusCode.OK);
        expect(fixture.orchestrator.currentStep).toBe('federate-publish-config');
        // Verify container data exists instead of legacy marker
        expect(
            fixture.vfs.node_stat('/home/tester/projects/fedproj/src/source-crosscompile/containerize/data/Dockerfile')
        ).not.toBeNull();
    });

    it('completes publish path and clears active federation state', async (): Promise<void> => {
        const fixture: OrchestratorFixture = fixture_create();
        fixture.storeActions.project_setActive(project_create('p-2', 'fedproj2'));

        await fixture.orchestrator.command('federate', [], 'tester', fixture.ui, fixture.sleep);    // -> transcompile
        await fixture.orchestrator.command('approve', [], 'tester', fixture.ui, fixture.sleep);     // -> containerize
        await fixture.orchestrator.command('approve', [], 'tester', fixture.ui, fixture.sleep);     // -> publish-config
        await fixture.orchestrator.command('config', ['name', 'atlas-fed-app'], 'tester', fixture.ui, fixture.sleep);
        await fixture.orchestrator.command('approve', [], 'tester', fixture.ui, fixture.sleep);     // -> publish-execute
        await fixture.orchestrator.command('approve', [], 'tester', fixture.ui, fixture.sleep);     // -> dispatch
        const dispatch: CalypsoResponse = await fixture.orchestrator.command('dispatch', [], 'tester', fixture.ui, fixture.sleep); // -> execute
        expect(dispatch.statusCode).toBe(CalypsoStatusCode.OK);
        expect(fixture.orchestrator.currentStep).toBe('federate-execute');

        const publish: CalypsoResponse = await fixture.orchestrator.command('publish', ['model'], 'tester', fixture.ui, fixture.sleep);
        expect(publish.statusCode).toBe(CalypsoStatusCode.OK);
        expect(publish.message).toContain('FEDERATION COMPLETE');
        
        expect(fixture.orchestrator.active).toBe(false);
        expect(fixture.orchestrator.currentStep).toBeNull();
    });
});
