import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import { wsConnection_handle } from './WebSocketHandler.js';
import type { WebSocket } from 'ws';
import type { CalypsoCore } from '../../lcarslm/CalypsoCore.js';

interface CapturedMessage {
    type: string;
    [key: string]: unknown;
}

class MockWebSocket extends EventEmitter {
    public OPEN: number = 1;
    public readyState: number = 1;
    public sent: string[] = [];

    send(payload: string): void {
        this.sent.push(payload);
    }
}

class TelemetryCoreStub {
    private observers: Set<(event: unknown) => void> = new Set();

    telemetry_subscribe(observer: (event: unknown) => void): () => void {
        this.observers.add(observer);
        return (): void => {
            this.observers.delete(observer);
        };
    }

    telemetry_emit(event: unknown): void {
        for (const observer of this.observers) {
            observer(event);
        }
    }

    workflows_available(): [] {
        return [];
    }
}

function sentMessages_parse(ws: MockWebSocket): CapturedMessage[] {
    return ws.sent.map((payload: string): CapturedMessage => JSON.parse(payload) as CapturedMessage);
}

function flush_async(): Promise<void> {
    return new Promise((resolve): void => {
        setTimeout(resolve, 0);
    });
}

describe('WebSocketHandler telemetry rebinding', (): void => {
    it('rebinds telemetry stream after login reinitializes CalypsoCore', async (): Promise<void> => {
        const ws: MockWebSocket = new MockWebSocket();
        const coreA: TelemetryCoreStub = new TelemetryCoreStub();
        const coreB: TelemetryCoreStub = new TelemetryCoreStub();
        let current: TelemetryCoreStub = coreA;

        wsConnection_handle(ws as unknown as WebSocket, {
            calypso_get: (): CalypsoCore => current as unknown as CalypsoCore,
            calypso_reinitialize: (): CalypsoCore => {
                current = coreB;
                return current as unknown as CalypsoCore;
            }
        });

        coreA.telemetry_emit({ type: 'progress', label: 'before-login', percent: 25 });

        ws.emit('message', Buffer.from(JSON.stringify({
            type: 'login',
            id: 'login-1',
            username: 'tester'
        })));
        await flush_async();

        coreA.telemetry_emit({ type: 'progress', label: 'stale-core', percent: 50 });
        coreB.telemetry_emit({ type: 'progress', label: 'active-core', percent: 75 });

        const messages: CapturedMessage[] = sentMessages_parse(ws);
        const telemetry = messages.filter((msg: CapturedMessage): boolean => msg.type === 'telemetry');
        const labels: string[] = telemetry
            .map((msg: CapturedMessage): unknown => (msg.payload as { label?: string }).label)
            .filter((value): value is string => typeof value === 'string');

        expect(labels).toContain('before-login');
        expect(labels).toContain('active-core');
        expect(labels).not.toContain('stale-core');
    });
});

