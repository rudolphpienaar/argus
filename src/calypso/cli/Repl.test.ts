import { describe, expect, it, vi } from 'vitest';
import { replCompleter_create, replCompletionFallback_resolve, type ReplTabCompleteClient } from './Repl.js';

type ReplCompletionResult = [string[], string];

function completion_run(
    completer: (line: string, callback: (err: null, result: ReplCompletionResult) => void) => void,
    line: string,
): Promise<ReplCompletionResult> {
    return new Promise<ReplCompletionResult>((resolve: (value: ReplCompletionResult) => void): void => {
        completer(line, (_err: null, result: ReplCompletionResult): void => {
            resolve(result);
        });
    });
}

describe('repl completer', (): void => {
    it('delegates completion to client.tabComplete with the full input line', async (): Promise<void> => {
        const tabComplete = vi.fn<(line: string) => Promise<{ completions: string[]; partial: string }>>()
            .mockResolvedValue({ completions: ['python'], partial: 'py' });
        const client: ReplTabCompleteClient = { tabComplete };
        const completer = replCompleter_create(client);

        const [completions, partial]: ReplCompletionResult = await completion_run(completer, 'py');

        expect(tabComplete).toHaveBeenCalledTimes(1);
        expect(tabComplete).toHaveBeenCalledWith('py');
        expect(completions).toEqual(['python']);
        expect(partial).toBe('py');
    });

    it('falls back to local command hints when server returns no completions', async (): Promise<void> => {
        const tabComplete = vi.fn<(line: string) => Promise<{ completions: string[]; partial: string }>>()
            .mockResolvedValue({ completions: [], partial: 'pw' });
        const client: ReplTabCompleteClient = { tabComplete };
        const completer = replCompleter_create(client);

        const [completions, partial]: ReplCompletionResult = await completion_run(completer, 'pw');

        expect(completions).toContain('pwd');
        expect(partial).toBe('pw');
    });

    it('falls back to local command hints when server completion throws', async (): Promise<void> => {
        const tabComplete = vi.fn<(line: string) => Promise<{ completions: string[]; partial: string }>>()
            .mockRejectedValue(new Error('offline'));
        const client: ReplTabCompleteClient = { tabComplete };
        const completer = replCompleter_create(client);

        const [completions, partial]: ReplCompletionResult = await completion_run(completer, 'pw');

        expect(completions).toContain('pwd');
        expect(partial).toBe('pw');
    });
});

describe('repl completion fallback', (): void => {
    it('only applies fallback hints in command position', (): void => {
        const commandFallback: string[] = replCompletionFallback_resolve('pw', 'pw');
        const argFallback: string[] = replCompletionFallback_resolve('cd pro', 'pro');

        expect(commandFallback).toContain('pwd');
        expect(argFallback).toEqual([]);
    });
});
