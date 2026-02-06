/**
 * @file WorkflowEngine Unit Tests
 *
 * Verifies workflow loading, transition checking, and state management.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowEngine } from './WorkflowEngine.js';
import type { WorkflowDefinition, WorkflowState, WorkflowContext, TransitionResult } from './types.js';

describe('WorkflowEngine', () => {
    let fedmlDefinition: WorkflowDefinition;
    let state: WorkflowState;
    let context: WorkflowContext;

    beforeEach(() => {
        fedmlDefinition = WorkflowEngine.definition_load('fedml');
        state = WorkflowEngine.state_create('fedml');
        context = {
            store: { selectedDatasets: { length: 1 } },
            vfs: { exists: (_path: string): boolean => false },
            project: '/home/user/projects/DRAFT-1234'
        };
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
        it('should create empty state', () => {
            const newState: WorkflowState = WorkflowEngine.state_create('fedml');
            expect(newState.workflowId).toBe('fedml');
            expect(newState.completedStages).toEqual([]);
            expect(newState.skipCounts).toEqual({});
        });
    });

    describe('transition_check', () => {
        it('should allow gather without prerequisites', () => {
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
            // Complete gather stage
            WorkflowEngine.stage_complete(state, 'gather');

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
            WorkflowEngine.stage_complete(state, 'gather');

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
            WorkflowEngine.stage_complete(state, 'gather');

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
        it('should add stage to completed list', () => {
            WorkflowEngine.stage_complete(state, 'gather');
            expect(state.completedStages).toContain('gather');
        });

        it('should not duplicate completed stages', () => {
            WorkflowEngine.stage_complete(state, 'gather');
            WorkflowEngine.stage_complete(state, 'gather');
            expect(state.completedStages.filter((s: string): boolean => s === 'gather').length).toBe(1);
        });

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
            const next = WorkflowEngine.stage_next(state, fedmlDefinition);
            expect(next?.id).toBe('gather');
        });

        it('should return next actionable stage', () => {
            WorkflowEngine.stage_complete(state, 'gather');
            const next = WorkflowEngine.stage_next(state, fedmlDefinition);
            expect(next?.id).toBe('harmonize');
        });

        it('should return null when workflow complete', () => {
            WorkflowEngine.stage_complete(state, 'gather');
            WorkflowEngine.stage_complete(state, 'harmonize');
            WorkflowEngine.stage_complete(state, 'code');
            WorkflowEngine.stage_complete(state, 'train');
            WorkflowEngine.stage_complete(state, 'federate');

            const next = WorkflowEngine.stage_next(state, fedmlDefinition);
            expect(next).toBeNull();
        });
    });

    describe('dependencies_satisfied', () => {
        it('should return true for entry stages', () => {
            const gatherStage = fedmlDefinition.stages[0];
            expect(WorkflowEngine.dependencies_satisfied(state, gatherStage)).toBe(true);
        });

        it('should return false when requires not met', () => {
            const harmonizeStage = fedmlDefinition.stages[1];
            expect(WorkflowEngine.dependencies_satisfied(state, harmonizeStage)).toBe(false);
        });

        it('should return true when requires met', () => {
            WorkflowEngine.stage_complete(state, 'gather');
            const harmonizeStage = fedmlDefinition.stages[1];
            expect(WorkflowEngine.dependencies_satisfied(state, harmonizeStage)).toBe(true);
        });
    });

    describe('progress_summarize', () => {
        it('should show workflow progress', () => {
            WorkflowEngine.stage_complete(state, 'gather');
            const summary: string = WorkflowEngine.progress_summarize(state, fedmlDefinition);

            expect(summary).toContain('Federated ML Workflow');
            expect(summary).toContain('1/5 stages');
            expect(summary).toContain('● Cohort Assembly');  // completed
            expect(summary).toContain('○ Data Harmonization'); // not completed
            expect(summary).toContain('← NEXT');
        });
    });
});
