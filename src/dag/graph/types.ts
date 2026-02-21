/**
 * @file DAG Graph Type Definitions
 *
 * Core types for the manifest-driven DAG engine. These types describe
 * the topology of persona workflows: nodes (stages), edges (previous
 * pointers), and the parsed DAG definition that both manifests and
 * scripts compile into.
 *
 * Design principle: the graph layer is pure topology — no I/O, no
 * storage, no fingerprinting. It parses YAML, validates structure,
 * and resolves readiness.
 *
 * @module dag/graph
 * @see docs/dag-engine.adoc
 */

// ─── Stage Parameters ────────────────────────────────────────────

/**
 * Parameter definition for a manifest stage.
 *
 * Manifests declare default parameter values per stage. Scripts can
 * override these defaults. Runtime overrides take final precedence.
 *
 * Three-layer hierarchy: manifest defaults → script overrides → runtime overrides.
 */
export type StageParameters = Record<string, unknown>;

// ─── Skip Warning ────────────────────────────────────────────────

/**
 * Educational warning shown when a user tries to skip an optional stage.
 *
 * @property short - Brief one-line warning text
 * @property reason - Detailed explanation of why the stage matters
 * @property max_warnings - Warnings before allowing skip (default: 2)
 */
export interface SkipWarning {
    short: string;
    reason: string;
    max_warnings: number;
}

// ─── DAG Node (Stage) ────────────────────────────────────────────

/**
 * A single node in the DAG — one stage of a persona workflow.
 *
 * Every stage declares its parent(s) via `previous` (backward pointers,
 * following the ChRIS pipeline YAML convention). The graph is built by
 * reading these backward pointers, not by declaring children.
 *
 * Every stage produces at least one artifact. There are no pass-through
 * stages. Optional stages that are skipped materialize a skip sentinel.
 *
 * @property id - Unique stage identifier (snake_case, e.g. 'federate-brief')
 * @property name - Human-readable display name
 * @property phase - Optional grouping for progress display (e.g. 'search-and-gather')
 * @property previous - Parent stage ID(s). null for root. Array for joins.
 * @property optional - Whether this stage can be skipped
 * @property produces - Artifact filenames this stage materializes (always non-empty)
 * @property parameters - Default parameter values for this stage
 * @property instruction - What to tell the user at this stage
 * @property commands - Exact commands available to the user
 * @property handler - The logic handler to invoke for these commands
 * @property skip_warning - Warning config if user tries to skip (null if not optional)
 * @property narrative - v10.1 One-line telemetry summary for script/spinner display
 * @property blueprint - v10.1 Multi-line execution plan details for script review
 */
export interface DAGNode {
    id: string;
    name: string;
    phase: string | null;
    previous: string[] | null;
    optional: boolean;
    produces: string[];
    parameters: StageParameters;
    instruction: string;
    commands: string[];
    handler: string | null;
    skip_warning: SkipWarning | null;
    narrative: string | null;
    blueprint: string[];
}

// ─── DAG Edge ────────────────────────────────────────────────────

/**
 * An edge in the DAG — a dependency between two stages.
 *
 * Edges are derived from `previous` declarations. They point from
 * parent to child (the direction of data flow), even though the
 * YAML declares them as child-to-parent.
 *
 * @property from - Parent stage ID (data source)
 * @property to - Child stage ID (data consumer)
 */
export interface DAGEdge {
    from: string;
    to: string;
}

// ─── Manifest Header ────────────────────────────────────────────

/**
 * The header section of a persona manifest.
 *
 * @property name - Human-readable manifest name
 * @property description - Detailed description of the workflow
 * @property category - Workflow category (e.g. 'Federated Learning')
 * @property persona - Associated persona identifier
 * @property version - Manifest version (semver)
 * @property locked - Whether the DAG topology is immutable
 * @property authors - Author attribution
 */
export interface ManifestHeader {
    name: string;
    description: string;
    category: string;
    persona: string;
    version: string;
    locked: boolean;
    authors: string;
}

// ─── Script Header ──────────────────────────────────────────────

/**
 * The header section of a script file.
 *
 * Scripts anchor to a manifest via the `manifest` field. They define
 * a parameterized path through the manifest's DAG, optionally skipping
 * stages and overriding parameters.
 *
 * @property name - Human-readable script name
 * @property description - What this script automates
 * @property manifest - Manifest filename this script is anchored to
 * @property version - Script version (semver)
 * @property authors - Author attribution
 */
export interface ScriptHeader {
    name: string;
    description: string;
    manifest: string;
    version: string;
    authors: string;
}

// ─── Script Stage Override ──────────────────────────────────────

/**
 * A stage entry in a script. Scripts don't redefine stages — they
 * reference manifest stages by ID and optionally override parameters
 * or declare a skip.
 *
 * @property id - Stage ID (must exist in the anchored manifest)
 * @property skip - Whether to skip this stage (materializes a sentinel)
 * @property parameters - Parameter overrides for this stage
 */
export interface ScriptStageOverride {
    id: string;
    skip: boolean;
    parameters: StageParameters;
}

// ─── DAG Definition (Common Output) ─────────────────────────────

/**
 * The parsed representation of either a manifest or a script.
 *
 * Both manifest and script parsers produce a DAGDefinition as their
 * output. This is the common type consumed by the validator, resolver,
 * and store layers.
 *
 * @property source - Whether this came from a manifest or script
 * @property header - Manifest or script header metadata
 * @property nodes - All stages as DAGNode instances
 * @property edges - All edges derived from `previous` declarations
 * @property rootIds - IDs of root nodes (stages with no previous)
 * @property terminalIds - IDs of terminal nodes (stages with no children)
 */
export interface DAGDefinition {
    source: 'manifest' | 'script';
    header: ManifestHeader | ScriptHeader;
    nodes: Map<string, DAGNode>;
    orderedNodeIds: string[];
    edges: DAGEdge[];
    rootIds: string[];
    terminalIds: string[];
}

// ─── Validation Result ──────────────────────────────────────────

/**
 * Result of DAG validation (cycle detection, orphan check, etc.).
 *
 * @property valid - Whether the DAG passes all checks
 * @property errors - List of validation error messages
 */
export interface ValidationResult {
    valid: boolean;
    errors: string[];
}

// ─── Node Readiness ─────────────────────────────────────────────

/**
 * Readiness state of a single DAG node.
 *
 * Readiness is determined by checking whether all parent stages have
 * materialized artifacts in the store. A node is ready when all
 * parents are complete (or skipped with sentinels).
 *
 * @property nodeId - Stage ID
 * @property ready - Whether all parents are satisfied
 * @property complete - Whether this stage's own artifact exists
 * @property stale - Whether a parent's fingerprint has changed since this stage ran
 * @property pendingParents - Parent IDs that are not yet complete
 */
export interface NodeReadiness {
    nodeId: string;
    ready: boolean;
    complete: boolean;
    stale: boolean;
    pendingParents: string[];
}

// ─── Workflow Position ──────────────────────────────────────────

/**
 * The resolved position within a workflow DAG.
 *
 * This is the primary output consumed by CalypsoCore and other
 * consumers. It answers "where are we?" and "what comes next?" by
 * combining the manifest topology with the session's materialized
 * state. Computed fresh on every query — never cached.
 *
 * @property completedStages - Stage IDs that have materialized artifacts
 * @property currentStage - The first ready-but-incomplete stage (null if workflow complete)
 * @property nextInstruction - The current stage's instruction text (null if complete)
 * @property availableCommands - The current stage's available commands (empty if complete)
 * @property staleStages - Stages whose parent fingerprints have changed
 * @property allReadiness - Full readiness state for every node in the DAG
 * @property progress - Summary for display
 * @property isComplete - Whether all stages (including terminal) have artifacts
 */
export interface WorkflowPosition {
    completedStages: string[];
    currentStage: DAGNode | null;
    nextInstruction: string | null;
    availableCommands: string[];
    staleStages: string[];
    allReadiness: NodeReadiness[];
    progress: {
        completed: number;
        total: number;
        phase: string | null;
    };
    isComplete: boolean;
}
