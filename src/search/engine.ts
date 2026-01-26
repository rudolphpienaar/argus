/**
 * @file ARGUS Search Engine Orchestrator.
 *
 * Manages the selection of the best available search provider (Nano -> Mock)
 * and executes queries.
 *
 * @module
 */

import type { SearchProvider, SearchResponse } from './types.js';
import { MockProvider } from './providers/mock.js';
import { GeminiNanoProvider } from './providers/nano.js';

export class SearchEngine {
    private providers: SearchProvider[] = [];
    private activeProvider: SearchProvider | null = null;

    constructor() {
        // Register providers in order of preference
        this.providers.push(new GeminiNanoProvider());
        this.providers.push(new MockProvider());
    }

    /**
     * Initializes the engine by finding the best available provider.
     */
    async initialize(): Promise<string> {
        for (const p of this.providers) {
            if (await p.isAvailable()) {
                this.activeProvider = p;
                console.log(`[SearchEngine] Selected provider: ${p.id}`);
                return p.id;
            }
        }
        // Should never happen due to MockProvider
        throw new Error("No search providers available");
    }

    /**
     * Executes a search query.
     */
    async query(userText: string, context: string): Promise<SearchResponse> {
        if (!this.activeProvider) await this.initialize();
        return this.activeProvider!.search(userText, context);
    }
}

// Singleton instance
export const searchEngine = new SearchEngine();
