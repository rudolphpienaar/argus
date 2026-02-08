/**
 * @file Workflow Type Definitions
 *
 * Type definitions for declarative persona workflow specifications.
 * Workflows define the expected sequence of operations for a given persona,
 * with soft enforcement via educational warnings.
 *
 * @module
 * @see docs/persona-workflows.adoc
 */

/**
 * Validation condition for stage completion.
 *
 * @property condition - JavaScript expression evaluated against runtime context
 * @property error_message - Error message when validation fails
 */
export interface StageValidation {
    condition: string;
    error_message: string;
}

/**
 * Warning configuration when user attempts to skip a required stage.
 *
 * @property short - Brief one-line warning (first skip attempt)
 * @property reason - Detailed explanation of why this step matters
 * @property suggestion - Concrete command or action to resolve
 * @property max_warnings - Number of warnings before allowing skip (default: 2)
 */
export interface SkipWarning {
    short: string;
    reason: string;
    suggestion: string;
    max_warnings: number;
}

/**
 * A single stage in a workflow DAG.
 *
 * @property id - Unique identifier (snake_case)
 * @property name - Human-readable display name
 * @property intents - Intent keywords this stage handles
 * @property requires - Stage IDs that must complete before this one
 * @property validation - Condition to verify stage completion
 * @property skip_warning - Warning when user tries to skip
 */
export interface WorkflowStage {
    id: string;
    name: string;
    intents: string[];
    requires: string[];
    validation: StageValidation | null;
    skip_warning: SkipWarning | null;
}

/**
 * Complete workflow definition loaded from YAML.
 *
 * @property name - Workflow display name
 * @property id - Unique workflow identifier
 * @property persona - Associated persona
 * @property description - Detailed description
 * @property stages - Ordered list of stages forming the DAG
 */
export interface WorkflowDefinition {
    name: string;
    id: string;
    persona: string;
    description: string;
    stages: WorkflowStage[];
}

/**
 * Runtime state for an active workflow.
 *
 * Note: Stage completion is determined by VFS markers, not stored here.
 * This state only tracks skip warning counts for soft-blocking.
 *
 * @property workflowId - Active workflow ID
 * @property skipCounts - Skip warning counts per stage
 */
export interface WorkflowState {
    workflowId: string;
    skipCounts: Record<string, number>;
}

/**
 * Result of a workflow transition check.
 *
 * @property allowed - Whether the transition is allowed without warning
 * @property warning - Warning message if blocked (null if allowed)
 * @property reason - Full reason text for second+ warnings (null if first or allowed)
 * @property suggestion - Suggestion for user (null if allowed)
 * @property skipCount - Number of times this skip has been attempted
 * @property hardBlock - Whether this is a hard block (false = soft warning)
 * @property skippedStageId - ID of the stage being skipped (null if none)
 */
export interface TransitionResult {
    allowed: boolean;
    warning: string | null;
    reason: string | null;
    suggestion: string | null;
    skipCount: number;
    hardBlock: boolean;
    skippedStageId: string | null;
}

/**
 * Runtime context for workflow validation expressions.
 *
 * @property store - Store state accessor
 * @property vfs - VFS accessor with exists() method
 * @property project - Active project path (interpolated into conditions)
 */
export interface WorkflowContext {
    store: {
        selectedDatasets: { length: number };
        [key: string]: unknown;
    };
    vfs: {
        exists: (path: string) => boolean;
    };
    project: string;
}

/**
 * Summary metadata for workflow selection UI and APIs.
 *
 * @property id - Stable workflow identifier
 * @property name - Human-readable workflow name
 * @property persona - Persona associated with this workflow
 * @property description - One-line workflow description
 * @property stageCount - Number of stages in the workflow
 */
export interface WorkflowSummary {
    id: string;
    name: string;
    persona: string;
    description: string;
    stageCount: number;
}
