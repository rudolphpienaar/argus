/**
 * @file Workflow Adapter
 *
 * CalypsoCore-facing API that wraps the DAG engine. Replaces the old
 * WorkflowEngine static class with manifest-driven workflow resolution.
 *
 * The adapter owns:
 * - The parsed DAGDefinition (from YAML manifest)
 * - Skip-count state (in-memory, same as old WorkflowState)
 *
 * @module dag/bridge
 * @see docs/dag-engine.adoc
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import type { DAGDefinition, DAGNode, WorkflowPosition, ManifestHeader, NodeReadiness } from '../graph/types.js';
import type { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import type { FileNode } from '../../vfs/types.js';
import { manifest_parse } from '../graph/parser/manifest.js';
import { dag_resolve, position_resolve } from '../graph/resolver.js';
import { chain_validate } from '../fingerprint/chain.js';
import type { FingerprintRecord, ChainValidationResult, StalenessResult } from '../fingerprint/types.js';
import { sessionPaths_compute, type StagePath } from './SessionPaths.js';
import type { ArtifactEnvelope } from '../store/types.js';
import { dagBoxGraphviz_render, type DagBoxNodeInput, type DagBoxEdgeInput } from '../visualizer/graphvizBox.js';
import { DagRenderer } from '../visualizer/DagRenderer.js';

// ─── Protocol-Facing Types ─────────────────────────────────────

/**
 * Result of a recursive artifact search.
 */
interface ArtifactSearchResult {
    timestamp: string;
    fingerprint: string;
    parentFingerprints: Record<string, string>;
    stageId: string;
    path: string;
    materialized?: string[];
    envelope?: ArtifactEnvelope;
}

/**
 * Workflow summary for selection UI and APIs.
 * Matches the old WorkflowSummary shape for backward compatibility.
 */
export interface WorkflowSummary {
    id: string;
    name: string;
    persona: string;
    description: string;
    stageCount: number;
}

/**
 * Result of a workflow transition check.
 * Matches the old TransitionResult shape for backward compatibility.
 */
export interface TransitionResult {
    allowed: boolean;
    warning: string | null;
    reason: string | null;
    suggestion: string | null;
    skipCount: number;
    hardBlock: boolean;
    skippedStageId: string | null;
    staleBlock: boolean;
    /** v10.2.1: Optional parent IDs pending resolution at a JOIN point. */
    pendingOptionals?: string[];
    /** v10.2.1: True when all pending parents are optional and can be auto-declined. */
    autoDeclinable?: boolean;
}

/**
 * Rendering options for DAG visualization output.
 */
export interface DagRenderOptions {
    /** Include structural nodes (join/pre_* helpers) in the output. */
    includeStructural?: boolean;
    /** Include optional nodes in the output. */
    includeOptional?: boolean;
    /** Emit compact one-line-per-node output instead of tree form. */
    compact?: boolean;
    /** Highlight the current position marker. */
    showWhere?: boolean;
    /** Annotate stale nodes based on Merkle validation. */
    showStale?: boolean;
    /** Render boxed glyph nodes with explicit branch/join edge lists. */
    box?: boolean;
}

// ─── Manifest Registry ─────────────────────────────────────────

interface ManifestEntry {
    yamlPath: string;
}

/**
 * Resolve a path relative to this module's directory.
 *
 * @param relativePath - Path relative to the compiled module location.
 * @returns Absolute resolved path.
 */
function modulePath_resolve(relativePath: string): string {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    return resolve(__dirname, relativePath);
}

/** Registry of available workflow manifests (scanned on demand). */
let MANIFEST_CACHE: Record<string, ManifestEntry> | null = null;

/**
 * Scan the manifests directory and return the registry of available workflows.
 * Results are cached in memory after the first scan.
 *
 * @returns Map of workflow ID → ManifestEntry with YAML path.
 */
function manifestRegistry_get(): Record<string, ManifestEntry> {
    if (MANIFEST_CACHE) {
        return MANIFEST_CACHE;
    }

    const registry: Record<string, ManifestEntry> = {};
    const manifestsDir = modulePath_resolve('../manifests');
    
    try {
        const files = readdirSync(manifestsDir);
        for (const file of files) {
            if (file.endsWith('.manifest.yaml')) {
                const id = file.replace('.manifest.yaml', '');
                registry[id] = {
                    yamlPath: resolve(manifestsDir, file)
                };
            }
        }
    } catch {
        // Fallback or empty if directory not found
    }

    MANIFEST_CACHE = registry;
    return registry;
}

// ─── WorkflowAdapter ───────────────────────────────────────────

/**
 * Manifest-driven workflow adapter for CalypsoCore.
 *
 * Replaces the old WorkflowEngine static class. Wraps the DAG engine's
 * resolver + skip-count state into a single API.
 */
export class WorkflowAdapter {
    readonly workflowId: string;
    private readonly definition: DAGDefinition;
    private skipCounts: Record<string, number> = {};

    /** Reverse index: command string → DAGNode. */
    private readonly commandIndex: Map<string, DAGNode>;
    /** Canonical declared command phrases from manifest (without placeholders). */
    private readonly declaredCommands: Set<string>;

    /** Topology-aware session tree paths for each stage. */
    private readonly _stagePaths: Map<string, StagePath>;

    private readonly renderer: DagRenderer;

    /**
     * @param workflowId - Workflow identifier (e.g. 'fedml', 'chris').
     * @param definition - Parsed DAGDefinition from the manifest.
     */
    constructor(workflowId: string, definition: DAGDefinition) {
        this.workflowId = workflowId;
        this.definition = definition;

        this._stagePaths = sessionPaths_compute(definition);

        const nodes: DAGNode[] = definition.orderedNodeIds.map(
            (id: string): DAGNode => definition.nodes.get(id)!,
        );
        const { index, declared } = this.commandIndex_build(nodes);
        this.commandIndex = index;
        this.declaredCommands = declared;
        this.renderer = new DagRenderer();
    }

    /**
     * Build the command → stage reverse index and declared command phrase set.
     *
     * Uses three passes over manifest-ordered nodes to establish priority:
     * 1. Multi-word exact phrases (highest precedence — never shadowed)
     * 2. Single-word commands that match their own stage ID
     * 3. Base-word fallbacks (only when not shadowed by a more-specific phrase)
     *
     * @param nodes - DAG nodes in manifest declaration order.
     * @returns Reverse command index and set of declared canonical phrases.
     */
    private commandIndex_build(nodes: DAGNode[]): { index: Map<string, DAGNode>; declared: Set<string> } {
        const index = new Map<string, DAGNode>();
        const declared = new Set<string>();

        // 1. First pass: Index EXACT multi-word specific commands.
        // These are highly specific and should always take precedence.
        for (const node of nodes) {
            for (const cmd of node.commands) {
                const canonicalFull = cmd.split(/[<\[]/)[0].toLowerCase().trim();
                if (canonicalFull) {
                    declared.add(canonicalFull);
                }
                if (canonicalFull.split(/\s+/).length > 1) {
                    if (!index.has(canonicalFull)) {
                        index.set(canonicalFull, node);
                    }
                }
            }
        }

        // 2. Second pass: Index single-word commands that match their stage ID.
        for (const node of nodes) {
            for (const cmd of node.commands) {
                const canonicalFull = cmd.split(/[<\[]/)[0].toLowerCase().trim();
                if (canonicalFull.split(/\s+/).length === 1) {
                    if (canonicalFull === node.id) {
                        index.set(canonicalFull, node);
                    }
                }
            }
        }

        // 3. Third pass: Index remaining commands as base-word fallbacks.
        for (const node of nodes) {
            for (const cmd of node.commands) {
                const baseCmd = cmd.split(/\s+/)[0].toLowerCase();
                if (baseCmd && !index.has(baseCmd)) {
                    // Check if this verb is a prefix of any OTHER stage's specific command
                    const isShadowed: boolean = Array.from(index.keys()).some((fullCmd: string): boolean => {
                        const parts: string[] = fullCmd.split(/\s+/);
                        return parts.length > 1 && parts[0] === baseCmd && index.get(fullCmd)!.id !== node.id;
                    });

                    if (!isShadowed) {
                        index.set(baseCmd, node);
                    }
                }
            }
        }

        return { index, declared };
    }

    // ─── Static Factory ────────────────────────────────────────

    /**
     * Load a workflow adapter by ID from the manifest registry.
     *
     * @param workflowId - Workflow identifier (e.g. 'fedml', 'chris')
     * @returns Configured WorkflowAdapter instance
     * @throws If workflow not found in registry
     */
    static definition_load(workflowId: string): WorkflowAdapter {
        const registry = manifestRegistry_get();
        const entry = registry[workflowId];
        if (!entry) {
            const available = Object.keys(registry).join(', ');
            throw new Error(`Workflow '${workflowId}' not found. Available: ${available}`);
        }

        const yaml = readFileSync(entry.yamlPath, 'utf-8');
        const definition = manifest_parse(yaml);
        WorkflowAdapter.handlers_validate(definition);

        return new WorkflowAdapter(workflowId, definition);
    }

    /**
     * Validate that all declared stage handlers resolve to plugin modules.
     *
     * @param definition - The parsed DAG definition to validate.
     * @throws If any stage handler cannot be resolved to a plugin module.
     */
    private static handlers_validate(definition: DAGDefinition): void {
        const missingHandlers: string[] = [];

        for (const node of definition.nodes.values()) {
            if (!node.handler) continue;
            if (!WorkflowAdapter.pluginModule_exists(node.handler)) {
                missingHandlers.push(node.handler);
            }
        }

        if (missingHandlers.length > 0) {
            const uniqueMissing: string[] = Array.from(new Set(missingHandlers)).sort();
            throw new Error(`Workflow manifest references missing plugins: ${uniqueMissing.join(', ')}`);
        }
    }

    /**
     * Check if a plugin module file exists for a handler name.
     *
     * @param handlerName - Handler identifier declared in the manifest.
     * @returns True if a .ts or .js plugin module file exists for this handler.
     */
    private static pluginModule_exists(handlerName: string): boolean {
        const pluginsDir = modulePath_resolve('../../plugins');
        const tsPath = resolve(pluginsDir, `${handlerName}.ts`);
        const jsPath = resolve(pluginsDir, `${handlerName}.js`);
        return existsSync(tsPath) || existsSync(jsPath);
    }

    /**
     * Get summaries of all available workflows.
     *
     * @returns Array of WorkflowSummary records, one per parseable manifest.
     */
    static workflows_summarize(): WorkflowSummary[] {
        const summaries: WorkflowSummary[] = [];
        const registry = manifestRegistry_get();

        for (const [id, entry] of Object.entries(registry)) {
            try {
                const yaml = readFileSync(entry.yamlPath, 'utf-8');
                const def = manifest_parse(yaml);
                const header = def.header as ManifestHeader;
                summaries.push({
                    id,
                    name: header.name,
                    persona: header.persona,
                    description: header.description.split('\n')[0],
                    stageCount: def.nodes.size,
                });
            } catch {
                // Skip manifests that fail to parse
            }
        }

        return summaries;
    }

    /**
     * Get all available workflow IDs.
     *
     * @returns Array of workflow ID strings (e.g. ['fedml', 'chris']).
     */
    static workflows_list(): string[] {
        return Object.keys(manifestRegistry_get());
    }

    // ─── Position Resolution ───────────────────────────────────

    /**
     * Resolve the current workflow position.
     *
     * This is the primary query — replaces the old separate calls to
     * `stages_completed()` + `stage_next()`.
     *
     * @param vfs - VirtualFileSystem for completion checks
     * @param sessionPath - Active session path (e.g. /home/user/sessions/fedml/session-xxx)
     * @returns WorkflowPosition describing "where are we?"
     */
    position_resolve(vfs: VirtualFileSystem, sessionPath: string): WorkflowPosition {
        const completedIds: Set<string> = this.completedIds_resolve(vfs, sessionPath);
        const staleIds: Set<string> = this.staleIds_resolve(vfs, sessionPath);

        return position_resolve(this.definition, completedIds, staleIds);
    }

    /**
     * Find the latest materialized fingerprint record for a stage within a session.
     *
     * @param vfs - VirtualFileSystem
     * @param sessionPath - Project-relative data path (e.g. /home/user/projects/my-proj/data)
     * @param stageId - The stage ID to look up
     * @returns The latest fingerprint record, or null if never materialized
     */
    public latestFingerprint_get(
        vfs: VirtualFileSystem,
        sessionPath: string,
        stageId: string
    ): FingerprintRecord | null {
        // Each stage checks its own artifact.
        const targetId: string = stageId;

        // Search the session tree for the latest artifact matching this stage.
        // The recursive search handles both topology-aware and join-materialized layouts.
        const all: ArtifactSearchResult[] = this.artifacts_find(vfs, sessionPath, targetId);

        if (all.length === 0) {
            return null;
        }

        // Sort by timestamp descending to find the latest
        all.sort((a: ArtifactSearchResult, b: ArtifactSearchResult): number => b.timestamp.localeCompare(a.timestamp));
        const latest: ArtifactSearchResult = all[0];

        return {
            fingerprint: latest.fingerprint,
            parentFingerprints: latest.parentFingerprints,
        };
    }

    /**
     * Find the latest full artifact envelope for a stage.
     */
    public latestArtifact_get(
        vfs: VirtualFileSystem,
        sessionPath: string,
        stageId: string
    ): ArtifactEnvelope | null {
        // Search the session tree for the latest artifact produced by this exact stage.
        const all: ArtifactSearchResult[] = this.artifacts_find(vfs, sessionPath, stageId);

        if (all.length === 0) {
            return null;
        }

        all.sort((a: ArtifactSearchResult, b: ArtifactSearchResult): number => b.timestamp.localeCompare(a.timestamp));
        return all[0].envelope || null;
    }

    /**
     * Search the VFS session tree recursively for artifacts matching a stage ID.
     */
    private artifacts_find(vfs: VirtualFileSystem, path: string, stageId: string): ArtifactSearchResult[] {
        const results: ArtifactSearchResult[] = [];
        try {
            const stats = vfs.node_lstat(path);
            if (stats && stats.type === 'link') {
                return results;
            }

            const nodes: FileNode[] = vfs.dir_list(path);
            
            // v12.0: Check for meta/ directory at this level
            const metaDir = nodes.find(n => n.name === 'meta' && n.type === 'folder');
            if (metaDir) {
                const metaFiles = vfs.dir_list(metaDir.path);
                for (const file of metaFiles) {
                    if (file.name.endsWith('.json')) {
                        const rec: ArtifactSearchResult | null = this.fingerprintRecord_read(vfs, file.path);
                        if (rec && rec.stageId === stageId) {
                            results.push(rec);
                        }
                    }
                }
            }

            // Fallback: Check the stage root itself for the json (compatibility)
            for (const node of nodes) {
                if (node.type === 'file' && node.name.endsWith('.json')) {
                    const rec: ArtifactSearchResult | null = this.fingerprintRecord_read(vfs, node.path);
                    if (rec && rec.stageId === stageId) {
                        results.push(rec);
                    }
                }
            }

            // Recurse into children (but skip system-owned input/output/meta already processed)
            for (const node of nodes) {
                if (node.type === 'folder' && !['meta', 'input', 'output'].includes(node.name)) {
                    results.push(...this.artifacts_find(vfs, node.path, stageId));
                }
            }
        } catch { /* ignore */ }
        return results;
    }

    /**
     * Read a fingerprint record from a materialized artifact.
     */
    private fingerprintRecord_read(vfs: VirtualFileSystem, path: string): ArtifactSearchResult | null {
        try {
            const raw: string | null = vfs.node_read(path);
            if (!raw) {
                return null;
            }
            const envelope: ArtifactEnvelope = JSON.parse(raw);
            if (!envelope._fingerprint || !envelope._parent_fingerprints) {
                return null;
            }

            return {
                stageId: envelope.stage,
                timestamp: envelope.timestamp,
                fingerprint: envelope._fingerprint,
                parentFingerprints: envelope._parent_fingerprints,
                path,
                materialized: envelope.materialized,
                envelope: {
                    ...envelope,
                    _physical_path: path
                },
            };
        } catch {
            return null;
        }
    }

    // ─── Transition Check ──────────────────────────────────────

    /**
     * Check if a command transition is allowed based on workflow state.
     *
     * @param command - Command being attempted (e.g. 'harmonize', 'show container')
     * @param vfs - VirtualFileSystem for completion checks
     * @param sessionPath - Active session path
     * @returns TransitionResult with allowed status and warnings
     */
    transition_check(
        command: string,
        vfs: VirtualFileSystem,
        sessionPath: string,
    ): TransitionResult {
        const targetNode: DAGNode | undefined = this.transitionTarget_resolve(command);
        if (!targetNode) {
            return WorkflowAdapter.result_allowed();
        }

        const completedIds: Set<string> = this.completedIds_resolve(vfs, sessionPath);
        const staleIds: Set<string> = this.staleIds_resolve(vfs, sessionPath);

        if (this.transition_isFreshComplete(targetNode, completedIds, staleIds)) {
            return WorkflowAdapter.result_allowed();
        }

        // Propagate stale detection through structural nodes to find user-facing stale ancestors.
        const staleBlock: TransitionResult | null = this.transitionStaleBlock_resolve(targetNode, staleIds);
        if (staleBlock) {
            return staleBlock;
        }

        // Use structural-promoted set so structural nodes are transparent to readiness.
        const effectiveCompleted: Set<string> = this.structuralCompletion_resolve(completedIds);
        const nodeReadiness: NodeReadiness | null = this.transitionReadiness_resolve(targetNode, effectiveCompleted);
        if (!nodeReadiness || nodeReadiness.pendingParents.length === 0) {
            return WorkflowAdapter.result_allowed();
        }

        // Expand structural pending parents to their user-facing equivalents.
        const userFacingPending: string[] = this.userFacingPendingParents_resolve(
            nodeReadiness.pendingParents,
            effectiveCompleted,
        );

        const parentBlock: TransitionResult | null = this.transitionPendingParentBlock_resolve(userFacingPending);
        if (parentBlock) {
            return parentBlock;
        }

        return WorkflowAdapter.result_allowed();
    }

    /**
     * Resolve the target DAGNode for a command string.
     *
     * @param command - Command string being attempted.
     * @returns The target DAGNode, or undefined if the command is not workflow-routed.
     */
    private transitionTarget_resolve(command: string): DAGNode | undefined {
        const baseCmd: string = command.split(/\s+/)[0].toLowerCase();
        return this.commandIndex.get(baseCmd);
    }

    /**
     * Check if the target stage is already freshly complete (completed and not stale).
     *
     * @param targetNode - The stage being targeted by the transition.
     * @param completedIds - Set of all completed stage IDs.
     * @param staleIds - Set of all stale stage IDs.
     * @returns True if the stage is complete and not stale.
     */
    private transition_isFreshComplete(
        targetNode: DAGNode,
        completedIds: Set<string>,
        staleIds: Set<string>,
    ): boolean {
        return completedIds.has(targetNode.id) && !staleIds.has(targetNode.id);
    }

    /**
     * Auto-promote structural stages when all their dependencies are met.
     * Structural nodes are invisible to the user and should never block transitions.
     *
     * @param completedIds - Set of actually materialized stage IDs.
     * @returns Expanded completed set with structural stages auto-promoted.
     */
    private structuralCompletion_resolve(completedIds: Set<string>): Set<string> {
        const effective = new Set(completedIds);
        let changed = true;

        while (changed) {
            changed = false;
            for (const node of this.definition.nodes.values()) {
                if (!node.structural || effective.has(node.id)) continue;

                const allParentsMet =
                    !node.previous || node.previous.every((pid: string) => effective.has(pid));

                if (allParentsMet) {
                    effective.add(node.id);
                    changed = true;
                }
            }
        }

        return effective;
    }

    /**
     * Expand structural pending parents to their user-facing equivalents.
     * Traverses through structural nodes to find the real user-visible pending ancestors.
     *
     * @param pendingParentIds - IDs of pending parents from the readiness check.
     * @param effectiveCompleted - Set of completed IDs after structural auto-promotion.
     * @returns Array of user-facing (non-structural) pending parent stage IDs.
     */
    private userFacingPendingParents_resolve(
        pendingParentIds: string[],
        effectiveCompleted: Set<string>,
    ): string[] {
        const result: string[] = [];
        const visited = new Set<string>();

        const expand = (parentId: string): void => {
            if (visited.has(parentId)) return;
            visited.add(parentId);

            const node: DAGNode | undefined = this.definition.nodes.get(parentId);
            if (!node) return;

            if (!node.structural) {
                result.push(parentId);
                return;
            }

            // Structural: expand its own pending parents recursively.
            for (const grandParentId of (node.previous ?? [])) {
                if (!effectiveCompleted.has(grandParentId)) {
                    expand(grandParentId);
                }
            }
        };

        for (const parentId of pendingParentIds) {
            expand(parentId);
        }

        return result;
    }

    /**
     * Find a stale user-facing ancestor by traversing through structural nodes.
     * Structural nodes are transparent — the stale signal propagates through them.
     *
     * @param node - The starting node (transition target) to inspect.
     * @param staleIds - Set of stale stage IDs.
     * @param visited - Cycle-prevention set (pass `new Set<string>()`).
     * @returns The nearest stale user-facing ancestor, or null if none.
     */
    private staleUserFacingAncestor_find(
        node: DAGNode,
        staleIds: Set<string>,
        visited: Set<string>,
    ): DAGNode | null {
        if (visited.has(node.id)) return null;
        visited.add(node.id);

        for (const parentId of (node.previous ?? [])) {
            if (staleIds.has(parentId)) {
                const parentNode: DAGNode | undefined = this.definition.nodes.get(parentId);
                if (parentNode && !parentNode.structural) {
                    return parentNode;
                }
            }
            // Recurse into structural parents to find the underlying stale user-facing stage.
            const parentNode: DAGNode | undefined = this.definition.nodes.get(parentId);
            if (parentNode) {
                const staleAncestor = this.staleUserFacingAncestor_find(parentNode, staleIds, visited);
                if (staleAncestor) return staleAncestor;
            }
        }

        return null;
    }

    /**
     * Build a stale-block TransitionResult if any upstream stage is stale.
     *
     * @param targetNode - The DAGNode being transitioned to.
     * @param staleIds - Set of currently stale stage IDs.
     * @returns A hard-blocked TransitionResult, or null if no stale ancestors.
     */
    private transitionStaleBlock_resolve(
        targetNode: DAGNode,
        staleIds: Set<string>,
    ): TransitionResult | null {
        const staleAncestor: DAGNode | null = this.staleUserFacingAncestor_find(
            targetNode,
            staleIds,
            new Set<string>(),
        );
        if (!staleAncestor) {
            return null;
        }

        const staleParentName: string = staleAncestor.name;
        const staleParentCmd: string = staleAncestor.commands?.[0] ?? staleAncestor.id;

        return {
            allowed: false,
            warning: `STALE PREREQUISITE: ${staleParentName.toUpperCase()}`,
            reason: `The '${staleParentName}' stage changed after this path was previously executed.`,
            suggestion: `Re-run '${staleParentCmd}' before continuing.`,
            skipCount: 0,
            hardBlock: true,
            skippedStageId: null,
            staleBlock: true,
        };
    }

    /**
     * Resolve the NodeReadiness record for the transition target.
     *
     * @param targetNode - The DAGNode being transitioned to.
     * @param completedIds - Set of completed stage IDs (after structural promotion).
     * @returns NodeReadiness for the target, or null if the node is not found.
     */
    private transitionReadiness_resolve(
        targetNode: DAGNode,
        completedIds: Set<string>,
    ): NodeReadiness | null {
        const readiness: NodeReadiness[] = dag_resolve(this.definition, completedIds);
        const nodeReadiness: NodeReadiness | undefined = readiness.find(
            (r: NodeReadiness): boolean => r.nodeId === targetNode.id,
        );
        return nodeReadiness ?? null;
    }

    /**
     * Evaluate pending parents and return a block result if any are non-optional.
     * For auto-declinable optionals, returns a soft block with `autoDeclinable: true`.
     *
     * @param userFacingPendingIds - User-facing pending parent stage IDs.
     * @returns A TransitionResult block, or null if all parents can be auto-declined.
     */
    private transitionPendingParentBlock_resolve(
        userFacingPendingIds: string[],
    ): TransitionResult | null {
        const pendingOptionals: string[] = [];

        for (const parentId of userFacingPendingIds) {
            const parentNode: DAGNode | undefined = this.definition.nodes.get(parentId);
            if (!parentNode) {
                continue;
            }
            if (!parentNode.optional && !parentNode.skip_warning) {
                return this.transitionHardBlock_create(parentNode);
            }
            if (parentNode.skip_warning) {
                const warningBlock: TransitionResult | null = this.transitionSkipWarningBlock_resolve(parentNode);
                if (warningBlock) {
                    return warningBlock;
                }
            }
            // v10.2.1: Optional parents without skip_warning are auto-declinable.
            if (parentNode.optional && !parentNode.skip_warning) {
                pendingOptionals.push(parentId);
            }
        }

        // v10.2.1: If only auto-declinable optionals remain, signal to caller
        if (pendingOptionals.length > 0) {
            return {
                allowed: false,
                warning: null,
                reason: null,
                suggestion: null,
                skipCount: 0,
                hardBlock: false,
                skippedStageId: null,
                staleBlock: false,
                pendingOptionals,
                autoDeclinable: true,
            };
        }

        return null;
    }

    /**
     * Build a hard-blocked TransitionResult for a missing required prerequisite.
     *
     * @param parentNode - The required stage that has not been completed.
     * @returns Hard-blocked TransitionResult with prerequisite details.
     */
    private transitionHardBlock_create(parentNode: DAGNode): TransitionResult {
        return {
            allowed: false,
            warning: `PREREQUISITE NOT MET: ${parentNode.name.toUpperCase()}`,
            reason: `This action requires completion of the '${parentNode.name}' stage.`,
            suggestion: parentNode.commands.length > 0
                ? `Run '${parentNode.commands[0]}' to proceed.`
                : 'Complete the previous stage first.',
            skipCount: 0,
            hardBlock: true,
            skippedStageId: parentNode.id,
            staleBlock: false,
        };
    }

    /**
     * Build a skip-warning TransitionResult if the warning threshold has not been reached.
     *
     * @param parentNode - The optional stage with a skip_warning configuration.
     * @returns Soft-blocked TransitionResult, or null if max warnings already shown.
     */
    private transitionSkipWarningBlock_resolve(parentNode: DAGNode): TransitionResult | null {
        if (!parentNode.skip_warning) {
            return null;
        }
        const skipCount: number = this.skipCounts[parentNode.id] || 0;
        const maxWarnings: number = parentNode.skip_warning.max_warnings;
        if (skipCount >= maxWarnings) {
            return null;
        }
        const isSecondWarning: boolean = skipCount >= 1;
        const suggestion: string | null = parentNode.commands.length > 0
            ? `Run '${parentNode.commands[0]}' to complete this step.`
            : null;
        return {
            allowed: false,
            warning: parentNode.skip_warning.short,
            reason: isSecondWarning ? parentNode.skip_warning.reason : null,
            suggestion,
            skipCount,
            hardBlock: false,
            skippedStageId: parentNode.id,
            staleBlock: false,
        };
    }

    // ─── Command → Stage Lookup ────────────────────────────────

    /**
     * Find which stage handles a given command.
     *
     * @param command - Command string (e.g. 'harmonize', 'show container')
     * @returns The DAGNode, or null if no stage handles this command
     */
    stage_forCommand(command: string): DAGNode | null {
        const trimmed = command.trim().toLowerCase();
        
        // 1. Try exact match for the full string (e.g. "show container")
        const fullMatch = this.commandIndex.get(trimmed);
        if (fullMatch) return fullMatch;

        // 2. Fallback to base command (first word)
        const baseCmd = trimmed.split(/\s+/)[0];
        return this.commandIndex.get(baseCmd) ?? null;
    }

    /**
     * Return true when input is an explicit manifest-declared command phrase.
     *
     * Accepts exact phrase matches (e.g. "harmonize", "show container")
     * and argument-bearing invocations whose prefix matches a declared phrase
     * (e.g. "config name oracle-app" for declared "config name").
     */
    public commandDeclared_isExplicit(input: string): boolean {
        const trimmed: string = input.trim().toLowerCase();
        if (!trimmed) return false;

        for (const phrase of this.declaredCommands) {
            if (trimmed === phrase) return true;
            if (trimmed.startsWith(`${phrase} `)) return true;
        }
        return false;
    }

    /**
     * List canonical workflow command verbs declared by the manifest.
     *
     * Verbs are resolved from stage command declarations, preserving first-seen
     * manifest order.
     */
    public commandVerbs_list(): string[] {
        const verbs: string[] = [];
        const seen: Set<string> = new Set<string>();

        for (const stageId of this.definition.orderedNodeIds) {
            const node: DAGNode | undefined = this.definition.nodes.get(stageId);
            if (!node) continue;

            for (const cmd of node.commands) {
                const canonical: string = cmd.split(/[<\[]/)[0].toLowerCase().trim();
                const base: string = canonical.split(/\s+/)[0];
                if (!base || seen.has(base)) continue;
                seen.add(base);
                verbs.push(base);
            }
        }

        return verbs;
    }

    /**
     * Find a stage by ID or name.
     *
     * @param stageRef - Stage ID or partial name
     * @returns The DAGNode, or undefined if not found
     */
    public stage_find(stageRef: string): DAGNode | undefined {
        const idMatch = this.definition.nodes.get(stageRef);
        if (idMatch) return idMatch;

        const lowerRef = stageRef.toLowerCase();
        return Array.from(this.definition.nodes.values()).find(
            (node: DAGNode): boolean => node.name.toLowerCase().includes(lowerRef)
        );
    }

    // ─── Skip Management ───────────────────────────────────────

    /**
     * Increment skip counter for a stage.
     * Called when user proceeds despite a warning.
     *
     * @param stageId - The stage ID whose skip counter to increment.
     * @returns The new skip count after incrementing.
     */
    skip_increment(stageId: string): number {
        const current = this.skipCounts[stageId] || 0;
        this.skipCounts[stageId] = current + 1;
        return this.skipCounts[stageId];
    }

    /**
     * Clear skip counter for a stage (called when stage completes).
     *
     * @param stageId - The stage ID whose skip counter to reset.
     */
    stage_complete(stageId: string): void {
        delete this.skipCounts[stageId];
    }

    // ─── Progress ──────────────────────────────────────────────

    /**
     * Get a human-readable workflow progress summary.
     *
     * @param vfs - VirtualFileSystem for completion checks.
     * @param sessionPath - Active session path.
     * @returns Multi-line human-readable progress string.
     */
    progress_summarize(vfs: VirtualFileSystem, sessionPath: string): string {
        const pos = this.position_resolve(vfs, sessionPath);
        const header = this.definition.header as ManifestHeader;

        let summary = `Workflow: ${header.name}\n`;
        summary += `Progress: ${pos.progress.completed}/${pos.progress.total} stages\n\n`;

        for (const node of this.definition.nodes.values()) {
            // Skip structural nodes — they are transparent to the user.
            if (node.structural) continue;

            const isComplete = pos.completedStages.includes(node.id);
            const isStale = pos.staleStages.includes(node.id);

            // Marker: ● Complete, ○ Incomplete, * Stale
            const marker = isStale ? '*' : (isComplete ? '●' : '○');
            const status = isStale ? ' [STALE]' : '';
            summary += `  ${marker} ${node.name}${status}`;
            if (pos.currentStage?.id === node.id) {
                summary += ' ← NEXT';
            }
            summary += '\n';
        }

        return summary;
    }

    /**
     * Render the active manifest DAG as a box-glyph tree with optional status overlays.
     *
     * The visual uses primary-parent lineage for single placement while preserving
     * join metadata in node annotations (`join:a+b+...`).
     *
     * @param vfs - VirtualFileSystem for completion/staleness overlays.
     * @param sessionPath - Active session path for position resolution.
     * @param options - Rendering controls.
     * @returns Multi-line DAG visualization.
     */
    public dag_render(
        vfs: VirtualFileSystem,
        sessionPath: string,
        options: DagRenderOptions = {},
    ): string {
        const position = this.position_resolve(vfs, sessionPath);
        
        return this.renderer.dag_render(options, {
            vfs,
            sessionPath,
            definition: this.definition,
            position,
            workflowId: this.workflowId,
            displayParents_resolve: (node, visibleSet) => {
                const includeStructural = options.includeStructural !== false;
                const includeOptional = options.includeOptional !== false;
                return this.displayParents_resolve(node, visibleSet, includeStructural, includeOptional);
            }
        });
    }

    // ─── Access ────────────────────────────────────────────────

    /** Get the underlying DAG definition. */
    get dag(): DAGDefinition {
        return this.definition;
    }

    /** Get the topology-aware session tree paths. */
    get stagePaths(): Map<string, StagePath> {
        return this._stagePaths;
    }

    // ─── Private ───────────────────────────────────────────────

    /**
     * Create an allowed TransitionResult (all fields set to permissive defaults).
     *
     * @returns TransitionResult with allowed=true and all block flags false.
     */
    private static result_allowed(): TransitionResult {
        return {
            allowed: true,
            warning: null,
            reason: null,
            suggestion: null,
            skipCount: 0,
            hardBlock: false,
            skippedStageId: null,
            staleBlock: false,
        };
    }

    /**
     * Resolve the visible display parent for a node using primary lineage.
     *
     * If the direct primary parent is filtered out, this walks up primary ancestry
     * until a visible ancestor is found, making filtered nodes path-transparent in
     * the visual output.
     */
    private displayParents_resolve(
        node: DAGNode,
        visibleSet: Set<string>,
        includeStructural: boolean,
        includeOptional: boolean,
    ): string[] {
        if (!node.previous || node.previous.length === 0) {
            return [];
        }

        const all: Set<string> = new Set<string>();
        for (const parentId of node.previous) {
            const ancestors: string[] = this.visibleAncestors_resolve(
                parentId,
                visibleSet,
                includeStructural,
                includeOptional,
                new Set<string>(),
            );
            for (const ancestorId of ancestors) {
                all.add(ancestorId);
            }
        }
        return Array.from(all);
    }

    /**
     * Resolve visible ancestors for a potentially filtered parent node.
     *
     * Traverses through hidden parents (structural/optional filtered out) until
     * visible node IDs are reached.
     */
    private visibleAncestors_resolve(
        nodeId: string,
        visibleSet: Set<string>,
        includeStructural: boolean,
        includeOptional: boolean,
        visited: Set<string>,
    ): string[] {
        if (visited.has(nodeId)) return [];
        visited.add(nodeId);

        if (visibleSet.has(nodeId)) {
            return [nodeId];
        }

        const node: DAGNode | undefined = this.definition.nodes.get(nodeId);
        if (!node || !node.previous || node.previous.length === 0) {
            return [];
        }

        const hiddenByFilter: boolean =
            (!includeStructural && Boolean(node.structural)) ||
            (!includeOptional && Boolean(node.optional));
        if (!hiddenByFilter) {
            return [];
        }

        const ancestors: Set<string> = new Set<string>();
        for (const parentId of node.previous) {
            const parentAncestors = this.visibleAncestors_resolve(
                parentId,
                visibleSet,
                includeStructural,
                includeOptional,
                visited,
            );
            for (const ancestorId of parentAncestors) {
                ancestors.add(ancestorId);
            }
        }
        return Array.from(ancestors);
    }

    /**
     * Resolve the set of completed stage IDs by probing the session tree.
     *
     * @param vfs - VirtualFileSystem for artifact lookups.
     * @param sessionPath - Active session path.
     * @returns Set of stage IDs that have a materialized artifact.
     */
    private completedIds_resolve(
        vfs: VirtualFileSystem,
        sessionPath: string,
    ): Set<string> {
        const completedIds: Set<string> = new Set<string>();

        // Use latestFingerprint_get so completion works across
        // legacy and join-materialized layouts.
        for (const stageId of this.definition.nodes.keys()) {
            if (this.latestFingerprint_get(vfs, sessionPath, stageId)) {
                completedIds.add(stageId);
            }
        }

        return completedIds;
    }

    /**
     * Resolve the set of stale stage IDs via Merkle chain validation.
     *
     * @param vfs - VirtualFileSystem for fingerprint lookups.
     * @param sessionPath - Active session path.
     * @returns Set of stage IDs whose fingerprint chain is broken.
     */
    private staleIds_resolve(
        vfs: VirtualFileSystem,
        sessionPath: string,
    ): Set<string> {
        const artifactReader: (stageId: string) => FingerprintRecord | null = (stageId: string): FingerprintRecord | null => {
            return this.latestFingerprint_get(vfs, sessionPath, stageId);
        };

        const validation: ChainValidationResult = chain_validate(this.definition, artifactReader);
        return new Set(validation.staleStages.map((s: StalenessResult): string => s.stageId));
    }
}
