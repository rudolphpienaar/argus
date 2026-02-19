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
    private isSimulated: boolean = false;
    private history: ChatMessage[] = [];
    private readonly MAX_HISTORY = 10;

    /**
     * Creates a new LCARSEngine instance.
     * 
     * @param config - The system configuration, or null for simulation mode.
     * @param knowledge - Optional dictionary of system documentation (filename -> content).
     * @param simulationMode - Explicitly force simulation mode.
     */
    constructor(
        config: LCARSSystemConfig | null, 
        knowledge?: Record<string, string>,
        simulationMode: boolean = false
    ) {
        this.client = config ? (config.provider === 'gemini' ? new GeminiClient(config) : new OpenAIClient(config)) : null;
        this.isSimulated = simulationMode || !config;
        
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
        - If they specify a workflow type (e.g. "fedml", "chris", "appdev"), include [ACTION: PROCEED <workflow-id>] at the **END**.
        - If they do NOT specify a workflow type (just "proceed", "let's code", etc.), ASK them to choose from the available workflows (e.g. "Federated Learning (fedml)" or "ChRIS Plugin (chris)"). Do NOT include [ACTION: PROCEED] until they choose.
    *   If the user asks to rename the current project (or draft), include [ACTION: RENAME new-name] at the **END** of your response. Use a URL-safe name (alphanumeric, underscores, or hyphens).
    *   If the user asks to "harmonize", "standardize", "normalize", or "fix" the data/cohort to resolve heterogeneity issues, include [ACTION: HARMONIZE] at the **END** of your response.
3.  **Persona**: Industrial, efficient, but helpful. Use "I" to refer to yourself as Calypso.
4.  **Knowledge Usage**: Use the provided SYSTEM KNOWLEDGE BASE to answer questions about ARGUS architecture, the SeaGaP workflow, or specific components. Cite the file name if relevant (e.g., "ACCORDING TO docs/legacy/seagap-workflow.adoc...").

### DATA CONTEXT:
The context provided to you contains a JSON list of available datasets. Use this strictly as your source of truth.${knowledgeContext}`;
    }

    /**
     * Processes a user query using simulated RAG.
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
            const models: string = this.client ? await this.client.listModels() : "SIMULATION MODE: ALL MODELS EMULATED.";
            return {
                answer: `ACCESSING SYSTEM REGISTRY...\n\n${models}`,
                relevantDatasets: []
            };
        }

        // 2. Simulated Path (RAG and Intent emulation)
        if (this.isSimulated) {
            let relevantDatasets: Dataset[] = this.retrieve(userText);
            
            // Detect if this is an "Intent Compiler" prompt (avoid meta-confusion)
            const isCompilerPrompt: boolean = userText.includes('FORMAT:') || userText.includes('strictly-typed JSON');

            // Simulate processing delay
            await new Promise((resolve: (value: unknown) => void): void => { setTimeout(resolve, 800); });
            
            // 2a. If it's a compiler prompt, try to return a valid JSON intent based on the text
            if (isCompilerPrompt) {
                const userMatch: RegExpMatchArray | null = userText.match(/USER INPUT: "(.*?)"/);
                const actualInput: string = userMatch ? userMatch[1] : userText;
                
                let json: { type: string; command?: string; args?: string[] } = { type: 'llm' };
                const renameMatch: RegExpMatchArray | null = actualInput.match(/(?:name|rename)\s+(?:this|project)?\s*(?:to\s+)?([a-zA-Z0-9_-]+)/i);
                if (renameMatch) {
                    json = { type: 'workflow', command: 'rename', args: [renameMatch[1].toLowerCase()] };
                } else if (actualInput.toLowerCase().startsWith('search ')) {
                    const query = actualInput.substring(7).trim();
                    json = { type: 'workflow', command: 'search', args: [query] };
                } else if (actualInput.toLowerCase().startsWith('proceed')) {
                    const parts = actualInput.split(/\s+/);
                    json = { type: 'workflow', command: 'proceed', args: parts.slice(1) };
                } else if (actualInput.toLowerCase().startsWith('add ') || actualInput.toLowerCase().startsWith('gather ')) {
                    const parts = actualInput.split(/\s+/);
                    const cmd = parts[0].toLowerCase();
                    const args = parts.slice(1);
                    json = { type: 'workflow', command: cmd, args: args };
                } else if (actualInput.match(/(?:harmonize|standardize|normalize)/i)) {
                    json = { type: 'workflow', command: 'harmonize', args: [] };
                }

                return {
                    answer: JSON.stringify(json),
                    relevantDatasets: []
                };
            }

            // Simple Intent Simulation for regular queries
            let intent: string = "";
            let answerCaps: string = "";
            let answerSoft: string = "";

            const selectMatch: RegExpMatchArray | null = userText.match(/(?:select|add|choose)\s+(ds-\d{3})/i);
            const renameMatch: RegExpMatchArray | null = userText.match(/(?:name|rename)\s+(?:this|project)?\s*(?:to\s+)?([a-zA-Z0-9_-]+)/i);
            const proceedMatch: RegExpMatchArray | null = userText.match(/(?:proceed|next|gather|review|code|let's code)/i);

            if (selectMatch) {
                intent = `\n[SELECT: ${selectMatch[1].toLowerCase()}]`;
            } else if (renameMatch) {
                const newName: string = renameMatch[1].toLowerCase();
                intent = `\n[ACTION: RENAME ${newName}]`;
                answerCaps = `● PROJECT RENAME PROTOCOL INITIATED. THE CURRENT WORKSPACE HAS BEEN SUCCESSFULLY UPDATED TO '${newName}'.`;
                answerSoft = `● Project rename protocol initiated. The current workspace has been successfully updated to '${newName}'.`;
            } else if (proceedMatch) {
                intent = `\n[ACTION: PROCEED]`;
            } else if (userText.match(/(?:harmonize|standardize|normalize)/i)) {
                intent = `\n[ACTION: HARMONIZE]`;
            }

            const count: number = relevantDatasets.length;
            
            if (!answerCaps) {
                answerCaps = count > 0 
                    ? `● AFFIRMATIVE. SCAN COMPLETE.\n○ IDENTIFIED ${count} DATASET(S) MATCHING QUERY PARAMETERS.\n○ DISPLAYING RESULTS.${intent}`
                    : (intent ? `● AFFIRMATIVE. COMMAND RECEIVED.${intent}` : `○ UNABLE TO COMPLY. NO MATCHING RECORDS FOUND IN CURRENT SECTOR.\n● PLEASE BROADEN SEARCH PARAMETERS.`);
            } else if (intent) {
                answerCaps += intent;
            }

            if (!answerSoft) {
                answerSoft = count > 0 
                    ? `● Affirmative. Scan complete.\n○ Identified ${count} dataset(s) matching query parameters.\n○ Displaying results.${intent}`
                    : (intent ? `● Affirmative. Command received.${intent}` : `○ Unable to comply. No matching records found in current sector.\n● Please broaden search parameters.`);
            } else if (intent) {
                answerSoft += intent;
            }
            
            return { answer: isSoftVoice ? answerSoft : answerCaps, relevantDatasets };
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
     * Retrieves relevant datasets from the local store based on a simple keyword match.
     * 
     * @param query - The user's search query.
     * @returns An array of matching datasets.
     */
    private retrieve(query: string): Dataset[] {
        const q: string = query.toLowerCase();
        // Naive keyword matching for "retrieval"
        return DATASETS.filter((ds: Dataset): boolean =>
            ds.name.toLowerCase().includes(q) ||
            ds.description.toLowerCase().includes(q) ||
            ds.modality.toLowerCase().includes(q) ||
            ds.annotationType.toLowerCase().includes(q) ||
            ds.provider.toLowerCase().includes(q) ||
            q.includes('all') || // return all if query is generic
            q.includes('dataset')
        );
    }

    /**
     * Returns an initialized LLM client for non-simulated requests.
     *
     * @returns Active OpenAI or Gemini client.
     */
    private client_require(): OpenAIClient | GeminiClient {
        if (!this.client) {
            throw new Error('LLM client is not configured in non-simulated mode.');
        }
        return this.client;
    }
}
