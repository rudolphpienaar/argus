/**
 * @file Type definitions for the ARGUS Search Engine.
 *
 * Defines the contract for search providers (AI, Mock, etc.) and
 * the structured response format expected by the UI.
 *
 * @module
 */

/**
 * A search result identifying a specific dataset.
 */
export interface SearchResult {
    datasetId: string;
    confidence: number; // 0.0 to 1.0
    reason: string;     // Short snippet why this matched
}

/**
 * The structured response from the Search Engine.
 */
export interface SearchResponse {
    /**
     * Natural language explanation from the "Computer".
     * Example: "I found 3 datasets matching your criteria regarding pediatric pathology."
     */
    explanation: string;

    /**
     * List of identified dataset matches.
     */
    results: SearchResult[];

    /**
     * The provider that fulfilled the request (e.g., 'gemini-nano', 'mock').
     */
    provider: string;

    /**
     * Time taken in milliseconds.
     */
    latency: number;
}

/**
 * Interface for any Search Provider (AI, Local, Mock).
 */
export interface SearchProvider {
    /**
     * Unique identifier for the provider.
     */
    id: string;

    /**
     * Checks if this provider is available in the current environment.
     */
    isAvailable(): Promise<boolean>;

    /**
     * Executes a search query against the provider.
     *
     * @param query - The user's natural language query.
     * @param context - The context string (catalog description) to search against.
     */
    search(query: string, context: string): Promise<SearchResponse>;
}
