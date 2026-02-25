/**
 * @file Manifest Parser
 *
 * Parses persona manifest YAML files into the common DAGDefinition
 * representation. Manifests define the complete conversational DAG
 * for a persona workflow.
 *
 * The YAML is validated against `ManifestSchema` (Zod) at the boundary
 * before any field access. This replaces the previous hand-rolled
 * `typeof` checks field by field.
 *
 * @module dag/graph/parser
 * @see docs/dag-engine.adoc
 */

import type {
    DAGNode,
    DAGEdge,
    DAGDefinition,
    ManifestHeader,
} from '../types.js';
import {
    yaml_parse,
    previous_normalize,
    skipWarning_parse,
    parameters_parse,
} from './common.js';
import { ManifestSchema, type RawStage } from './schemas.js';

/**
 * Parse a manifest YAML string into a DAGDefinition.
 *
 * @param yamlStr - Raw YAML string
 * @returns Parsed DAGDefinition with source='manifest'
 * @throws On schema violations, duplicate stage IDs, or invalid structure
 */
export function manifest_parse(yamlStr: string): DAGDefinition {
    const raw = yaml_parse(yamlStr);

    // ── Boundary: validate the full document before touching any fields ──────
    const result = ManifestSchema.safeParse(raw);
    if (!result.success) {
        const issues = result.error.issues
            .map(i => `[${i.path.join('.')}] ${i.message}`)
            .join('; ');
        throw new Error(`Invalid manifest: ${issues}`);
    }

    const doc = result.data;

    const header: ManifestHeader = {
        name:        doc.name,
        description: doc.description,
        category:    doc.category,
        persona:     doc.persona,
        version:     doc.version,
        locked:      doc.locked,
        authors:     doc.authors,
    };

    const nodes = new Map<string, DAGNode>();
    const orderedNodeIds: string[] = [];
    const edges: DAGEdge[] = [];

    // Build nodes (preserving manifest order)
    for (const rawStage of doc.stages) {
        const node = node_build(rawStage);
        if (nodes.has(node.id)) {
            throw new Error(`Duplicate stage ID: '${node.id}'`);
        }
        nodes.set(node.id, node);
        orderedNodeIds.push(node.id);
    }

    // Derive edges from backward pointers
    for (const node of nodes.values()) {
        if (node.previous) {
            for (const parentId of node.previous) {
                edges.push({ from: parentId, to: node.id });
            }
        }
    }

    // Compute root IDs (no previous)
    const rootIds = Array.from(nodes.values())
        .filter(n => n.previous === null)
        .map(n => n.id);

    // Compute terminal IDs (not a parent of anything)
    const parentIds = new Set(edges.map(e => e.from));
    const terminalIds = Array.from(nodes.values())
        .filter(n => !parentIds.has(n.id))
        .map(n => n.id);

    return {
        source: 'manifest',
        header,
        nodes,
        orderedNodeIds,
        edges,
        rootIds,
        terminalIds,
    };
}

/**
 * Build a DAGNode from a schema-validated stage record.
 *
 * The heavy validation is done by Zod. This function handles only the
 * semantic conversions that Zod doesn't own: normalizing `previous`,
 * parsing `skip_warning`, and filling in derived fields.
 */
function node_build(stage: RawStage): DAGNode {
    return {
        id:           stage.id,
        name:         stage.name ?? stage.id,
        phase:        stage.phase ?? null,
        previous:     previous_normalize(stage.previous),
        optional:     stage.optional,
        produces:     stage.produces,
        parameters:   parameters_parse(stage.parameters),
        instruction:  stage.instruction,
        commands:     stage.commands,
        handler:      stage.handler,
        skip_warning: skipWarning_parse(stage.skip_warning),
        narrative:    stage.narrative ?? null,
        blueprint:    stage.blueprint,
    };
}
