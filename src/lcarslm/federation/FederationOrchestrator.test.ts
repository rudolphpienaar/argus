import { describe, it, expect } from 'vitest';
import { FederationOrchestrator } from './FederationOrchestrator.js';
import { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import type { CalypsoStoreActions, CalypsoResponse } from '../types.js';
import { CalypsoStatusCode } from '../types.js';
import type { AppState, Dataset, FederationState, Project } from '../../core/models/types.js';

interface OrchestratorFixture {
    orchestrator: FederationOrchestrator;
    vfs: VirtualFileSystem;
    storeActions: CalypsoStoreActions;
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
        }
    };
}

function fixture_create(): OrchestratorFixture {
    const vfs: VirtualFileSystem = new VirtualFileSystem('tester');
    const storeActions: CalypsoStoreActions = storeActions_create();
    const orchestrator: FederationOrchestrator = new FederationOrchestrator(vfs, storeActions);
    return { orchestrator, vfs, storeActions };
}

describe('FederationOrchestrator', (): void => {
    it('requires an active project context', (): void => {
        const fixture: OrchestratorFixture = fixture_create();
        const response: CalypsoResponse = fixture.orchestrator.command('federate', [], 'tester');

        expect(response.statusCode).toBe(CalypsoStatusCode.ERROR);
        expect(response.message).toContain('NO ACTIVE PROJECT CONTEXT');
        expect(fixture.orchestrator.active).toBe(false);
    });

    it('initializes handshake and advances through transcompile/containerize approvals', (): void => {
        const fixture: OrchestratorFixture = fixture_create();
        fixture.storeActions.project_setActive(project_create('p-1', 'fedproj'));

        const brief: CalypsoResponse = fixture.orchestrator.command('federate', [], 'tester');
        expect(brief.statusCode).toBe(CalypsoStatusCode.OK);
        expect(fixture.orchestrator.active).toBe(true);
        expect(fixture.orchestrator.currentStep).toBe('federate-transcompile');

        const transcompileApprove: CalypsoResponse = fixture.orchestrator.command('approve', [], 'tester');
        expect(transcompileApprove.statusCode).toBe(CalypsoStatusCode.OK);
        expect(fixture.orchestrator.currentStep).toBe('federate-containerize');
        expect(
            fixture.vfs.node_stat('/home/tester/projects/fedproj/src/source-crosscompile/data/node.py')
        ).not.toBeNull();

        const dispatchTooEarly: CalypsoResponse = fixture.orchestrator.command('dispatch', [], 'tester');
        expect(dispatchTooEarly.statusCode).toBe(CalypsoStatusCode.ERROR);
        expect(dispatchTooEarly.message).toContain('Cannot dispatch yet');

        const containerApprove: CalypsoResponse = fixture.orchestrator.command('approve', [], 'tester');
        expect(containerApprove.statusCode).toBe(CalypsoStatusCode.OK);
        expect(fixture.orchestrator.currentStep).toBe('federate-publish-config');
        expect(fixture.vfs.node_stat('/home/tester/projects/fedproj/.containerized')).not.toBeNull();
    });

    it('completes publish path and clears active federation state', (): void => {
        const fixture: OrchestratorFixture = fixture_create();
        fixture.storeActions.project_setActive(project_create('p-2', 'fedproj2'));

        fixture.orchestrator.command('federate', [], 'tester');    // -> transcompile
        fixture.orchestrator.command('approve', [], 'tester');     // -> containerize
        fixture.orchestrator.command('approve', [], 'tester');     // -> publish-config
        fixture.orchestrator.command('config', ['name', 'atlas-fed-app'], 'tester');
        fixture.orchestrator.command('approve', [], 'tester');     // -> publish-execute
        fixture.orchestrator.command('approve', [], 'tester');     // -> dispatch
        const dispatch: CalypsoResponse = fixture.orchestrator.command('dispatch', [], 'tester'); // -> execute
        expect(dispatch.statusCode).toBe(CalypsoStatusCode.OK);
        expect(fixture.orchestrator.currentStep).toBe('federate-execute');

        const publish: CalypsoResponse = fixture.orchestrator.command('publish', ['model'], 'tester');
        expect(publish.statusCode).toBe(CalypsoStatusCode.OK);
        expect(publish.message).toContain('FEDERATION COMPLETE');
        expect(fixture.vfs.node_stat('/home/tester/projects/fedproj2/.federated')).not.toBeNull();
        expect(fixture.orchestrator.active).toBe(false);
        expect(fixture.orchestrator.currentStep).toBeNull();
    });
});
