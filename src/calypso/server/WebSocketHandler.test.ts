import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { wsConnection_handle } from './WebSocketHandler.js';
import { SessionBus } from '../bus/SessionBus.js';
import type { WebSocket } from 'ws';
import type { WebSocketCalypso } from '../bus/types.js';
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

class KernelStub implements WebSocketCalypso {
    private observers: Set<(event: any) => void> = new Set();
    public bootCalled: number = 0;
    public shouldFailBoot: boolean = false;
    public commandsExecuted: string[] = [];

    telemetry_subscribe(observer: (event: any) => void): () => void {
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

    async command_execute(command: string): Promise<CalypsoResponse> {
        this.commandsExecuted.push(command);
        return {
            message: `ok: ${command}`,
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

// ─── Telemetry Rebinding Tests ───────────────────────────────────────────────

describe('WebSocketHandler telemetry rebinding', (): void => {
    it('rebinds telemetry stream after login reinitializes CalypsoCore', async (): Promise<void> => {
        const ws: MockWebSocket = new MockWebSocket();
        const kernelA: KernelStub = new KernelStub();
        const kernelB: KernelStub = new KernelStub();
        const bus: SessionBus = new SessionBus(kernelA);

        wsConnection_handle(ws as unknown as WebSocket, {
            bus_get: (): SessionBus => bus,
            calypso_reinitialize: (): void => {
                bus.kernel_replace(kernelB);
            }
        });

        kernelA.telemetry_emit({ type: 'progress', label: 'before-login', percent: 25 });

        ws.emit('message', Buffer.from(JSON.stringify({
            type: 'login',
            id: 'login-1',
            username: 'tester'
        })));
        await flush_async();

        kernelA.telemetry_emit({ type: 'progress', label: 'stale-core', percent: 50 });
        kernelB.telemetry_emit({ type: 'progress', label: 'active-core', percent: 75 });

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
        expect(kernelB.bootCalled).toBe(1);
        expect(loginResponse?.success).toBe(true);
    });

    it('forwards boot_log telemetry payload fields without dropping phase/seq', async (): Promise<void> => {
        const ws: MockWebSocket = new MockWebSocket();
        const kernel: KernelStub = new KernelStub();
        const bus: SessionBus = new SessionBus(kernel);

        wsConnection_handle(ws as unknown as WebSocket, {
            bus_get: (): SessionBus => bus,
            calypso_reinitialize: (): void => {}
        });

        kernel.telemetry_emit({
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
        const kernelA: KernelStub = new KernelStub();
        const kernelB: KernelStub = new KernelStub();
        kernelB.shouldFailBoot = true;
        const bus: SessionBus = new SessionBus(kernelA);

        wsConnection_handle(ws as unknown as WebSocket, {
            bus_get: (): SessionBus => bus,
            calypso_reinitialize: (): void => {
                bus.kernel_replace(kernelB);
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

        expect(kernelB.bootCalled).toBe(1);
        expect(errorResponse).toBeDefined();
        expect(errorResponse?.message).toMatch(/Boot failed:/);
        expect(loginResponse).toBeUndefined();
        errorSpy.mockRestore();
    });
});

// ─── Cross-Surface Broadcast Tests ──────────────────────────────────────────

describe('WebSocketHandler cross-surface broadcast', (): void => {
    it('second connection receives session_event when first submits a command', async (): Promise<void> => {
        const kernel: KernelStub = new KernelStub();
        const bus: SessionBus = new SessionBus(kernel);

        const ws1: MockWebSocket = new MockWebSocket();
        const ws2: MockWebSocket = new MockWebSocket();

        const deps = { bus_get: (): SessionBus => bus, calypso_reinitialize: (): void => {} };
        wsConnection_handle(ws1 as unknown as WebSocket, deps);
        wsConnection_handle(ws2 as unknown as WebSocket, deps);

        ws1.emit('message', Buffer.from(JSON.stringify({
            type: 'command',
            id: 'cmd-1',
            command: 'search histology'
        })));
        await flush_async();

        const ws1Messages = sentMessages_parse(ws1);
        const ws2Messages = sentMessages_parse(ws2);

        // ws1 gets a direct response
        const response = ws1Messages.find(m => m.type === 'response');
        expect(response).toBeDefined();
        expect(response?.id).toBe('cmd-1');

        // ws2 gets a session_event with the full response
        const event = ws2Messages.find(m => m.type === 'session_event');
        expect(event).toBeDefined();
        expect(event?.input).toBe('search histology');
        expect((event?.response as CalypsoResponse)?.success).toBe(true);
    });

    it('session_event is NOT sent to the originating connection', async (): Promise<void> => {
        const kernel: KernelStub = new KernelStub();
        const bus: SessionBus = new SessionBus(kernel);

        const ws1: MockWebSocket = new MockWebSocket();
        const ws2: MockWebSocket = new MockWebSocket();

        const deps = { bus_get: (): SessionBus => bus, calypso_reinitialize: (): void => {} };
        wsConnection_handle(ws1 as unknown as WebSocket, deps);
        wsConnection_handle(ws2 as unknown as WebSocket, deps);

        ws1.emit('message', Buffer.from(JSON.stringify({
            type: 'command',
            id: 'cmd-x',
            command: 'gather'
        })));
        await flush_async();

        const ws1Messages = sentMessages_parse(ws1);
        const ws1Events = ws1Messages.filter(m => m.type === 'session_event');

        // Originator must NOT receive its own session_event
        expect(ws1Events).toHaveLength(0);
    });

    it('unregistered connection no longer receives session_events', async (): Promise<void> => {
        const kernel: KernelStub = new KernelStub();
        const bus: SessionBus = new SessionBus(kernel);

        const ws1: MockWebSocket = new MockWebSocket();
        const ws2: MockWebSocket = new MockWebSocket();

        const deps = { bus_get: (): SessionBus => bus, calypso_reinitialize: (): void => {} };
        wsConnection_handle(ws1 as unknown as WebSocket, deps);
        wsConnection_handle(ws2 as unknown as WebSocket, deps);

        // ws2 disconnects
        ws2.emit('close');

        ws1.emit('message', Buffer.from(JSON.stringify({
            type: 'command',
            id: 'cmd-after-close',
            command: 'harmonize'
        })));
        await flush_async();

        const ws2Messages = sentMessages_parse(ws2);
        const ws2Events = ws2Messages.filter(m => m.type === 'session_event');

        // ws2 was closed before the command — should receive no session_events
        expect(ws2Events).toHaveLength(0);
    });

    it('sourceId in session_event identifies the originating connection', async (): Promise<void> => {
        const kernel: KernelStub = new KernelStub();
        const bus: SessionBus = new SessionBus(kernel);

        const ws1: MockWebSocket = new MockWebSocket();
        const ws2: MockWebSocket = new MockWebSocket();

        const deps = { bus_get: (): SessionBus => bus, calypso_reinitialize: (): void => {} };
        wsConnection_handle(ws1 as unknown as WebSocket, deps);
        wsConnection_handle(ws2 as unknown as WebSocket, deps);

        ws1.emit('message', Buffer.from(JSON.stringify({
            type: 'command',
            id: 'cmd-src',
            command: 'search'
        })));
        await flush_async();

        const ws2Messages = sentMessages_parse(ws2);
        const event = ws2Messages.find(m => m.type === 'session_event');

        expect(event).toBeDefined();
        // sourceId must be a valid ws-conn-N identifier
        expect(typeof event?.sourceId).toBe('string');
        expect(event?.sourceId).toMatch(/^ws-conn-\d+$/);
    });

    it('three connections: event from first reaches second and third but not first', async (): Promise<void> => {
        const kernel: KernelStub = new KernelStub();
        const bus: SessionBus = new SessionBus(kernel);

        const ws1: MockWebSocket = new MockWebSocket();
        const ws2: MockWebSocket = new MockWebSocket();
        const ws3: MockWebSocket = new MockWebSocket();

        const deps = { bus_get: (): SessionBus => bus, calypso_reinitialize: (): void => {} };
        wsConnection_handle(ws1 as unknown as WebSocket, deps);
        wsConnection_handle(ws2 as unknown as WebSocket, deps);
        wsConnection_handle(ws3 as unknown as WebSocket, deps);

        ws1.emit('message', Buffer.from(JSON.stringify({
            type: 'command',
            id: 'cmd-3way',
            command: 'train'
        })));
        await flush_async();

        const ws1Events = sentMessages_parse(ws1).filter(m => m.type === 'session_event');
        const ws2Events = sentMessages_parse(ws2).filter(m => m.type === 'session_event');
        const ws3Events = sentMessages_parse(ws3).filter(m => m.type === 'session_event');

        expect(ws1Events).toHaveLength(0);  // originator gets no session_event
        expect(ws2Events).toHaveLength(1);  // second surface receives it
        expect(ws3Events).toHaveLength(1);  // third surface receives it
    });
});
