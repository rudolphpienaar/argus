import { describe, it, expect } from 'vitest';
import { IntentGuard, IntentGuardMode } from '../kernel/IntentGuard.js';
import { CalypsoStatusCode } from '../types.js';

describe('IntentGuard', () => {
    const allCommands = ['search', 'add', 'gather', 'harmonize', 'train'];
    const readyCommands = ['search', 'add'];

    describe('STRICT mode', () => {
        const guard = new IntentGuard({ mode: IntentGuardMode.STRICT });

        it('jails vocabulary to only ready commands', () => {
            const jailed = guard.vocabulary_jail(allCommands, readyCommands);
            expect(jailed).toEqual(readyCommands);
            expect(jailed).not.toContain('train');
        });

        it('allows valid intents in the ready set', () => {
            const intent = { type: 'workflow', command: 'add', args: ['ds-001'], raw: 'add ds-001', isModelResolved: true } as any;
            const validated = guard.intent_validate(intent, readyCommands);
            expect(validated.type).toBe('workflow');
            expect(validated.command).toBe('add');
        });

        it('downgrades out-of-order intents to conversational', () => {
            const intent = { type: 'workflow', command: 'train', args: [], raw: 'train now', isModelResolved: true } as any;
            const validated = guard.intent_validate(intent, readyCommands);
            
            expect(validated.type).toBe('llm');
            expect(validated.command).toBeUndefined();
            expect((validated as any).isIntercepted).toBe(true);
        });

        it('preserves non-workflow intents', () => {
            const intent = { type: 'llm', raw: 'hello', isModelResolved: true } as any;
            const validated = guard.intent_validate(intent, readyCommands);
            expect(validated.type).toBe('llm');
        });
    });

    describe('EXPERIMENTAL mode', () => {
        const guard = new IntentGuard({ mode: IntentGuardMode.EXPERIMENTAL });

        it('does not jail vocabulary', () => {
            const jailed = guard.vocabulary_jail(allCommands, readyCommands);
            expect(jailed).toEqual(allCommands);
        });

        it('does not downgrade out-of-order intents', () => {
            const intent = { type: 'workflow', command: 'train', args: [], raw: 'train now', isModelResolved: true } as any;
            const validated = guard.intent_validate(intent, readyCommands);
            expect(validated.type).toBe('workflow');
            expect(validated.command).toBe('train');
        });
    });
});
