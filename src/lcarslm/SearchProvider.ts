/**
 * @file Search Provider
 *
 * Encapsulates dataset discovery logic, anaphora resolution, and
 * VFS search snapshot materialization.
 *
 * @module lcarslm/search
 */

import type { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import type { Shell } from '../vfs/Shell.js';
import type { Dataset } from '../core/models/types.js';
import { DATASETS } from '../core/data/datasets.js';
import type { CalypsoStoreActions } from './types.js';

/**
 * Domain-specific content for a search stage artifact.
 */
export interface SearchContent extends Record<string, unknown> {
    query: string;
    generatedAt: string;
    count: number;
    results: Array<{
        id: string;
        name: string;
        modality: string;
        annotationType: string;
        provider: string;
        imageCount: number;
    }>;
}

/**
 * Response from snapshot materialization.
 */
export interface SearchMaterialization {
    content: SearchContent | null;
    path: string | null;
}

/**
 * Handles dataset discovery and conversation context (anaphora).
 */
export class SearchProvider {
    /** Singular anaphoric tokens that refer to the last-mentioned dataset */
    private static readonly ANAPHORA_SINGULAR: ReadonlySet<string> = new Set([
        'that', 'it', 'this'
    ]);

    /** Plural anaphoric tokens that refer to all recently mentioned datasets */
    private static readonly ANAPHORA_PLURAL: ReadonlySet<string> = new Set([
        'them', 'those', 'these', 'all', 'both', 'everything'
    ]);

    constructor(
        private readonly vfs: VirtualFileSystem,
        private readonly shell: Shell,
        private readonly store?: CalypsoStoreActions
    ) {}

    /**
     * Search the dataset catalog.
     */
    public search(query: string): Dataset[] {
        const q: string = query.toLowerCase();
        const results: Dataset[] = DATASETS.filter((ds: Dataset): boolean =>
            ds.name.toLowerCase().includes(q) ||
            ds.description.toLowerCase().includes(q) ||
            ds.modality.toLowerCase().includes(q) ||
            ds.annotationType.toLowerCase().includes(q) ||
            ds.provider.toLowerCase().includes(q)
        );

        if (this.store) {
            this.store.lastMentioned_set(results);
        }
        return results;
    }

    /**
     * Resolve a target ID string into one or more datasets.
     * Handles exact IDs, name substrings, and anaphora.
     */
    public resolve(targetId: string): Dataset[] {
        if (!targetId) return [];

        const tid = targetId.toLowerCase();
        const lastMentioned = this.lastMentioned_get();

        // 1. Check for singular anaphora (it, that)
        if (SearchProvider.ANAPHORA_SINGULAR.has(tid)) {
            return lastMentioned.length > 0 ? [lastMentioned[0]] : [];
        }

        // 2. Check for plural anaphora (them, those, all)
        if (SearchProvider.ANAPHORA_PLURAL.has(tid)) {
            return [...lastMentioned];
        }

        // 3. Exact ID match
        const exact = DATASETS.find(ds => ds.id.toLowerCase() === tid);
        if (exact) return [exact];

        // 4. Name substring match
        const match = DATASETS.find(ds => ds.name.toLowerCase().includes(tid));
        if (match) return [match];

        return [];
    }

    /**
     * Update conversation context from external text (e.g. LLM response).
     */
    public context_updateFromText(text: string): void {
        const ids: string[] = Array.from(text.matchAll(/ds-[0-9]+/g))
            .map(match => match[0]);

        if (ids.length > 0) {
            const datasets = ids
                .map(id => DATASETS.find(ds => ds.id === id))
                .filter((ds): ds is Dataset => !!ds);
            
            if (this.store) {
                this.store.lastMentioned_set(datasets);
            }
        }
    }

    /**
     * Get the last mentioned datasets.
     */
    public lastMentioned_get(): Dataset[] {
        if (this.store) {
            return this.store.lastMentioned_get();
        }
        return [];
    }

    /**
     * Materialize a search snapshot artifact.
     * Returns the content block and physical path.
     */
    public snapshot_materialize(
        query: string, 
        results: Dataset[], 
        sessionPath?: string
    ): SearchMaterialization {
        const username: string = this.shell.env_get('USER') || 'user';
        const now: Date = new Date();
        const timestamp: string = now.toISOString().replace(/[:.]/g, '-');
        const nonce: string = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        
        let targetPath: string;
        let isTopological: boolean = false;

        if (sessionPath) {
            targetPath = `${sessionPath}/search.json`;
            isTopological = true;
        } else {
            const searchRoot: string = `/home/${username}/searches`;
            targetPath = `${searchRoot}/search-${timestamp}-${nonce}.json`;
        }

        try {
            const content: SearchContent = {
                query, // CRITICAL: Inclusion of query ensures different search intents yield different fingerprints
                generatedAt: now.toISOString(),
                count: results.length,
                results: results.map((ds: Dataset) => ({
                    id: ds.id,
                    name: ds.name,
                    modality: ds.modality,
                    annotationType: ds.annotationType,
                    provider: ds.provider,
                    imageCount: ds.imageCount
                }))
            };

            if (isTopological) {
                // Return for core to wrap in envelope with fingerprints
                return { content, path: targetPath };
            }

            // Legacy standalone search write
            this.vfs.file_create(targetPath, JSON.stringify(content, null, 2));
            this.vfs.node_write(`/home/${username}/searches/latest.txt`, `${targetPath}\n`);
            
            return { content, path: targetPath };
        } catch {
            return { content: null, path: null };
        }
    }

    /**
     * Convert an absolute path to user-facing ~/ form.
     */
    public displayPath_resolve(absolutePath: string | null): string | null {
        if (!absolutePath) return null;
        const username: string = this.shell.env_get('USER') || 'user';
        const homePrefix: string = `/home/${username}`;
        if (absolutePath.startsWith(homePrefix)) {
            return absolutePath.replace(homePrefix, '~');
        }
        return absolutePath;
    }
}
