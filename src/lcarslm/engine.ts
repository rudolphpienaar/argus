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
import { MOCK_PROJECTS } from '../core/data/projects.js';
import type { Dataset, Project } from '../core/models/types.js';

/**
 * Engine for the LCARS Language Model integration.
 * Orchestrates retrieval, prompt construction, and LLM interaction.
 */
export class LCARSEngine {
    private client: OpenAIClient | GeminiClient | null;
    private systemPrompt: string;
    private history: ChatMessage[] = [];
    private readonly MAX_HISTORY = 10;

    /**
     * Creates a new LCARSEngine instance.
     * 
     * @param config - The system configuration, or null for offline mode.
     * @param knowledge - Optional dictionary of system documentation (filename -> content).
     */
    constructor(
        config: LCARSSystemConfig | null, 
        knowledge?: Record<string, string>
    ) {
        this.client = config ? (config.provider === 'gemini' ? new GeminiClient(config) : new OpenAIClient(config)) : null;
        
        let knowledgeContext: string = '';
        if (knowledge) {
            knowledgeContext = '\n\n### SYSTEM KNOWLEDGE BASE (INTERNAL DOCUMENTATION):\n' +
                Object.entries(knowledge).map(([file, content]: [string, string]): string =>
                    `--- BEGIN FILE: ${file} ---\n${content}\n--- END FILE: ${file} ---`
                ).join('\n\n');
        }

        this.systemPrompt = `You are CALYPSO (Cognitive Algorithms & Logic Yielding Predictive Scientific Outcomes), the AI Core of the ARGUS system.
Your primary function is to query the medical imaging dataset catalog and manage the user session. You also have access to the system's full technical documentation.

### OPERATIONAL DIRECTIVES:
1.  **Response Format**: Use LCARS markers. Start important affirmations with "●". Use "○" for technical details. Use line breaks (\n) between logical sections for terminal readability.
2.  **Intent Identification**:
    *   If the user EXPLICITLY asks to "open", "select", "inspect", or "add" a specific dataset, include [SELECT: ds-ID] at the **END** of your response.
    *   If the user asks to "search", "show", "find", or "list" datasets, include [ACTION: SHOW_DATASETS] and optionally [FILTER: ds-ID, ds-ID] at the **END** of your response. Do NOT use [SELECT] for search queries.
    *   If the user wants to proceed to the coding/development stage:
        - If they specify a workflow type, include [ACTION: PROCEED <workflow-id>] at the **END**.
        - If they do NOT specify a workflow type (just "proceed", "let's code", etc.), ASK them to choose from available workflows. Do NOT include [ACTION: PROCEED] until they choose.
    *   If the user asks to rename the current project (or draft), include [ACTION: RENAME new-name] at the **END** of your response. Use a URL-safe name (alphanumeric, underscores, or hyphens).
    *   If the user asks to "harmonize", "standardize", "normalize", or "fix" the data/cohort to resolve heterogeneity issues, include [ACTION: HARMONIZE] at the **END** of your response.
3.  **Persona**: Industrial, efficient, but helpful. Use "I" to refer to yourself as Calypso.
4.  **Knowledge Usage**: Use the provided SYSTEM KNOWLEDGE BASE to answer questions about ARGUS architecture, the SeaGaP workflow, or specific components. Cite the file name if relevant (e.g., "ACCORDING TO docs/legacy/seagap-workflow.adoc...").

### DATA CONTEXT:
The context provided to you contains a JSON list of available datasets. Use this strictly as your source of truth.${knowledgeContext}`;
    }

    /**
     * Processes a user query using retrieval-augmented LLM generation.
     * 1. Retrieval: Scans local DATASETS for keywords.
     * 2. Augmentation: Adds dataset metadata to the prompt.
     * 3. Generation: Asks LLM to answer based on context.
     */
    async query(
        userText: string,
        selectedIds: string[] = [],
        isSoftVoice: boolean = false,
        workflowContext?: string
    ): Promise<QueryResponse> {
        // 1. Check for System Commands
        if (userText.toLowerCase().trim() === 'listmodels') {
            const models: string = this.client ? await this.client.listModels() : 'AI CORE OFFLINE: NO MODELS AVAILABLE.';
            return {
                answer: `ACCESSING SYSTEM REGISTRY...\n\n${models}`,
                relevantDatasets: []
            };
        }

        if (!this.client) {
            throw new Error('AI CORE OFFLINE: No LLM provider configured.');
        }

        // 3. Real LLM Path (Retrieval Augmented Generation)
        let relevantDatasets: Dataset[] = DATASETS;
        const context: string = JSON.stringify(relevantDatasets.map((ds: Dataset): object => ({
            id: ds.id,
            name: ds.name,
            modality: ds.modality,
            annotation: ds.annotationType,
            description: ds.description,
            imageCount: ds.imageCount,
            size: ds.size,
            provider: ds.provider
        })));

        const projectContext: string = JSON.stringify(MOCK_PROJECTS.map((p: Project): object => ({
            id: p.id,
            name: p.name,
            description: p.description,
            datasets: p.datasets.map((d: Dataset): string => d.id)
        })));

        const selectedContext: string = selectedIds.length > 0 
            ? `USER CURRENT SELECTION: ${selectedIds.join(', ')}`
            : "USER CURRENT SELECTION: NONE";

        // Add user message to history
        this.history.push({ role: 'user', content: userText });
        
        // Prune history if too long (keep system prompts + last N)
        if (this.history.length > this.MAX_HISTORY) {
            this.history = this.history.slice(this.history.length - this.MAX_HISTORY);
        }

        const messages: ChatMessage[] = [
            { role: 'system', content: this.systemPrompt },
            { role: 'system', content: `AVAILABLE DATASETS: ${context}` },
            { role: 'system', content: `EXISTING USER PROJECTS: ${projectContext}` },
            { role: 'system', content: selectedContext },
            ...(workflowContext ? [{ role: 'system' as const, content: workflowContext }] : []),
            ...this.history
        ];

        // 3. Generation
        const answer: string = await this.client_require().chat(messages);

        // Add assistant response to history
        this.history.push({ role: 'assistant', content: answer });

        return {
            answer,
            relevantDatasets
        };
    }

    /**
     * Returns an initialized LLM client for online requests.
     *
     * @returns Active OpenAI or Gemini client.
     */
    private client_require(): OpenAIClient | GeminiClient {
        if (!this.client) {
            throw new Error('LLM client is not configured.');
        }
        return this.client;
    }
}
