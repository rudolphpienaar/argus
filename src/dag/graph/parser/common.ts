/**
 * @file Shared Parsing Utilities
 *
 * Common helpers used by both manifest and script parsers.
 *
 * @module dag/graph/parser
 */

import yaml from 'js-yaml';
import type { SkipWarning, StageParameters } from '../types.js';

/** Parse a YAML string into a JS object. */
export function yaml_parse(yamlStr: string): unknown {
    return yaml.load(yamlStr);
}

/**
 * Normalize the `previous` field from YAML into the canonical form.
 * - null/undefined → null (root node)
 * - string → [string]
 * - array → array (as-is)
 */
export function previous_normalize(raw: unknown): string[] | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'string') return [raw];
    if (Array.isArray(raw)) return raw.map(String);
    return null;
}

/** Parse a skip_warning block, returning null if absent. */
export function skipWarning_parse(raw: unknown): SkipWarning | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    return {
        short: String(obj['short'] ?? ''),
        reason: String(obj['reason'] ?? ''),
        max_warnings: Number(obj['max_warnings'] ?? 2),
    };
}

/** Parse parameters, returning empty object if absent. */
export function parameters_parse(raw: unknown): StageParameters {
    if (!raw || typeof raw !== 'object') return {};
    return raw as StageParameters;
}
