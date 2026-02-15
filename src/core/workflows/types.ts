/**
 * @file Workflow Type Re-exports
 *
 * Protocol-facing types that survive the migration from WorkflowEngine
 * to the manifest-driven DAG engine. Re-exported from the bridge layer.
 *
 * @module
 * @see src/dag/bridge/WorkflowAdapter.ts
 */

export type { WorkflowSummary, TransitionResult } from '../../dag/bridge/WorkflowAdapter.js';
