/**
 * @file Gemini Client Wrapper
 *
 * Handles communication with the Google Gemini API.
 *
 * @module
 */

import type { ChatMessage, LCARSSystemConfig } from './types.js';

interface GeminiModelList {
    models: Array<{ name: string }>;
}

interface GeminiError {
    error?: { message: string };
}

interface GeminiChatResponse {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
}

/**
 * Client for interacting with the Google Gemini API.
 */
export class GeminiClient {
    private apiKey: string;
    private model: string;

    /**
     * Creates a new GeminiClient instance.
     * 
     * @param config - The system configuration containing the API key.
     */
    constructor(config: LCARSSystemConfig) {
        this.apiKey = config.apiKey;
        // Use user-provided model ID, or fallback
        let modelId: string = config.model && config.model !== 'default' ? config.model : 'gemini-flash-latest';
        // Ensure models/ prefix exists
        if (!modelId.startsWith('models/')) {
            modelId = `models/${modelId}`;
        }
        this.model = modelId;
    }

    /**
     * Lists models available to this API key.
     * 
     * @returns A string list of model names.
     */
    async listModels(): Promise<string> {
        try {
            const response: Response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`);
            if (!response.ok) return "UNABLE TO RETRIEVE MODEL LIST.";
            const data: unknown = await response.json();
            return (data as GeminiModelList).models.map((m) => m.name).join('\n');
        } catch (e: unknown) {
            return "ERROR QUERYING MODELS.";
        }
    }

    /**
     * Sends a chat request to the Gemini API.
     * 
     * @param messages - The history of messages to send.
     * @returns The content of the model's response.
     * @throws {Error} If the API request fails.
     */
    async chat(messages: ChatMessage[]): Promise<string> {
        try {
            // Extract system context
            const systemContext: string = messages
                .filter(m => m.role === 'system')
                .map(m => m.content)
                .join('\n\n');

            const userMessages: Array<{ role: string; parts: Array<{ text: string }> }> = messages
                .filter(m => m.role !== 'system')
                .map(m => ({
                    role: m.role === 'user' ? 'user' : 'model',
                    parts: [{ text: m.content }]
                }));

            // Prepend system context to first user message
            if (userMessages.length > 0 && systemContext) {
                userMessages[0].parts[0].text = `SYSTEM CONTEXT:\n${systemContext}\n\nUSER REQUEST:\n${userMessages[0].parts[0].text}`;
            }

            const response: Response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${this.model}:generateContent?key=${this.apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: userMessages
                }),
                referrerPolicy: 'no-referrer'
            });

            if (!response.ok) {
                const error: unknown = await response.json();
                throw new Error((error as GeminiError).error?.message || 'Unknown Gemini API Error');
            }

            const data: unknown = await response.json();
            return (data as GeminiChatResponse).candidates[0]?.content?.parts[0]?.text || '';
        } catch (error: unknown) {
            console.error('Gemini API Error:', error);
            throw error;
        }
    }
}
