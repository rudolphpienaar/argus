/**
 * @file Workflow Adapter
 *
 * CalypsoCore-facing API that wraps the DAG engine. Replaces the old
 * WorkflowEngine static class with manifest-driven workflow resolution.
 *
 * The adapter owns:
 * - The parsed DAGDefinition (from YAML manifest)
 * - The CompletionMapper (VFS → stage completion)
 * - Skip-count state (in-memory, same as old WorkflowState)
 *
 * @module dag/bridge
 * @see docs/dag-engine.adoc
 */

import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import type { DAGDefinition, DAGNode, WorkflowPosition, ManifestHeader, NodeReadiness } from '../graph/types.js';
import type { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import type { FileNode } from '../../vfs/types.js';
import { manifest_parse } from '../graph/parser/manifest.js';
import { dag_resolve, position_resolve } from '../graph/resolver.js';
import { manifestMapper_create } from './CompletionMapper.js';
import { chain_validate } from '../fingerprint/chain.js';
import type { FingerprintRecord, ChainValidationResult, StalenessResult } from '../fingerprint/types.js';
import { sessionPaths_compute, type StagePath } from './SessionPaths.js';
import type { CompletionMapper } from './CompletionMapper.js';
import type { ArtifactEnvelope } from '../store/types.js';

// ─── Protocol-Facing Types ─────────────────────────────────────

/**
 * Result of a recursive artifact search.
 */
interface ArtifactSearchResult {
    timestamp: string;
    fingerprint: string;
    parentFingerprints: Record<string, string>;
    stageId: string;
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
}

// ─── Manifest Registry ─────────────────────────────────────────

interface ManifestEntry {
    yamlPath: string;
}

/** Resolve path relative to this module's directory. */
function modulePath_resolve(relativePath: string): string {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    return resolve(__dirname, relativePath);
}

/** Registry of available workflow manifests (scanned on demand). */
let MANIFEST_CACHE: Record<string, ManifestEntry> | null = null;

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
 * resolver + CompletionMapper + skip-count state into a single API.
 */
export class WorkflowAdapter {
    readonly workflowId: string;
    private readonly definition: DAGDefinition;
    private readonly mapper: CompletionMapper;
    private skipCounts: Record<string, number> = {};

    /** Reverse index: command string → DAGNode. */
    private readonly commandIndex: Map<string, DAGNode>;

    /** Topology-aware session tree paths for each stage. */
    private readonly _stagePaths: Map<string, StagePath>;

    constructor(workflowId: string, definition: DAGDefinition, mapper: CompletionMapper) {
        this.workflowId = workflowId;
        this.definition = definition;
        this.mapper = mapper;

        // Compute topology-aware session tree paths from DAG structure
        this._stagePaths = sessionPaths_compute(definition);

        // Build command → stage reverse index
        this.commandIndex = new Map();
        
        // Use orderedNodeIds to ensure we process stages in manifest order
        const nodes = definition.orderedNodeIds.map(id => definition.nodes.get(id)!);

        // 1. First pass: Index EXACT multi-word specific commands.
        // These are highly specific and should always take precedence.
        for (const node of nodes) {
            for (const cmd of node.commands) {
                const canonicalFull = cmd.split(/[<\[]/)[0].toLowerCase().trim();
                if (canonicalFull.split(/\s+/).length > 1) {
                    if (!this.commandIndex.has(canonicalFull)) {
                        this.commandIndex.set(canonicalFull, node);
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
                        this.commandIndex.set(canonicalFull, node);
                    }
                }
            }
        }

        // 3. PRIORITY OVERRIDE: Ensure 'search' always maps to the 'search' stage if it exists.
        const searchNode = definition.nodes.get('search');
        if (searchNode) {
            this.commandIndex.set('search', searchNode);
        }

        // 4. Fourth pass: Index remaining commands as base-word fallbacks.
        for (const node of nodes) {
            for (const cmd of node.commands) {
                const baseCmd = cmd.split(/\s+/)[0].toLowerCase();
                if (baseCmd && !this.commandIndex.has(baseCmd)) {
                    // Check if this verb is a prefix of any OTHER stage's specific command
                    const isShadowed = Array.from(this.commandIndex.keys()).some(fullCmd => {
                        const parts = fullCmd.split(/\s+/);
                        return parts.length > 1 && parts[0] === baseCmd && this.commandIndex.get(fullCmd)!.id !== node.id;
                    });

                    if (!isShadowed) {
                        this.commandIndex.set(baseCmd, node);
                    }
                }
            }
        }
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
        const pathMap = sessionPaths_compute(definition);
        const mapper = manifestMapper_create(definition, pathMap);

        return new WorkflowAdapter(workflowId, definition, mapper);
    }

    /**
     * Get summaries of all available workflows.
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
        const completedIds: Set<string> = new Set<string>();
        
        // Use branch-aware latestFingerprint_get for ALL stages to determine completion
        for (const stageId of this.definition.nodes.keys()) {
            if (this.latestFingerprint_get(vfs, sessionPath, stageId)) {
                completedIds.add(stageId);
            }
        }

        // Perform staleness detection across the DAG.
        const artifactReader: (stageId: string) => FingerprintRecord | null = (stageId: string): FingerprintRecord | null => {
            return this.latestFingerprint_get(vfs, sessionPath, stageId);
        };

        const validation: ChainValidationResult = chain_validate(this.definition, artifactReader);
        const staleIds: Set<string> = new Set(validation.staleStages.map((s: StalenessResult): string => s.stageId));

        return position_resolve(this.definition, completedIds, staleIds);
    }

    /**
     * Find the latest materialized fingerprint record for a stage within a session.
     *
     * @param vfs - VirtualFileSystem
     * @param sessionPath - Path to the session root
     * @param stageId - The stage ID to look up
     * @returns The latest fingerprint record, or null if never materialized
     */
    public latestFingerprint_get(
        vfs: VirtualFileSystem,
        sessionPath: string,
        stageId: string
    ): FingerprintRecord | null {
        const node: DAGNode | undefined = this.definition.nodes.get(stageId);
        const targetId: string = (node?.completes_with !== undefined && node.completes_with !== null)
            ? node.completes_with
            : stageId;

        // Deep search for all artifacts matching this stage ID
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
     * Search the VFS session tree recursively for artifacts matching a stage ID.
     */
    private artifacts_find(vfs: VirtualFileSystem, path: string, stageId: string): ArtifactSearchResult[] {
        const results: ArtifactSearchResult[] = [];
        try {
            const nodes: FileNode[] = vfs.dir_list(path);
            for (const node of nodes) {
                if (node.type === 'folder') {
                    results.push(...this.artifacts_find(vfs, node.path, stageId));
                } else if (node.name.endsWith('.json')) {
                    const rec: ArtifactSearchResult | null = this.fingerprintRecord_read(vfs, node.path);
                    if (rec && rec.stageId === stageId) {
                        results.push(rec);
                    }
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
        const baseCmd: string = command.split(/\s+/)[0].toLowerCase();
        const targetNode: DAGNode | undefined = this.commandIndex.get(baseCmd);

        // If command doesn't map to any stage, allow it (not workflow-controlled)
        if (!targetNode) {
            return WorkflowAdapter.result_allowed();
        }

        const completedIds: Set<string> = this.mapper.completedIds_resolve(vfs, sessionPath);

        // If target stage is already completed, allow
        if (completedIds.has(targetNode.id)) {
            return WorkflowAdapter.result_allowed();
        }

        // Check if all parents are complete
        const readiness: NodeReadiness[] = dag_resolve(this.definition, completedIds);
        const nodeReadiness: NodeReadiness | undefined = readiness.find(r => r.nodeId === targetNode.id);

        if (!nodeReadiness || nodeReadiness.pendingParents.length === 0) {
            return WorkflowAdapter.result_allowed();
        }

        // Check each blocking parent
        for (const parentId of nodeReadiness.pendingParents) {
            const parentNode: DAGNode | undefined = this.definition.nodes.get(parentId);
            
            if (!parentNode) {
                continue;
            }

            // If the parent is NOT optional and has NO skip warning, HARD BLOCK.
            // This prevents silent skipping of critical stages like Search and Gather.
            if (!parentNode.optional && !parentNode.skip_warning) {
                return {
                    allowed: false,
                    warning: `PREREQUISITE NOT MET: ${parentNode.name.toUpperCase()}`,
                    reason: `This action requires completion of the '${parentNode.name}' stage.`,
                    suggestion: parentNode.commands.length > 0 
                        ? `Run '${parentNode.commands[0]}' to proceed.` 
                        : 'Complete the previous stage first.',
                    skipCount: 0,
                    hardBlock: true,
                    skippedStageId: parentNode.id
                };
            }

            // If it has a skip warning, handle the soft-warning sequence
            if (parentNode.skip_warning) {
                const skipCount: number = this.skipCounts[parentNode.id] || 0;
                const maxWarnings: number = parentNode.skip_warning.max_warnings;

                // If warned enough times, allow
                if (skipCount >= maxWarnings) {
                    continue; // Check next parent
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
                };
            }
        }

        // All blocking parents were either optional or max-warned
        return WorkflowAdapter.result_allowed();
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

    // ─── Skip Management ───────────────────────────────────────

    /**
     * Increment skip counter for a stage.
     * Called when user proceeds despite a warning.
     */
    skip_increment(stageId: string): number {
        const current = this.skipCounts[stageId] || 0;
        this.skipCounts[stageId] = current + 1;
        return this.skipCounts[stageId];
    }

    /**
     * Clear skip counter for a stage (called when stage completes).
     */
    stage_complete(stageId: string): void {
        delete this.skipCounts[stageId];
    }

    // ─── Progress ──────────────────────────────────────────────

    /**
     * Get a human-readable workflow progress summary.
     */
    progress_summarize(vfs: VirtualFileSystem, sessionPath: string): string {
        const pos = this.position_resolve(vfs, sessionPath);
        const header = this.definition.header as ManifestHeader;

        let summary = `Workflow: ${header.name}\n`;
        summary += `Progress: ${pos.progress.completed}/${pos.progress.total} stages\n\n`;

        for (const node of this.definition.nodes.values()) {
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

    private static result_allowed(): TransitionResult {
        return {
            allowed: true,
            warning: null,
            reason: null,
            suggestion: null,
            skipCount: 0,
            hardBlock: false,
            skippedStageId: null,
        };
    }
}
