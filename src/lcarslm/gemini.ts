/**
 * @file Gemini Client Wrapper
 *
 * Handles communication with the Google Gemini API.
 *
 * @module
 */

import type { ChatMessage, LCARSSystemConfig } from './types.js';

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
        this.model = config.model && config.model !== 'default' ? config.model : 'gemini-1.5-flash';
    }

    /**
     * Lists models available to this API key.
     * 
     * @returns A string list of model names.
     */
    async listModels(): Promise<string> {
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`);
            if (!response.ok) return "UNABLE TO RETRIEVE MODEL LIST.";
            const data: any = await response.json();
            return data.models.map((m: any) => m.name).join('\n');
        } catch (e) {
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
            // Convert standard ChatMessage format to Gemini format
            const contents: Array<{ role: string; parts: Array<{ text: string }> }> = messages.map(msg => ({
                role: msg.role === 'user' ? 'user' : 'model',
                parts: [{ text: msg.content }]
            }));

            // Filter out system messages as Gemini handles them differently (or prepends context)
            // For simplicity in this prototype, we'll merge system prompt into the first user message
            // or use the system_instruction if using the beta API, but simpler is better here.
            
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

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`, {
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
                const error: any = await response.json();
                throw new Error(error.error?.message || 'Unknown Gemini API Error');
            }

            const data: any = await response.json();
            return data.candidates[0]?.content?.parts[0]?.text || '';
        } catch (error) {
            console.error('Gemini API Error:', error);
            throw error;
        }
    }
}
