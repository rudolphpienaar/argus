/**
 * @file WorkflowEngine - Declarative Workflow State Machine
 *
 * Manages workflow state by querying VFS markers as the single source of truth.
 * Stage completion is determined by evaluating validation conditions against
 * actual VFS/store state, not by maintaining an in-memory counter.
 *
 * Workflows are DAGs where each stage declares its dependencies and provides
 * skip warnings for educational soft-blocking.
 *
 * @module
 * @see docs/persona-workflows.adoc
 */

import type {
    WorkflowDefinition,
    WorkflowStage,
    WorkflowState,
    WorkflowContext,
    TransitionResult,
    StageValidation,
    SkipWarning,
    WorkflowSummary
} from './types.js';

import { FEDML_WORKFLOW } from './definitions/fedml.js';
import { CHRIS_WORKFLOW } from './definitions/chris.js';

/** Registry of available workflow definitions */
const WORKFLOW_REGISTRY: Record<string, WorkflowDefinition> = {
    fedml: FEDML_WORKFLOW,
    chris: CHRIS_WORKFLOW
};

/**
 * Workflow engine for declarative workflow state management.
 *
 * Uses VFS markers as the single source of truth for stage completion.
 * Stage completion is determined by evaluating each stage's validation
 * condition against the runtime context (VFS, store).
 *
 * Provides static methods for loading definitions, checking transitions,
 * and determining workflow progress. Uses soft enforcement with educational
 * warnings rather than hard blocks.
 */
export class WorkflowEngine {
    /**
     * Load a workflow definition by ID.
     *
     * @param workflowId - The workflow identifier (e.g., 'fedml', 'chris')
     * @returns The parsed workflow definition
     * @throws {Error} If workflow not found in registry
     *
     * @example
     * ```typescript
     * const definition = WorkflowEngine.definition_load('fedml');
     * console.log(definition.name); // "Federated ML Workflow"
     * ```
     */
    static definition_load(workflowId: string): WorkflowDefinition {
        const definition: WorkflowDefinition | undefined = WORKFLOW_REGISTRY[workflowId];
        if (!definition) {
            const available: string = Object.keys(WORKFLOW_REGISTRY).join(', ');
            throw new Error(`Workflow '${workflowId}' not found. Available: ${available}`);
        }
        return definition;
    }

    /**
     * Get all available workflow IDs.
     *
     * @returns Array of registered workflow identifiers
     */
    static workflows_list(): string[] {
        return Object.keys(WORKFLOW_REGISTRY);
    }

    /**
     * Get summaries of all available workflows for selection UI.
     *
     * @returns Array of workflow summaries with id, name, persona, description
     */
    static workflows_summarize(): WorkflowSummary[] {
        return Object.values(WORKFLOW_REGISTRY).map(
            (def: WorkflowDefinition): WorkflowSummary => ({
                id: def.id,
                name: def.name,
                persona: def.persona,
                description: def.description.split('\n')[0], // First line only
                stageCount: def.stages.length
            })
        );
    }

    /**
     * Create a fresh workflow state for tracking skip counts.
     *
     * Note: Stage completion is determined by VFS markers, not by this state.
     * This state only tracks skip warning counts for soft-blocking.
     *
     * @param workflowId - The workflow to initialize
     * @returns Fresh workflow state with empty skip counts
     *
     * @example
     * ```typescript
     * const state = WorkflowEngine.state_create('fedml');
     * // state.skipCounts = {}
     * ```
     */
    static state_create(workflowId: string): WorkflowState {
        return {
            workflowId,
            skipCounts: {}
        };
    }

    /**
     * Get list of completed stage IDs by evaluating validation conditions.
     *
     * This is the SINGLE SOURCE OF TRUTH for stage completion.
     * Each stage's validation condition is evaluated against the VFS/store
     * to determine if the stage is complete.
     *
     * @param definition - Workflow definition
     * @param context - Runtime context (store, vfs, project path)
     * @returns Array of stage IDs that have passed their validation
     *
     * @example
     * ```typescript
     * const completed = WorkflowEngine.stages_completed(definition, context);
     * // ['gather', 'harmonize'] if those stages' validations pass
     * ```
     */
    static stages_completed(
        definition: WorkflowDefinition,
        context: WorkflowContext
    ): string[] {
        const completed: string[] = [];

        for (const stage of definition.stages) {
            // Stage with no validation is never auto-completed
            if (!stage.validation) {
                continue;
            }

            // Evaluate the validation condition against VFS/store
            if (WorkflowEngine.validation_evaluate(stage.validation, context)) {
                completed.push(stage.id);
            }
        }

        return completed;
    }

    /**
     * Check if a transition to the given intent is allowed.
     *
     * Queries VFS to determine current stage completion, then checks
     * if the target stage's dependencies are satisfied.
     *
     * @param state - Workflow state (for skip counts only)
     * @param definition - Workflow definition
     * @param intent - The intent the user is attempting (uppercase)
     * @param context - Runtime context for validation (store, vfs, project path)
     * @returns Transition result with allowed status and warnings
     *
     * @example
     * ```typescript
     * const result = WorkflowEngine.transition_check(state, definition, 'CODE', context);
     * if (!result.allowed) {
     *     console.log(result.warning);    // "Cohort not harmonized."
     *     console.log(result.suggestion); // "Run 'harmonize' to standardize..."
     * }
     * ```
     */
    static transition_check(
        state: WorkflowState,
        definition: WorkflowDefinition,
        intent: string,
        context: WorkflowContext
    ): TransitionResult {
        const intentUpper: string = intent.toUpperCase();

        // Find the stage this intent belongs to
        const targetStage: WorkflowStage | null = WorkflowEngine.stage_forIntent(definition, intentUpper);

        // If intent doesn't map to any stage, allow it (not workflow-controlled)
        if (!targetStage) {
            return WorkflowEngine.result_allowed();
        }

        // Get completed stages from VFS (single source of truth)
        const completedStages: string[] = WorkflowEngine.stages_completed(definition, context);

        // Check if target stage is already completed
        if (completedStages.includes(targetStage.id)) {
            return WorkflowEngine.result_allowed();
        }

        // Find unsatisfied dependencies
        const unsatisfied: WorkflowStage[] = WorkflowEngine.dependencies_unsatisfied(
            completedStages,
            definition,
            targetStage
        );

        // If all dependencies satisfied, allow
        if (unsatisfied.length === 0) {
            return WorkflowEngine.result_allowed();
        }

        // Find the first unsatisfied stage with a skip warning
        const blockingStage: WorkflowStage | undefined = unsatisfied.find(
            (s: WorkflowStage): boolean => s.skip_warning !== null
        );

        if (!blockingStage || !blockingStage.skip_warning) {
            // No skip warning defined — allow silently
            return WorkflowEngine.result_allowed();
        }

        // Get current skip count for this stage
        const skipCount: number = state.skipCounts[blockingStage.id] || 0;
        const maxWarnings: number = blockingStage.skip_warning.max_warnings;

        // If user has been warned enough times, allow
        if (skipCount >= maxWarnings) {
            return WorkflowEngine.result_allowed();
        }

        // Return warning result
        const warning: SkipWarning = blockingStage.skip_warning;
        const isSecondWarning: boolean = skipCount >= 1;

        return {
            allowed: false,
            warning: warning.short,
            reason: isSecondWarning ? warning.reason : null,
            suggestion: warning.suggestion,
            skipCount: skipCount,
            hardBlock: false,
            skippedStageId: blockingStage.id
        };
    }

    /**
     * Clear skip count for a stage when it's properly completed.
     *
     * Note: Stage completion is determined by VFS markers, not by this method.
     * This only clears the skip warning counter.
     *
     * @param state - Current workflow state (mutated in place)
     * @param stageId - Stage ID to clear skip count for
     */
    static stage_complete(state: WorkflowState, stageId: string): void {
        // VFS markers are the source of truth for completion.
        // This method only clears skip counts.
        delete state.skipCounts[stageId];
    }

    /**
     * Increment the skip counter for a stage.
     *
     * Called when user proceeds despite a warning.
     *
     * @param state - Current workflow state (mutated in place)
     * @param stageId - Stage being skipped
     * @returns New skip count after increment
     */
    static skip_increment(state: WorkflowState, stageId: string): number {
        const current: number = state.skipCounts[stageId] || 0;
        state.skipCounts[stageId] = current + 1;
        return state.skipCounts[stageId];
    }

    /**
     * Find which stage handles a given intent.
     *
     * @param definition - Workflow definition
     * @param intent - Intent keyword to look up (case-insensitive)
     * @returns The stage that handles this intent, or null if none
     */
    static stage_forIntent(
        definition: WorkflowDefinition,
        intent: string
    ): WorkflowStage | null {
        const intentUpper: string = intent.toUpperCase();
        return definition.stages.find(
            (stage: WorkflowStage): boolean => stage.intents.includes(intentUpper)
        ) || null;
    }

    /**
     * Get the next suggested stage based on current progress.
     *
     * Queries VFS to determine completed stages, then returns the first
     * incomplete stage whose dependencies are all satisfied.
     *
     * @param definition - Workflow definition
     * @param context - Runtime context (store, vfs, project path)
     * @returns The next actionable stage, or null if workflow complete
     */
    static stage_next(
        definition: WorkflowDefinition,
        context: WorkflowContext
    ): WorkflowStage | null {
        // Get completed stages from VFS (single source of truth)
        const completedStages: string[] = WorkflowEngine.stages_completed(definition, context);

        for (const stage of definition.stages) {
            // Skip completed stages
            if (completedStages.includes(stage.id)) {
                continue;
            }

            // Check if dependencies are satisfied
            if (WorkflowEngine.dependencies_satisfied_arr(completedStages, stage)) {
                return stage;
            }
        }
        return null;
    }

    /**
     * Check if all dependencies for a stage are satisfied.
     *
     * @param completedStages - Array of completed stage IDs
     * @param stage - Stage to check
     * @returns True if all required stages are complete
     */
    static dependencies_satisfied_arr(
        completedStages: string[],
        stage: WorkflowStage
    ): boolean {
        return stage.requires.every(
            (reqId: string): boolean => completedStages.includes(reqId)
        );
    }

    /**
     * Get list of unsatisfied dependencies for a stage.
     *
     * @param completedStages - Array of completed stage IDs
     * @param definition - Workflow definition
     * @param stage - Stage to check
     * @returns Array of stages that are required but not completed
     */
    static dependencies_unsatisfied(
        completedStages: string[],
        definition: WorkflowDefinition,
        stage: WorkflowStage
    ): WorkflowStage[] {
        const unsatisfied: WorkflowStage[] = [];

        for (const reqId of stage.requires) {
            if (!completedStages.includes(reqId)) {
                const reqStage: WorkflowStage | undefined = definition.stages.find(
                    (s: WorkflowStage): boolean => s.id === reqId
                );
                if (reqStage) {
                    unsatisfied.push(reqStage);
                }
            }
        }

        return unsatisfied;
    }

    /**
     * Evaluate a validation condition against the runtime context.
     *
     * @param validation - Validation object with condition expression
     * @param context - Runtime context (store, vfs, project)
     * @returns True if condition passes, false otherwise
     */
    static validation_evaluate(
        validation: StageValidation,
        context: WorkflowContext
    ): boolean {
        try {
            // Interpolate ${project} in condition
            const condition: string = validation.condition.replace(
                /\$\{project\}/g,
                context.project
            );

            // Create evaluation context
            const store = context.store;
            const vfs = context.vfs;

            // Evaluate condition (safe because we control the YAML source)
            // eslint-disable-next-line no-eval
            return Boolean(eval(condition));
        } catch (e: unknown) {
            console.error('Validation evaluation failed:', e);
            return false;
        }
    }

    /**
     * Get a summary of workflow progress.
     *
     * Queries VFS to determine which stages are complete.
     *
     * @param definition - Workflow definition
     * @param context - Runtime context (store, vfs, project path)
     * @returns Human-readable progress summary
     */
    static progress_summarize(
        definition: WorkflowDefinition,
        context: WorkflowContext
    ): string {
        const total: number = definition.stages.length;
        const completedStages: string[] = WorkflowEngine.stages_completed(definition, context);
        const completed: number = completedStages.length;
        const nextStage: WorkflowStage | null = WorkflowEngine.stage_next(definition, context);

        let summary: string = `Workflow: ${definition.name}\n`;
        summary += `Progress: ${completed}/${total} stages\n\n`;

        for (const stage of definition.stages) {
            const isComplete: boolean = completedStages.includes(stage.id);
            const marker: string = isComplete ? '●' : '○';
            summary += `  ${marker} ${stage.name}`;
            if (nextStage && stage.id === nextStage.id) {
                summary += ' ← NEXT';
            }
            summary += '\n';
        }

        return summary;
    }

    /**
     * Create an allowed transition result.
     *
     * @returns TransitionResult with allowed=true
     */
    private static result_allowed(): TransitionResult {
        return {
            allowed: true,
            warning: null,
            reason: null,
            suggestion: null,
            skipCount: 0,
            hardBlock: false,
            skippedStageId: null
        };
    }
}
