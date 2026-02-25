/**
 * @file OpenAI Client Wrapper
 *
 * Handles communication with the OpenAI API.
 *
 * @module lcarslm/kernel/openai
 */

import type { ChatMessage, LCARSSystemConfig } from '../types.js';

interface OpenAIError {
    error?: { message: string };
}

interface OpenAIChatResponse {
    choices: Array<{ message: { content: string } }>;
}

/**
 * Client for interacting with the OpenAI API.
 */
export class OpenAIClient {
    private apiKey: string;
    private model: string;

    /**
     * Creates a new OpenAIClient instance.
     * 
     * @param config - The system configuration containing the API key.
     */
    constructor(config: LCARSSystemConfig) {
        this.apiKey = config.apiKey;
        this.model = config.model && config.model !== 'default' ? config.model : 'gpt-4o-mini';
    }

    /**
     * Lists models available to this API key.
     * 
     * @returns A string list of model names.
     */
    async listModels(): Promise<string> {
        try {
            const response: Response = await fetch('https://api.openai.com/v1/models', {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });
            if (!response.ok) return "UNABLE TO RETRIEVE MODEL LIST.";
            const data: any = await response.json();
            return data.data.map((m: any) => m.id).join('\n');
        } catch {
            return "ERROR QUERYING MODELS.";
        }
    }

    /**
     * Sends a chat request to the OpenAI API.
     * 
     * @param messages - The history of messages to send.
     * @returns The content of the model's response.
     */
    async chat(messages: ChatMessage[]): Promise<string> {
        try {
            const response: Response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: messages.map(m => ({
                        role: m.role,
                        content: m.content
                    }))
                })
            });

            if (!response.ok) {
                const error: unknown = await response.json();
                throw new Error((error as OpenAIError).error?.message || 'Unknown OpenAI API Error');
            }

            const data: unknown = await response.json();
            return (data as OpenAIChatResponse).choices[0]?.message?.content || '';
        } catch (error: unknown) {
            console.error('OpenAI API Error:', error);
            throw error;
        }
    }
}
