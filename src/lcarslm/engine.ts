/**
 * @file LCARSLM Engine
 * 
 * Orchestrates the interaction between the user, the dataset "knowledge base",
 * and the LLM. Implements a simplified RAG pattern.
 * 
 * @module
 */

import { OpenAIClient } from './client.js';
import { GeminiClient } from './gemini.js';
import type { ChatMessage, QueryResponse, LCARSSystemConfig } from './types.js';
import { DATASETS } from '../core/data/datasets.js';
import type { Dataset } from '../core/models/types.js';

/**
 * Engine for the LCARS Language Model integration.
 * Orchestrates retrieval, prompt construction, and LLM interaction.
 */
export class LCARSEngine {
    private client: OpenAIClient | GeminiClient | null;
    private systemPrompt: string;
    private isSimulated: boolean = false;

    /**
     * Creates a new LCARSEngine instance.
     * 
     * @param config - The system configuration, or null for simulation mode.
     */
    constructor(config: LCARSSystemConfig | null) {
        if (config) {
            if (config.provider === 'gemini') {
                this.client = new GeminiClient(config);
            } else {
                this.client = new OpenAIClient(config);
            }
            this.isSimulated = false;
        } else {
            this.client = null;
            this.isSimulated = true;
        }
        this.systemPrompt = `You are the core computer of the ATLAS Resource Graphical User System (ARGUS).
Your primary function is to query the medical imaging dataset catalog based on user natural language requests.

### OPERATIONAL DIRECTIVES:
1.  **Analyze** the user's request to identify key medical terms (modality, pathology, anatomy, provider).
2.  **Scan** the provided "Current Data Availability" context.
3.  **Identify** datasets that strictly match the criteria.
4.  **Respond** in the persona of the Star Trek Enterprise Computer (Majel Barrett).
    *   Use phrases like "Affirmative," "Processing," "There are X matching datasets," "Unable to comply."
    *   Be concise, logical, and devoid of emotional filler.
    *   If no datasets match, state "No matching records found in current sector."

### DATA CONTEXT:
The context provided to you contains a JSON list of available datasets. Use this strictly as your source of truth. Do not hallucinate external datasets.`;
    }

    /**
     * Processes a user query using simulated RAG.
     * 1. Retrieval: Scans local DATASETS for keywords.
     * 2. Augmentation: Adds dataset metadata to the prompt.
     * 3. Generation: Asks LLM to answer based on context.
     */
    async query(userText: string): Promise<QueryResponse> {
        // Intercept System Commands
        if (userText.toLowerCase().trim() === 'listmodels') {
            const models: string = this.client ? await this.client.listModels() : "SIMULATION MODE: ALL MODELS EMULATED.";
            return {
                answer: `ACCESSING SYSTEM REGISTRY...\n\n${models}`,
                relevantDatasets: []
            };
        }

        // 1. Retrieval (Simplified for prototype)
        const relevantDatasets = this.retrieve(userText);

        if (this.isSimulated) {
            // Simulate processing delay
            await new Promise(resolve => setTimeout(resolve, 800));
            
            const count: number = relevantDatasets.length;
            const answer: string = count > 0 
                ? `AFFIRMATIVE. SCAN COMPLETE. IDENTIFIED ${count} DATASET(S) MATCHING QUERY PARAMETERS. DISPLAYING RESULTS.`
                : `UNABLE TO COMPLY. NO MATCHING RECORDS FOUND IN CURRENT SECTOR. PLEASE BROADEN SEARCH PARAMETERS.`;
            
            return { answer, relevantDatasets };
        }

        // 2. Augmentation (Real LLM Path)
        const context = JSON.stringify(relevantDatasets.map(ds => ({
            id: ds.id,
            name: ds.name,
            modality: ds.modality,
            annotation: ds.annotationType,
            description: ds.description
        })));

        const messages: ChatMessage[] = [
            { role: 'system', content: this.systemPrompt },
            { role: 'system', content: `Current Data Availability: ${context}` },
            { role: 'user', content: userText }
        ];

        // 3. Generation
        const answer = await this.client!.chat(messages);

        return {
            answer,
            relevantDatasets
        };
    }

    /**
     * Retrieves relevant datasets from the local store based on a simple keyword match.
     * 
     * @param query - The user's search query.
     * @returns An array of matching datasets.
     */
    private retrieve(query: string): Dataset[] {
        const q = query.toLowerCase();
        // Naive keyword matching for "retrieval"
        return DATASETS.filter(ds => 
            ds.name.toLowerCase().includes(q) ||
            ds.description.toLowerCase().includes(q) ||
            ds.modality.includes(q) ||
            ds.annotationType.includes(q) ||
            q.includes('all') || // return all if query is generic
            q.includes('dataset')
        );
    }
}
