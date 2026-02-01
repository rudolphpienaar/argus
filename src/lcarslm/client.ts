/**
 * @file OpenAI Client Wrapper
 * 
 * Handles direct communication with the OpenAI API.
 * 
 * @module
 */

import type { ChatMessage, LCARSSystemConfig } from './types.js';

interface OpenAIModelList {
    data: Array<{ id: string }>;
}

interface OpenAIError {
    error?: { message: string };
}

interface OpenAIChatResponse {
    choices: Array<{ message: { content: string } }>;
}

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
            const response: Response = await fetch('https://api.openai.com/v1/models', {
                headers: { 'Authorization': `Bearer ${this.apiKey}` }
            });
            if (!response.ok) return "UNABLE TO RETRIEVE MODEL LIST.";
            const data: unknown = await response.json();
            return (data as OpenAIModelList).data.map((m) => m.id).join('\n');
        } catch (e: unknown) {
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
            const response: Response = await fetch('https://api.openai.com/v1/chat/completions', {
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
                const error: unknown = await response.json();
                throw new Error((error as OpenAIError).error?.message || 'Unknown API Error');
            }

            const data: unknown = await response.json();
            return (data as OpenAIChatResponse).choices[0]?.message?.content || '';
        } catch (error: unknown) {
            console.error('OpenAI API Error:', error);
            throw error;
        }
    }
}
