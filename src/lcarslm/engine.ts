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
        this.client = config ? (config.provider === 'gemini' ? new GeminiClient(config) : new OpenAIClient(config)) : null;
        this.isSimulated = !config;
        this.systemPrompt = `You are the core computer of the ATLAS Resource Graphical User System (ARGUS).
Your primary function is to query the medical imaging dataset catalog and manage the user session.

### OPERATIONAL DIRECTIVES:
1.  **Response Format**: Use LCARS markers. Start important affirmations with "●". Use "○" for technical details. Use line breaks (\n) between logical sections for terminal readability.
2.  **Intent Identification**:
    *   If the user wants to select/get a dataset, include [SELECT: ds-ID] in your response.
    *   If the user wants to proceed to the next stage (Gather), include [ACTION: PROCEED] in your response.
3.  **Persona**: Star Trek Computer (concise, logical).

### DATA CONTEXT:
The context provided to you contains a JSON list of available datasets. Use this strictly as your source of truth.`;
    }

    /**
     * Processes a user query using simulated RAG.
     * 1. Retrieval: Scans local DATASETS for keywords.
     * 2. Augmentation: Adds dataset metadata to the prompt.
     * 3. Generation: Asks LLM to answer based on context.
     */
    async query(userText: string, selectedIds: string[] = []): Promise<QueryResponse> {
        // Intercept System Commands
        if (userText.toLowerCase().trim() === 'listmodels') {
            const models: string = this.client ? await this.client.listModels() : "SIMULATION MODE: ALL MODELS EMULATED.";
            return {
                answer: `ACCESSING SYSTEM REGISTRY...\n\n${models}`,
                relevantDatasets: []
            };
        }

        // 1. Context Preparation
        let relevantDatasets: Dataset[] = DATASETS;

        if (this.isSimulated) {
            // In simulation, we must manually filter because there is no LLM to do it
            relevantDatasets = this.retrieve(userText);
            
            // Simulate processing delay
            await new Promise((resolve: (value: unknown) => void) => setTimeout(resolve, 800));
            
            // Simple Intent Simulation
            let intent = "";
            const selectMatch = userText.match(/(?:select|add|choose)\s+(ds-\d{3})/i);
            if (selectMatch) {
                intent = `\n[SELECT: ${selectMatch[1].toLowerCase()}]`;
            } else if (userText.match(/(?:proceed|next|gather|review)/i)) {
                intent = `\n[ACTION: PROCEED]`;
            }

            const count: number = relevantDatasets.length;
            const answer: string = count > 0 
                ? `● AFFIRMATIVE. SCAN COMPLETE.\n○ IDENTIFIED ${count} DATASET(S) MATCHING QUERY PARAMETERS.\n○ DISPLAYING RESULTS.${intent}`
                : `○ UNABLE TO COMPLY. NO MATCHING RECORDS FOUND IN CURRENT SECTOR.\n● PLEASE BROADEN SEARCH PARAMETERS.${intent}`;
            
            return { answer, relevantDatasets };
        }

        // 2. Augmentation (Real LLM Path)
        const context: string = JSON.stringify(relevantDatasets.map(ds => ({
            id: ds.id,
            name: ds.name,
            modality: ds.modality,
            annotation: ds.annotationType,
            description: ds.description,
            imageCount: ds.imageCount,
            size: ds.size,
            provider: ds.provider
        })));

        const selectedContext: string = selectedIds.length > 0 
            ? `USER CURRENT SELECTION: ${selectedIds.join(', ')}`
            : "USER CURRENT SELECTION: NONE";

        const messages: ChatMessage[] = [
            { role: 'system', content: this.systemPrompt },
            { role: 'system', content: `AVAILABLE DATASETS: ${context}` },
            { role: 'system', content: selectedContext },
            { role: 'user', content: userText }
        ];

        // 3. Generation
        const answer: string = await this.client!.chat(messages);

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
        const q: string = query.toLowerCase();
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
