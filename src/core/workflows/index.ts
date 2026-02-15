/**
 * @file Workflows Module Index
 *
 * Re-exports protocol-facing workflow types from the DAG bridge layer.
 * The old WorkflowEngine, definitions, and runtime types have been
 * replaced by the manifest-driven DAG engine.
 *
 * @module
 * @see src/dag/bridge/
 */

export type { WorkflowSummary, TransitionResult } from './types.js';
