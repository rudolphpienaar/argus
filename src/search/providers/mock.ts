/**
 * @file Mock Search Provider.
 *
 * A fallback provider that uses basic keyword matching to simulate
 * intelligent search when no AI is available.
 *
 * @module
 */

import type { SearchProvider, SearchResponse, SearchResult } from '../types.js';

export class MockProvider implements SearchProvider {
    id = 'mock-keyword';

    async isAvailable(): Promise<boolean> {
        return true; // Always available
    }

    async search(query: string, context: string): Promise<SearchResponse> {
        const startTime = performance.now();
        const terms = query.toLowerCase().split(' ').filter(t => t.length > 2);
        const results: SearchResult[] = [];

        // Parse the context string back into something checking-able (hacky but self-contained)
        // In a real app, we'd just pass the raw dataset objects, but we're sticking to the "Context String" contract
        const entries = context.split('--------------------------------------------------');

        entries.forEach(entry => {
            const idMatch = entry.match(/ID: (.*)\n/);
            if (!idMatch) return;
            
            const id = idMatch[1];
            const lowerEntry = entry.toLowerCase();
            let matches = 0;

            terms.forEach(term => {
                if (lowerEntry.includes(term)) matches++;
            });

            if (matches > 0) {
                results.push({
                    datasetId: id,
                    confidence: matches / terms.length,
                    reason: `Matched terms: ${terms.filter(t => lowerEntry.includes(t)).join(', ')}`
                });
            }
        });

        // Generate "Natural Language" explanation
        let explanation = '';
        if (results.length === 0) {
            explanation = "I was unable to locate any datasets matching your specific criteria.";
        } else {
            explanation = `I have identified ${results.length} dataset${results.length > 1 ? 's' : ''} that match your request.`;
            if (query.includes('lung') || query.includes('pneumonia')) {
                explanation += " The BCH and BIDMC cohorts appear highly relevant.";
            }
        }

        return {
            explanation,
            results,
            provider: this.id,
            latency: performance.now() - startTime
        };
    }
}
