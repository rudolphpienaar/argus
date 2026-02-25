/**
 * @file SessionBus Unit Tests
 *
 * Validates the semantic contracts of the Session Bus:
 * - Intent routing to kernel (single execution per intent_submit)
 * - Cross-surface broadcast excluding originator
 * - Surface registration lifecycle
 * - sourceId attribution in broadcast events
 */

import { describe, it, expect, vi } from 'vitest';
import { SessionBus } from './SessionBus.js';
import type { WebSocketCalypso, SessionEvent } from './types.js';
import { CalypsoStatusCode, type CalypsoResponse } from '../../lcarslm/types.js';
import type { WorkflowSummary } from '../../core/workflows/types.js';

// ─── Kernel Stub ─────────────────────────────────────────────────────────────

const OK_RESPONSE: CalypsoResponse = {
    message: 'ok',
    actions: [],
    success: true,
    statusCode: CalypsoStatusCode.OK
};

function kernelStub_create(response: CalypsoResponse = OK_RESPONSE): WebSocketCalypso & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        async command_execute(command: string): Promise<CalypsoResponse> {
            calls.push(command);
            return response;
        },
        async boot(): Promise<void> {},
        async workflow_set(): Promise<boolean> { return true; },
        prompt_get(): string { return 'test> '; },
        tab_complete(): string[] { return []; },
        workflows_available(): WorkflowSummary[] { return []; },
        telemetry_subscribe(): () => void { return () => {}; }
    };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SessionBus', (): void => {
    it('routes intent to kernel and returns response', async (): Promise<void> => {
        const kernel = kernelStub_create();
        const bus = new SessionBus(kernel);

        const response = await bus.intent_submit('search histology', 'tui');

        expect(response).toBe(OK_RESPONSE);
    });

    it('broadcasts to all OTHER surfaces, not the originator', async (): Promise<void> => {
        const kernel = kernelStub_create();
        const bus = new SessionBus(kernel);

        const receivedByA: SessionEvent[] = [];
        const receivedByB: SessionEvent[] = [];
        const receivedByC: SessionEvent[] = [];

        bus.surface_register('surface-A', (e) => receivedByA.push(e));
        bus.surface_register('surface-B', (e) => receivedByB.push(e));
        bus.surface_register('surface-C', (e) => receivedByC.push(e));

        await bus.intent_submit('gather', 'surface-B');

        expect(receivedByA).toHaveLength(1);
        expect(receivedByB).toHaveLength(0);  // originator receives nothing
        expect(receivedByC).toHaveLength(1);
    });

    it('unregistered surface receives no events', async (): Promise<void> => {
        const kernel = kernelStub_create();
        const bus = new SessionBus(kernel);

        const received: SessionEvent[] = [];
        const unregister = bus.surface_register('watcher', (e) => received.push(e));

        // Submit once while registered
        await bus.intent_submit('search', 'other');
        expect(received).toHaveLength(1);

        // Unregister then submit again
        unregister();
        await bus.intent_submit('gather', 'other');

        expect(received).toHaveLength(1);  // still only the first event
    });

    it('sourceId correctly tagged in every broadcast event', async (): Promise<void> => {
        const kernel = kernelStub_create();
        const bus = new SessionBus(kernel);

        const received: SessionEvent[] = [];
        bus.surface_register('listener', (e) => received.push(e));

        await bus.intent_submit('harmonize', 'wui-42');

        expect(received).toHaveLength(1);
        expect(received[0].sourceId).toBe('wui-42');
        expect(received[0].input).toBe('harmonize');
    });

    it('multiple surfaces each receive cross-surface events independently', async (): Promise<void> => {
        const kernel = kernelStub_create();
        const bus = new SessionBus(kernel);

        const eventsForX: SessionEvent[] = [];
        const eventsForY: SessionEvent[] = [];
        const eventsForZ: SessionEvent[] = [];

        bus.surface_register('X', (e) => eventsForX.push(e));
        bus.surface_register('Y', (e) => eventsForY.push(e));
        bus.surface_register('Z', (e) => eventsForZ.push(e));

        await bus.intent_submit('cmd-1', 'X');
        await bus.intent_submit('cmd-2', 'Y');

        // After cmd-1 from X: Y and Z each get 1 event; X gets 0
        // After cmd-2 from Y: X and Z each get 1 more event; Y gets 0 more
        expect(eventsForX).toHaveLength(1);
        expect(eventsForY).toHaveLength(1);
        expect(eventsForZ).toHaveLength(2);

        expect(eventsForX[0].input).toBe('cmd-2');
        expect(eventsForY[0].input).toBe('cmd-1');
    });

    it('kernel.command_execute called exactly once per intent_submit', async (): Promise<void> => {
        const kernel = kernelStub_create();
        const bus = new SessionBus(kernel);

        // Register 3 surfaces
        bus.surface_register('A', () => {});
        bus.surface_register('B', () => {});
        bus.surface_register('C', () => {});

        await bus.intent_submit('gather', 'A');
        await bus.intent_submit('harmonize', 'B');

        expect(kernel.calls).toHaveLength(2);
        expect(kernel.calls[0]).toBe('gather');
        expect(kernel.calls[1]).toBe('harmonize');
    });

    it('surface_register cleanup: unregister stops delivery immediately', async (): Promise<void> => {
        const kernel = kernelStub_create();
        const bus = new SessionBus(kernel);

        const events: SessionEvent[] = [];
        const unregister = bus.surface_register('target', (e) => events.push(e));

        await bus.intent_submit('before', 'other');
        unregister();
        await bus.intent_submit('after', 'other');

        expect(events).toHaveLength(1);
        expect(events[0].input).toBe('before');
    });
});
