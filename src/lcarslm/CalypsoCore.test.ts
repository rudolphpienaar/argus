import { describe, it, expect } from 'vitest';
import { CalypsoCore } from './CalypsoCore.js';
import type { CalypsoStoreActions, CalypsoResponse, TelemetryEvent, BootLogEvent } from './types.js';
import { CalypsoStatusCode } from './types.js';
import { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import { Shell } from '../vfs/Shell.js';
import type { AppState, Dataset, Project } from '../core/models/types.js';
import { DATASETS } from '../core/data/datasets.js';
import { SettingsService } from '../config/settings.js';

interface CoreFixture {
    core: CalypsoCore;
}

function storeActions_create(): CalypsoStoreActions {
    const state: Partial<AppState> = {
        currentPersona: 'fedml',
        currentSessionId: 'sess-test',
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
            state.currentPersona = 'fedml';
            state.currentSessionId = 'sess-test';
            state.currentStage = 'search';
            state.selectedDatasets = [];
            state.activeProject = null;
            state.lastIntent = null;
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

async function fixture_create(): Promise<CoreFixture> {
    const vfs: VirtualFileSystem = new VirtualFileSystem('tester');
    const shell: Shell = new Shell(vfs, 'tester');
    const storeActions: CalypsoStoreActions = storeActions_create();
    const core: CalypsoCore = new CalypsoCore(vfs, shell, storeActions, {
        settingsService: new SettingsService()
    });
    await core.boot();
    await core.workflow_set('fedml');
    return { core };
}

describe('CalypsoCore', (): void => {
    it('returns OK for empty command input', async (): Promise<void> => {
        const fixture: CoreFixture = await fixture_create();
        const response: CalypsoResponse = await fixture.core.command_execute('   ');

        expect(response.statusCode).toBe(CalypsoStatusCode.OK);
        expect(response.success).toBe(true);
        expect(response.message).toBe('');
    });

    it('handles special commands via fast path', async (): Promise<void> => {
        const fixture: CoreFixture = await fixture_create();

        const helpResponse: CalypsoResponse = await fixture.core.command_execute('/help');
        expect(helpResponse.statusCode).toBe(CalypsoStatusCode.OK);
        expect(helpResponse.message).toContain('/status');

        const versionResponse: CalypsoResponse = await fixture.core.command_execute('/version');
        expect(versionResponse.statusCode).toBe(CalypsoStatusCode.OK);
        expect(versionResponse.message.length).toBeGreaterThan(0);

        const dagResponse: CalypsoResponse = await fixture.core.command_execute('dag show --compact');
        expect(dagResponse.statusCode).toBe(CalypsoStatusCode.OK);
        expect(dagResponse.message).toContain('DAG [fedml]');

        const dagBoxResponse: CalypsoResponse = await fixture.core.command_execute('dag show --box');
        expect(dagBoxResponse.statusCode).toBe(CalypsoStatusCode.OK);
        expect(dagBoxResponse.message).toContain('┌');
        expect(dagBoxResponse.message).toContain('└');
        expect(dagBoxResponse.message).toContain('join_ml-readiness-gather');
    });

    it('returns ERROR for unknown special command', async (): Promise<void> => {
        const fixture: CoreFixture = await fixture_create();
        const response: CalypsoResponse = await fixture.core.command_execute('/does-not-exist');

        expect(response.statusCode).toBe(CalypsoStatusCode.ERROR);
        expect(response.success).toBe(false);
        expect(response.message).toContain('Unknown command');
    });

    it('exposes deterministic helpers for prompt, workflows, and tab completion', async (): Promise<void> => {
        const fixture: CoreFixture = await fixture_create();

        expect(fixture.core.prompt_get().length).toBeGreaterThan(0);
        expect(fixture.core.workflows_available().length).toBeGreaterThan(0);

        const commandCompletions: string[] = fixture.core.tab_complete('pw');
        expect(commandCompletions).toContain('pwd');

        await fixture.core.command_execute('mkdir projects');
        const pathCompletions: string[] = fixture.core.tab_complete('cd pro');
        expect(pathCompletions).toContain('projects/');
    });

    it('treats approve as stage-local affirmative continuation', async (): Promise<void> => {
        const env = globalThis as { process?: { env?: Record<string, string | undefined> } };
        const prevFast: string | undefined = env.process?.env?.CALYPSO_FAST;
        if (env.process?.env) {
            env.process.env.CALYPSO_FAST = 'true';
        }

        try {
            const fixture: CoreFixture = await fixture_create();

            await fixture.core.command_execute('search histology');
            await fixture.core.command_execute('add ds-006');
            await fixture.core.command_execute('gather');
            await fixture.core.command_execute('harmonize');

            const approveResponse: CalypsoResponse = await fixture.core.command_execute('approve');
            expect(approveResponse.statusCode).toBe(CalypsoStatusCode.OK);

            const sessionPath: string = fixture.core.session_getPath();
            // v12.0 Path Contract Check
            expect(fixture.core.vfs_exists(`${sessionPath}/search/gather/harmonize/meta/harmonize.json`)).toBe(true);
        } finally {
            if (env.process?.env) {
                env.process.env.CALYPSO_FAST = prevFast;
            }
        }
    });

    it('materializes gather datasets directly at stage root without training/validation wrappers', async (): Promise<void> => {
        const fixture: CoreFixture = await fixture_create();

        await fixture.core.command_execute('search histology');
        await fixture.core.command_execute('add ds-006');
        await fixture.core.command_execute('gather');

        const sessionPath: string = fixture.core.session_getPath();
        const gatherOutputDir: string = `${sessionPath}/search/gather/output`;

        expect(fixture.core.vfs_exists(`${gatherOutputDir}/Histology_Segmentation`)).toBe(true);
        expect(fixture.core.vfs_exists(`${gatherOutputDir}/training`)).toBe(false);
        expect(fixture.core.vfs_exists(`${gatherOutputDir}/validation`)).toBe(false);
    });

    it('does not globally jump on ambiguous workflow base verbs', async (): Promise<void> => {
        const fixture: CoreFixture = await fixture_create();

        const response: CalypsoResponse = await fixture.core.command_execute('show');
        expect(response.statusCode).toBe(CalypsoStatusCode.CONVERSATIONAL);
    });

    it('routes conversational workflow-graph requests deterministically to dag show', async (): Promise<void> => {
        const fixture: CoreFixture = await fixture_create();
        await fixture.core.command_execute('search histology');
        await fixture.core.command_execute('add ds-006');
        await fixture.core.command_execute('gather');

        const response: CalypsoResponse = await fixture.core.command_execute('please show the workflow');
        expect(response.statusCode).toBe(CalypsoStatusCode.OK);
        expect(response.message).toContain('DAG [fedml]');
        expect(response.message).toContain('◉ ml-readiness');
    });

    it('supports user-scoped /settings for conversational width', async (): Promise<void> => {
        const fixture: CoreFixture = await fixture_create();

        const showDefault: CalypsoResponse = await fixture.core.command_execute('/settings show');
        expect(showDefault.statusCode).toBe(CalypsoStatusCode.OK);
        expect(showDefault.message).toContain('convo_width = 88');

        const setResult: CalypsoResponse = await fixture.core.command_execute('/settings set convo_width 72');
        expect(setResult.statusCode).toBe(CalypsoStatusCode.OK);

        const showUpdated: CalypsoResponse = await fixture.core.command_execute('/settings show');
        expect(showUpdated.message).toContain('convo_width = 72');

        const unsetResult: CalypsoResponse = await fixture.core.command_execute('/settings unset convo_width');
        expect(unsetResult.statusCode).toBe(CalypsoStatusCode.OK);
    });

    it('emits conversational width hint for conversational responses', async (): Promise<void> => {
        const fixture: CoreFixture = await fixture_create();
        await fixture.core.command_execute('/settings set convo_width 74');

        const response: CalypsoResponse = await fixture.core.command_execute('/greet tester');
        expect(response.statusCode).toBe(CalypsoStatusCode.CONVERSATIONAL);
        expect(response.ui_hints?.convo_width).toBe(74);
    });

    it('emits boot telemetry with phase and monotonic sequence per phase', async (): Promise<void> => {
        const fixture: CoreFixture = await fixture_create();
        const events: BootLogEvent[] = [];
        const unsubscribe: () => void = fixture.core.telemetry_subscribe((event: TelemetryEvent): void => {
            if (event.type === 'boot_log') {
                events.push(event);
            }
        });

        try {
            await fixture.core.boot();
            await fixture.core.workflow_set('fedml');
        } finally {
            unsubscribe();
        }

        const loginEvents: BootLogEvent[] = events.filter((event: BootLogEvent): boolean => event.phase === 'login_boot');
        const workflowEvents: BootLogEvent[] = events.filter((event: BootLogEvent): boolean => event.phase === 'workflow_boot');

        expect(loginEvents.length).toBeGreaterThan(0);
        expect(workflowEvents.length).toBeGreaterThan(0);

        for (let i: number = 0; i < loginEvents.length; i++) {
            expect(loginEvents[i].seq).toBe(i + 1);
            expect(loginEvents[i].phase).toBe('login_boot');
            expect(loginEvents[i].status).toMatch(/^(WAIT|OK|FAIL|DONE)$/);
        }

        for (let i: number = 0; i < workflowEvents.length; i++) {
            expect(workflowEvents[i].seq).toBe(i + 1);
            expect(workflowEvents[i].phase).toBe('workflow_boot');
            expect(workflowEvents[i].status).toMatch(/^(WAIT|OK|FAIL|DONE)$/);
        }
    });
});
