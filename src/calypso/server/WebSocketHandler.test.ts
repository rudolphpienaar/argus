import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { wsConnection_handle } from './WebSocketHandler.js';
import type { WebSocket } from 'ws';
import type { WebSocketCalypso } from './WebSocketHandler.js';
import { CalypsoStatusCode, type CalypsoResponse } from '../../lcarslm/types.js';
import type { WorkflowSummary } from '../../core/workflows/types.js';

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

class TelemetryCoreStub implements WebSocketCalypso {
    private observers: Set<(event: unknown) => void> = new Set();
    public bootCalled: number = 0;
    public shouldFailBoot: boolean = false;

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

    async command_execute(): Promise<CalypsoResponse> {
        return {
            message: '',
            actions: [],
            success: true,
            statusCode: CalypsoStatusCode.OK
        };
    }

    async boot(): Promise<void> {
        this.bootCalled += 1;
        if (this.shouldFailBoot) {
            throw new Error('boot failed in test');
        }
    }

    async workflow_set(): Promise<boolean> {
        return true;
    }

    prompt_get(): string {
        return 'tester@CALYPSO:[~]> ';
    }

    tab_complete(): string[] {
        return [];
    }

    workflows_available(): WorkflowSummary[] {
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
            calypso_get: (): WebSocketCalypso => current,
            calypso_reinitialize: (): WebSocketCalypso => {
                current = coreB;
                return current;
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
        const loginResponse: CapturedMessage | undefined = messages.find(
            (msg: CapturedMessage): boolean => msg.type === 'login-response',
        );

        expect(labels).toContain('before-login');
        expect(labels).toContain('active-core');
        expect(labels).not.toContain('stale-core');
        expect(coreB.bootCalled).toBe(1);
        expect(loginResponse?.success).toBe(true);
    });

    it('forwards boot_log telemetry payload fields without dropping phase/seq', async (): Promise<void> => {
        const ws: MockWebSocket = new MockWebSocket();
        const core: TelemetryCoreStub = new TelemetryCoreStub();

        wsConnection_handle(ws as unknown as WebSocket, {
            calypso_get: (): WebSocketCalypso => core,
            calypso_reinitialize: (): WebSocketCalypso => core
        });

        core.telemetry_emit({
            type: 'boot_log',
            phase: 'login_boot',
            id: 'sys_genesis',
            seq: 1,
            status: 'WAIT',
            message: 'INITIATING ARGUS CORE GENESIS',
            timestamp: '2026-02-22T00:00:00.000Z'
        });

        const messages: CapturedMessage[] = sentMessages_parse(ws);
        const telemetryMessage: CapturedMessage | undefined = messages.find(
            (msg: CapturedMessage): boolean => msg.type === 'telemetry',
        );

        expect(telemetryMessage).toBeDefined();
        const payload: Record<string, unknown> = telemetryMessage!.payload as Record<string, unknown>;
        expect(payload.phase).toBe('login_boot');
        expect(payload.seq).toBe(1);
        expect(payload.id).toBe('sys_genesis');
    });

    it('returns hard error when boot throws during login', async (): Promise<void> => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation((): void => {});
        const ws: MockWebSocket = new MockWebSocket();
        const coreA: TelemetryCoreStub = new TelemetryCoreStub();
        const coreB: TelemetryCoreStub = new TelemetryCoreStub();
        coreB.shouldFailBoot = true;
        let current: TelemetryCoreStub = coreA;

        wsConnection_handle(ws as unknown as WebSocket, {
            calypso_get: (): WebSocketCalypso => current,
            calypso_reinitialize: (): WebSocketCalypso => {
                current = coreB;
                return current;
            }
        });

        ws.emit('message', Buffer.from(JSON.stringify({
            type: 'login',
            id: 'login-err',
            username: 'tester'
        })));
        await flush_async();

        const messages: CapturedMessage[] = sentMessages_parse(ws);
        const errorResponse: CapturedMessage | undefined = messages.find(
            (msg: CapturedMessage): boolean => msg.type === 'error',
        );
        const loginResponse: CapturedMessage | undefined = messages.find(
            (msg: CapturedMessage): boolean => msg.type === 'login-response',
        );

        expect(coreB.bootCalled).toBe(1);
        expect(errorResponse).toBeDefined();
        expect(errorResponse?.message).toMatch(/Boot failed:/);
        expect(loginResponse).toBeUndefined();
        errorSpy.mockRestore();
    });
});
