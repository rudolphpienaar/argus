import { describe, it, expect, vi } from 'vitest';
import { CalypsoKernel, CalypsoOperationMode } from './CalypsoKernel.js';
import { CalypsoStatusCode } from '../types.js';

describe('NullHypothesis Mode', () => {
    const mockEngine = {
        query: vi.fn().mockResolvedValue({ answer: 'I am a naked model', relevantDatasets: [] })
    };
    const mockSearch = {
        context_updateFromText: vi.fn()
    };
    const mockStore = {
        datasets_getSelected: () => []
    };
    const mockContext = {
        systemCommands_list: () => ['reset'],
        readyCommands_list: () => ['search'],
        activeStageId_get: () => 'gather',
        stage_forCommand: () => null,
        commands_list: () => ['search', 'gather']
    };

    it('bypasses FastPath and RAG in NULL_HYPOTHESIS mode', async () => {
        const kernel = new CalypsoKernel(
            mockEngine as any,
            mockSearch as any,
            mockStore as any,
            mockContext as any,
            { mode: CalypsoOperationMode.NULL_HYPOTHESIS }
        );

        // 1. Act: Send a command that WOULD be caught by FastPath (/reset)
        const response = await kernel.resolve('/reset', '/some/path');

        // 2. Assert: Model was called directly (FastPath bypass)
        expect(mockEngine.query).toHaveBeenCalledWith(
            '/reset',
            [],
            false,
            expect.stringContaining('NULL HYPOTHESIS'),
            { bypassContext: true }
        );
        
        // 3. Assert: Result is conversational, not deterministic
        expect(response.statusCode).toBe(CalypsoStatusCode.CONVERSATIONAL);
        expect(response.message).toBe('I am a naked model');
    });

    it('enforces safety in STRICT mode', async () => {
        mockEngine.query.mockClear();
        const kernel = new CalypsoKernel(
            mockEngine as any,
            mockSearch as any,
            mockStore as any,
            mockContext as any,
            { mode: CalypsoOperationMode.STRICT }
        );

        // 1. Act: Send /reset
        const response = await kernel.resolve('/reset', '/some/path');

        // 2. Assert: Model was NOT called (FastPath intercepted)
        expect(mockEngine.query).not.toHaveBeenCalled();
        expect(response.message).toBe('__DET_INTENT__');
    });
});
