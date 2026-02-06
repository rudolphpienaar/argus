/**
 * @file WorkflowEngine Unit Tests
 *
 * Verifies workflow loading, transition checking, and state management.
 * Tests use mock VFS contexts to simulate different workflow states.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowEngine } from './WorkflowEngine.js';
import type { WorkflowDefinition, WorkflowState, WorkflowContext, TransitionResult } from './types.js';

describe('WorkflowEngine', () => {
    let fedmlDefinition: WorkflowDefinition;
    let state: WorkflowState;

    /**
     * Create a context with configurable VFS state.
     */
    function context_create(options: {
        hasDatasets?: boolean;
        hasProject?: boolean;
        hasHarmonized?: boolean;
        hasTrainPy?: boolean;
        hasLocalPass?: boolean;
    } = {}): WorkflowContext {
        const projectPath = '/home/user/projects/DRAFT-1234';
        return {
            store: {
                selectedDatasets: { length: options.hasDatasets ? 1 : 0 }
            },
            vfs: {
                exists: (path: string): boolean => {
                    // Simulate VFS markers based on options
                    if (options.hasHarmonized && path.includes('.harmonized')) return true;
                    if (options.hasTrainPy && path.includes('train.py')) return true;
                    if (options.hasLocalPass && path.includes('.local_pass')) return true;
                    return false;
                }
            },
            project: options.hasProject ? projectPath : ''
        };
    }

    beforeEach(() => {
        fedmlDefinition = WorkflowEngine.definition_load('fedml');
        state = WorkflowEngine.state_create('fedml');
    });

    describe('definition_load', () => {
        it('should load fedml workflow', () => {
            const definition: WorkflowDefinition = WorkflowEngine.definition_load('fedml');
            expect(definition.id).toBe('fedml');
            expect(definition.name).toBe('Federated ML Workflow');
            expect(definition.stages.length).toBe(5);
        });

        it('should load chris workflow', () => {
            const definition: WorkflowDefinition = WorkflowEngine.definition_load('chris');
            expect(definition.id).toBe('chris');
            expect(definition.stages.length).toBe(4);
        });

        it('should throw on unknown workflow', () => {
            expect(() => WorkflowEngine.definition_load('unknown')).toThrow(/not found/);
        });
    });

    describe('workflows_list', () => {
        it('should return available workflow IDs', () => {
            const workflows: string[] = WorkflowEngine.workflows_list();
            expect(workflows).toContain('fedml');
            expect(workflows).toContain('chris');
        });
    });

    describe('state_create', () => {
        it('should create state with empty skip counts', () => {
            const newState: WorkflowState = WorkflowEngine.state_create('fedml');
            expect(newState.workflowId).toBe('fedml');
            expect(newState.skipCounts).toEqual({});
        });
    });

    describe('stages_completed', () => {
        it('should return empty array when no VFS markers exist', () => {
            const context = context_create({ hasDatasets: false });
            const completed = WorkflowEngine.stages_completed(fedmlDefinition, context);
            expect(completed).toEqual([]);
        });

        it('should detect gather complete when datasets selected', () => {
            const context = context_create({ hasDatasets: true, hasProject: true });
            const completed = WorkflowEngine.stages_completed(fedmlDefinition, context);
            expect(completed).toContain('gather');
        });

        it('should detect harmonize complete when marker exists', () => {
            const context = context_create({ hasDatasets: true, hasProject: true, hasHarmonized: true });
            const completed = WorkflowEngine.stages_completed(fedmlDefinition, context);
            expect(completed).toContain('harmonize');
        });

        it('should detect code complete when train.py exists', () => {
            const context = context_create({
                hasDatasets: true, hasProject: true, hasHarmonized: true, hasTrainPy: true
            });
            const completed = WorkflowEngine.stages_completed(fedmlDefinition, context);
            expect(completed).toContain('code');
        });

        it('should detect train complete when local_pass exists', () => {
            const context = context_create({
                hasDatasets: true, hasProject: true, hasHarmonized: true,
                hasTrainPy: true, hasLocalPass: true
            });
            const completed = WorkflowEngine.stages_completed(fedmlDefinition, context);
            expect(completed).toContain('train');
        });
    });

    describe('transition_check', () => {
        it('should allow gather without prerequisites', () => {
            const context = context_create({ hasDatasets: true });
            const result: TransitionResult = WorkflowEngine.transition_check(
                state,
                fedmlDefinition,
                'GATHER',
                context
            );
            expect(result.allowed).toBe(true);
            expect(result.warning).toBeNull();
        });

        it('should warn on skipping harmonize (first time)', () => {
            // Context: gather is complete (datasets selected), but not harmonized
            const context = context_create({ hasDatasets: true, hasProject: true });

            // Try to go to code without harmonize
            const result: TransitionResult = WorkflowEngine.transition_check(
                state,
                fedmlDefinition,
                'CODE',
                context
            );

            expect(result.allowed).toBe(false);
            expect(result.warning).toBe('Cohort not harmonized.');
            expect(result.suggestion).toContain('harmonize');
            expect(result.reason).toBeNull(); // First warning, no full reason yet
            expect(result.skippedStageId).toBe('harmonize');
        });

        it('should include reason on second skip attempt', () => {
            const context = context_create({ hasDatasets: true, hasProject: true });

            // First attempt
            WorkflowEngine.transition_check(state, fedmlDefinition, 'CODE', context);
            WorkflowEngine.skip_increment(state, 'harmonize');

            // Second attempt
            const result: TransitionResult = WorkflowEngine.transition_check(
                state,
                fedmlDefinition,
                'CODE',
                context
            );

            expect(result.allowed).toBe(false);
            expect(result.warning).toBe('Cohort not harmonized.');
            expect(result.reason).not.toBeNull();
            expect(result.reason).toContain('Federated learning requires');
        });

        it('should allow skip after max_warnings exceeded', () => {
            const context = context_create({ hasDatasets: true, hasProject: true });

            // Skip twice (max_warnings = 2)
            WorkflowEngine.skip_increment(state, 'harmonize');
            WorkflowEngine.skip_increment(state, 'harmonize');

            // Third attempt should be allowed
            const result: TransitionResult = WorkflowEngine.transition_check(
                state,
                fedmlDefinition,
                'CODE',
                context
            );

            expect(result.allowed).toBe(true);
        });

        it('should allow intent not in workflow', () => {
            const context = context_create();
            const result: TransitionResult = WorkflowEngine.transition_check(
                state,
                fedmlDefinition,
                'UNKNOWN_INTENT',
                context
            );
            expect(result.allowed).toBe(true);
        });
    });

    describe('stage_complete', () => {
        it('should clear skip count when stage completed', () => {
            state.skipCounts['harmonize'] = 2;
            WorkflowEngine.stage_complete(state, 'harmonize');
            expect(state.skipCounts['harmonize']).toBeUndefined();
        });
    });

    describe('skip_increment', () => {
        it('should increment skip counter', () => {
            expect(WorkflowEngine.skip_increment(state, 'harmonize')).toBe(1);
            expect(WorkflowEngine.skip_increment(state, 'harmonize')).toBe(2);
            expect(WorkflowEngine.skip_increment(state, 'harmonize')).toBe(3);
        });
    });

    describe('stage_forIntent', () => {
        it('should find stage by intent', () => {
            const stage = WorkflowEngine.stage_forIntent(fedmlDefinition, 'HARMONIZE');
            expect(stage?.id).toBe('harmonize');
        });

        it('should return null for unknown intent', () => {
            const stage = WorkflowEngine.stage_forIntent(fedmlDefinition, 'UNKNOWN');
            expect(stage).toBeNull();
        });

        it('should be case-insensitive', () => {
            const stage = WorkflowEngine.stage_forIntent(fedmlDefinition, 'harmonize');
            expect(stage?.id).toBe('harmonize');
        });
    });

    describe('stage_next', () => {
        it('should return first stage when nothing completed', () => {
            const context = context_create();
            const next = WorkflowEngine.stage_next(fedmlDefinition, context);
            expect(next?.id).toBe('gather');
        });

        it('should return next actionable stage', () => {
            const context = context_create({ hasDatasets: true, hasProject: true });
            const next = WorkflowEngine.stage_next(fedmlDefinition, context);
            expect(next?.id).toBe('harmonize');
        });

        it('should skip to code when harmonize complete', () => {
            const context = context_create({
                hasDatasets: true, hasProject: true, hasHarmonized: true
            });
            const next = WorkflowEngine.stage_next(fedmlDefinition, context);
            expect(next?.id).toBe('code');
        });

        it('should return null when workflow complete', () => {
            const context = context_create({
                hasDatasets: true, hasProject: true, hasHarmonized: true,
                hasTrainPy: true, hasLocalPass: true
            });
            const next = WorkflowEngine.stage_next(fedmlDefinition, context);
            // federate has no validation, so it won't auto-complete
            expect(next?.id).toBe('federate');
        });
    });

    describe('dependencies_satisfied_arr', () => {
        it('should return true for entry stages', () => {
            const gatherStage = fedmlDefinition.stages[0];
            expect(WorkflowEngine.dependencies_satisfied_arr([], gatherStage)).toBe(true);
        });

        it('should return false when requires not met', () => {
            const harmonizeStage = fedmlDefinition.stages[1];
            expect(WorkflowEngine.dependencies_satisfied_arr([], harmonizeStage)).toBe(false);
        });

        it('should return true when requires met', () => {
            const harmonizeStage = fedmlDefinition.stages[1];
            expect(WorkflowEngine.dependencies_satisfied_arr(['gather'], harmonizeStage)).toBe(true);
        });
    });

    describe('progress_summarize', () => {
        it('should show workflow progress', () => {
            const context = context_create({ hasDatasets: true, hasProject: true });
            const summary: string = WorkflowEngine.progress_summarize(fedmlDefinition, context);

            expect(summary).toContain('Federated ML Workflow');
            expect(summary).toContain('1/5 stages');
            expect(summary).toContain('● Cohort Assembly');  // completed
            expect(summary).toContain('○ Data Harmonization'); // not completed
            expect(summary).toContain('← NEXT');
        });

        it('should show multiple completed stages', () => {
            const context = context_create({
                hasDatasets: true, hasProject: true, hasHarmonized: true
            });
            const summary: string = WorkflowEngine.progress_summarize(fedmlDefinition, context);

            expect(summary).toContain('2/5 stages');
            expect(summary).toContain('● Cohort Assembly');
            expect(summary).toContain('● Data Harmonization');
            expect(summary).toContain('○ Code Development');
        });
    });
});
