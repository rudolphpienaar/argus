/**
 * @file Gemini Nano (Chrome Built-in AI) Search Provider.
 *
 * Uses the experimental `window.ai` API to perform RAG directly in the browser.
 *
 * @module
 */

import type { SearchProvider, SearchResponse, SearchResult } from '../types.js';

// Define the window.ai interface (experimental)
declare global {
    interface Window {
        ai?: {
            languageModel: {
                capabilities(): Promise<{ available: 'readily' | 'after-download' | 'no' }>;
                create(options?: { systemPrompt?: string }): Promise<{
                    prompt(input: string): Promise<string>;
                    destroy(): void;
                }>;
            };
        };
    }
}

export class GeminiNanoProvider implements SearchProvider {
    id = 'gemini-nano';

    async isAvailable(): Promise<boolean> {
        if (!window.ai) return false;
        try {
            const caps = await window.ai.languageModel.capabilities();
            return caps.available !== 'no';
        } catch (e) {
            return false;
        }
    }

    async search(query: string, context: string): Promise<SearchResponse> {
        const startTime = performance.now();

        // 1. Construct the RAG Prompt
        const systemPrompt = `
You are ARGUS, a medical data curator.
Analyze the User Query against the provided Dataset Catalog.
Return a JSON object with:
1. "explanation": A concise, natural language summary of what you found.
2. "dataset_ids": An array of strings containing ONLY the IDs of matching datasets.

DATASET CATALOG:
${context}
`;

        try {
            // 2. Initialize the Model
            const session = await window.ai!.languageModel.create({
                systemPrompt
            });

            // 3. Query
            const responseText = await session.prompt(`User Query: ${query}`);
            
            // 4. Parse Response (Expect JSON)
            // Cleanup Markdown code blocks if present
            const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(cleanJson);

            session.destroy();

            // 5. Map to Results
            const results: SearchResult[] = (parsed.dataset_ids || []).map((id: string) => ({
                datasetId: id,
                confidence: 0.9, // Nano doesn't give confidence scores yet
                reason: 'AI Semantic Match'
            }));

            return {
                explanation: parsed.explanation || "Analysis complete.",
                results,
                provider: this.id,
                latency: performance.now() - startTime
            };

        } catch (e) {
            console.error("Gemini Nano Error:", e);
            return {
                explanation: "I encountered an error processing your request with the onboard AI.",
                results: [],
                provider: this.id,
                latency: performance.now() - startTime
            };
        }
    }
}
