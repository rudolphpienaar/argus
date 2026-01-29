/**
 * @file Node Registry Template Generator
 *
 * Generates /etc/atlas/nodes.json from the Trusted Domain
 * registry in core/data/nodes.ts.
 *
 * @module
 */

import type { ContentContext, ContentGenerator } from '../../types.js';
import type { TrustedDomainNode } from '../../../core/models/types.js';
import { MOCK_NODES } from '../../../core/data/nodes.js';

/**
 * Generates the /etc/atlas/nodes.json content.
 * Serializes the Trusted Domain node registry.
 *
 * @param _context - The content generation context (unused).
 * @returns Pretty-printed JSON string of node definitions.
 */
function content_generate(_context: ContentContext): string {
    const nodes: Array<Record<string, string>> = MOCK_NODES.map(
        (node: TrustedDomainNode): Record<string, string> => ({
            id: node.id,
            name: node.name,
            institution: node.institution,
            status: node.status
        })
    );
    return JSON.stringify(nodes, null, 2) + '\n';
}

/**
 * ContentGenerator for /etc/atlas/nodes.json.
 */
export const nodeRegistryGenerator: ContentGenerator = {
    pattern: 'node-registry',
    generate: content_generate
};
