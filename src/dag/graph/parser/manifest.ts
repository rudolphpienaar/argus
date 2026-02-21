/**
 * @file Manifest Parser
 *
 * Parses persona manifest YAML files into the common DAGDefinition
 * representation. Manifests define the complete conversational DAG
 * for a persona workflow.
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

/**
 * Parse a manifest YAML string into a DAGDefinition.
 *
 * @param yamlStr - Raw YAML string
 * @returns Parsed DAGDefinition with source='manifest'
 * @throws On missing required fields or invalid structure
 */
export function manifest_parse(yamlStr: string): DAGDefinition {
    const raw = yaml_parse(yamlStr) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') {
        throw new Error('Invalid manifest: not a YAML object');
    }

    const header = header_parse(raw);
    const nodes = new Map<string, DAGNode>();
    const orderedNodeIds: string[] = [];
    const edges: DAGEdge[] = [];

    const rawStages = raw['stages'];
    if (!Array.isArray(rawStages)) {
        throw new Error('Invalid manifest: stages must be an array');
    }

    // Build nodes (preserving manifest order)
    for (const rawStage of rawStages) {
        const node = node_parse(rawStage as Record<string, unknown>);
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

/** Parse and validate the manifest header. */
function header_parse(raw: Record<string, unknown>): ManifestHeader {
    const name = raw['name'];
    const persona = raw['persona'];
    if (!name || typeof name !== 'string') {
        throw new Error('Invalid manifest: missing required field "name"');
    }
    if (!persona || typeof persona !== 'string') {
        throw new Error('Invalid manifest: missing required field "persona"');
    }

    return {
        name: String(name),
        description: String(raw['description'] ?? ''),
        category: String(raw['category'] ?? ''),
        persona: String(persona),
        version: String(raw['version'] ?? '1.0.0'),
        locked: Boolean(raw['locked'] ?? false),
        authors: String(raw['authors'] ?? ''),
    };
}

/** Parse a single stage entry into a DAGNode. */
function node_parse(raw: Record<string, unknown>): DAGNode {
    const id = raw['id'];
    if (!id || typeof id !== 'string') {
        throw new Error('Invalid stage: missing required field "id"');
    }

    const produces = raw['produces'];
    if (!Array.isArray(produces) || produces.length === 0) {
        throw new Error(`Stage '${id}': produces must be a non-empty array`);
    }

    return {
        id: String(id),
        name: String(raw['name'] ?? id),
        phase: raw['phase'] != null ? String(raw['phase']) : null,
        previous: previous_normalize(raw['previous']),
        optional: Boolean(raw['optional'] ?? false),
        produces: produces.map(String),
        parameters: parameters_parse(raw['parameters']),
        instruction: String(raw['instruction'] ?? ''),
        commands: Array.isArray(raw['commands']) ? raw['commands'].map(String) : [],
        handler: handler_parse(id, raw['handler']),
        skip_warning: skipWarning_parse(raw['skip_warning']),
        narrative: raw['narrative'] != null ? String(raw['narrative']) : null,
        blueprint: Array.isArray(raw['blueprint']) ? raw['blueprint'].map(String) : [],
    };
}

/** Parse and validate a stage handler identifier. */
function handler_parse(stageId: string, rawHandler: unknown): string | null {
    if (rawHandler == null) {
        return null;
    }
    if (typeof rawHandler !== 'string') {
        throw new Error(`Stage '${stageId}': handler must be a string`);
    }

    const handlerName: string = rawHandler.trim();
    const handlerPattern: RegExp = /^[a-z][a-z0-9_-]*$/;
    if (!handlerPattern.test(handlerName)) {
        throw new Error(`Stage '${stageId}': handler '${handlerName}' has invalid format`);
    }
    return handlerName;
}
