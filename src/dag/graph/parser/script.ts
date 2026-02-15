/**
 * @file Script Parser
 *
 * Parses script YAML files into a DAGDefinition by applying overrides
 * to an existing manifest. Scripts anchor to a manifest, inherit its
 * topology, and optionally override parameters or skip stages.
 *
 * @module dag/graph/parser
 * @see docs/dag-engine.adoc
 */

import type {
    DAGNode,
    DAGDefinition,
    ScriptHeader,
    ScriptStageOverride,
} from '../types.js';
import { yaml_parse, parameters_parse } from './common.js';

/**
 * Parse a script YAML string into a DAGDefinition using a manifest
 * as the base topology.
 *
 * @param yamlStr - Raw script YAML string
 * @param manifest - The manifest DAGDefinition this script is anchored to
 * @returns DAGDefinition with script overrides applied
 * @throws On references to nonexistent manifest stages
 */
export function script_parse(yamlStr: string, manifest: DAGDefinition): DAGDefinition {
    const raw = yaml_parse(yamlStr) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') {
        throw new Error('Invalid script: not a YAML object');
    }

    const header = header_parse(raw);

    // Deep clone manifest nodes
    const nodes = new Map<string, DAGNode>();
    for (const [id, node] of manifest.nodes) {
        nodes.set(id, { ...node, parameters: { ...node.parameters } });
    }

    // Apply script overrides
    const rawStages = raw['stages'];
    if (Array.isArray(rawStages)) {
        for (const rawStage of rawStages) {
            const override = override_parse(rawStage as Record<string, unknown>);
            const node = nodes.get(override.id);
            if (!node) {
                throw new Error(`Script references nonexistent manifest stage: '${override.id}'`);
            }

            // Merge parameters (script overrides manifest defaults)
            if (Object.keys(override.parameters).length > 0) {
                node.parameters = { ...node.parameters, ...override.parameters };
            }

            // Mark skip
            if (override.skip) {
                node.parameters = { ...node.parameters, __skip: true };
            }
        }
    }

    return {
        source: 'script',
        header,
        nodes,
        edges: [...manifest.edges],
        rootIds: [...manifest.rootIds],
        terminalIds: [...manifest.terminalIds],
    };
}

/** Parse the script header. */
function header_parse(raw: Record<string, unknown>): ScriptHeader {
    return {
        name: String(raw['name'] ?? ''),
        description: String(raw['description'] ?? ''),
        manifest: String(raw['manifest'] ?? ''),
        version: String(raw['version'] ?? '1.0.0'),
        authors: String(raw['authors'] ?? ''),
    };
}

/** Parse a single script stage override entry. */
function override_parse(raw: Record<string, unknown>): ScriptStageOverride {
    const id = raw['id'];
    if (!id || typeof id !== 'string') {
        throw new Error('Invalid script stage: missing required field "id"');
    }

    return {
        id: String(id),
        skip: Boolean(raw['skip'] ?? false),
        parameters: parameters_parse(raw['parameters']),
    };
}
