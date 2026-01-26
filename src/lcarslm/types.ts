/**
 * @file Types for LCARSLM
 * 
 * Definitions for the LCARS Language Model interface.
 * 
 * @module
 */

import type { Dataset } from '../core/models/types.js';

/**
 * Represents a single message in a chat conversation.
 */
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/**
 * Represents the response from the LCARSLM engine.
 */
export interface QueryResponse {
    answer: string;
    relevantDatasets: Dataset[];
}

/**
 * Configuration options for the LCARSLM system.
 */
export interface LCARSSystemConfig {
    apiKey: string;
    model: string;
    provider: 'openai' | 'gemini';
}
