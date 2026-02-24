import { describe, expect, it } from 'vitest';
import { LLMProvider } from './LLMProvider.js';
import type { LCARSEngine } from './kernel/LCARSEngine.js';
import type { QueryResponse, CalypsoResponse, CalypsoAction } from './types.js';
import { CalypsoStatusCode } from './types.js';
import type { StatusProvider } from './kernel/StatusProvider.js';
import type { SearchProvider } from './SearchProvider.js';
import type { CalypsoStoreActions } from './types.js';
import type { IntentParser } from './kernel/IntentParser.js';

interface EngineStub {
    query: (
        userText: string,
        selectedIds?: string[],
        isSoftVoice?: boolean,
        workflowContext?: string,
    ) => Promise<QueryResponse>;
}

function response_create(msg: string, actions: CalypsoAction[], success: boolean): CalypsoResponse {
    return {
        message: msg,
        actions,
        success,
        statusCode: success ? CalypsoStatusCode.OK : CalypsoStatusCode.ERROR,
    };
}

function provider_create(engine: LCARSEngine | null, statusMessages: string[], logMessages: string[]): LLMProvider {
    const statusProvider: StatusProvider = {} as unknown as StatusProvider;
    const searchProvider: SearchProvider = {} as unknown as SearchProvider;
    const storeActions: CalypsoStoreActions = {} as unknown as CalypsoStoreActions;
    const intentParser: IntentParser = {} as unknown as IntentParser;
    return new LLMProvider(
        engine,
        statusProvider,
        searchProvider,
        storeActions,
        intentParser,
        response_create,
        async (): Promise<CalypsoResponse | null> => null,
        {
            status_emit: (message: string): void => {
                statusMessages.push(message);
            },
            log_emit: (message: string): void => {
                logMessages.push(message);
            },
        },
    );
}

describe('LLMProvider greeting telemetry', (): void => {
    it('emits substep telemetry for successful greeting generation', async (): Promise<void> => {
        const statusMessages: string[] = [];
        const logMessages: string[] = [];
        const engine: EngineStub = {
            query: async (): Promise<QueryResponse> => ({
                answer: 'HELLO USER',
                relevantDatasets: [],
            }),
        };
        const provider: LLMProvider = provider_create(engine as unknown as LCARSEngine, statusMessages, logMessages);

        const response: CalypsoResponse = await provider.greeting_generate('rudolph');

        expect(response.message).toBe('HELLO USER');
        expect(statusMessages).toEqual([
            'CALYPSO: PREPARING GREETING CONTEXT',
            'CALYPSO: QUERYING LANGUAGE MODEL FOR GREETING',
            'CALYPSO: GREETING SYNTHESIS COMPLETE',
        ]);
        expect(logMessages).toContain('○ GREETING PATH: MODEL RESPONSE RECEIVED.');
    });

    it('emits fallback telemetry when greeting generation fails', async (): Promise<void> => {
        const statusMessages: string[] = [];
        const logMessages: string[] = [];
        const engine: EngineStub = {
            query: async (): Promise<QueryResponse> => {
                throw new Error('provider offline');
            },
        };
        const provider: LLMProvider = provider_create(engine as unknown as LCARSEngine, statusMessages, logMessages);

        const response: CalypsoResponse = await provider.greeting_generate('rudolph');

        expect(response.message).toContain('READY FOR INPUT');
        expect(statusMessages).toEqual([
            'CALYPSO: PREPARING GREETING CONTEXT',
            'CALYPSO: QUERYING LANGUAGE MODEL FOR GREETING',
            'CALYPSO: GREETING FALLBACK ACTIVATED',
        ]);
        expect(logMessages).toContain('○ GREETING PATH: MODEL QUERY FAILED. USING STATIC FALLBACK.');
    });

    it('emits offline telemetry when no LLM engine is configured', async (): Promise<void> => {
        const statusMessages: string[] = [];
        const logMessages: string[] = [];
        const provider: LLMProvider = provider_create(null, statusMessages, logMessages);

        const response: CalypsoResponse = await provider.greeting_generate('rudolph');

        expect(response.message).toContain('AI CORE OFFLINE');
        expect(statusMessages).toEqual([
            'CALYPSO: PREPARING GREETING CONTEXT',
        ]);
        expect(logMessages).toContain('○ GREETING PATH: AI CORE OFFLINE. USING STATIC GREETING.');
    });
});

