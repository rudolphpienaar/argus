/**
 * @file OpenAI Client Wrapper
 * 
 * Handles direct communication with the OpenAI API.
 * 
 * @module
 */

import type { ChatMessage, LCARSSystemConfig } from './types.js';

/**
 * Client for interacting with the OpenAI Chat Completions API.
 */
export class OpenAIClient {
    private apiKey: string;
    private model: string;

    /**
     * Creates a new OpenAIClient instance.
     * 
     * @param config - The system configuration containing the API key and model.
     */
    constructor(config: LCARSSystemConfig) {
        this.apiKey = config.apiKey;
        this.model = config.model;
    }

    /**
     * Lists models available to this API key.
     * 
     * @returns A string list of model names.
     */
    async listModels(): Promise<string> {
        try {
            const response = await fetch('https://api.openai.com/v1/models', {
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
            });
            if (!response.ok) return "UNABLE TO RETRIEVE MODEL LIST.";
            const data: any = await response.json();
            return data.data.map((m: any) => m.id).join('\n');
        } catch (e) {
            return "ERROR QUERYING MODELS.";
        }
    }

    /**
     * Sends a chat request to the OpenAI API.
     * 
     * @param messages - The history of messages to send.
     * @returns The content of the assistant's response.
     * @throws {Error} If the API request fails.
     */
    async chat(messages: ChatMessage[]): Promise<string> {
        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: messages,
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error?.message || 'Unknown API Error');
            }

            const data = await response.json();
            return data.choices[0]?.message?.content || '';
        } catch (error) {
            console.error('OpenAI API Error:', error);
            throw error;
        }
    }
}
