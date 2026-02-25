/**
 * @file WebSocket Connection Handler
 *
 * Per-connection handler that registers this connection as a surface on the
 * SessionBus and maps WebSocket messages to kernel operations.
 *
 * Each connection gets a unique `connectionId`. On connect it registers a
 * surface handler with the bus — this handler sends `session_event` to the
 * WS client whenever another surface submits an intent. On close it
 * unregisters. The `command` message handler calls `bus.intent_submit()`
 * and sends the returned response directly to the caller — backward-
 * compatible with existing WUI/TUI clients that don't yet act on
 * `session_event`.
 *
 * @module
 */

import type { WebSocket } from 'ws';
import type { TelemetryEvent } from '../../lcarslm/types.js';
import type { ServerMessage } from '../protocol/types.js';
import type { SessionEvent } from '../bus/types.js';
import { SessionBus } from '../bus/SessionBus.js';
import { ClientMessageSchema } from '../protocol/schemas.js';

// Re-export WebSocketCalypso from its canonical location so existing
// imports (CalypsoServer, tests) continue to resolve from this module.
export type { WebSocketCalypso } from '../bus/types.js';

export { SessionBus };

export interface WebSocketHandlerDeps {
    bus_get: () => SessionBus;
    calypso_reinitialize: (username?: string) => void;
}

let wsConnectionCounter = 0;

/**
 * Handle a single WebSocket connection.
 * Registers the connection as a surface on the SessionBus and routes messages.
 */
export function wsConnection_handle(ws: WebSocket, deps: WebSocketHandlerDeps): void {
    const connectionId = `ws-conn-${++wsConnectionCounter}`;
    const bus = deps.bus_get();

    const send = (msg: ServerMessage): void => {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(msg));
        }
    };

    // Register as a surface — receive cross-surface SessionEvents from the bus.
    // The handler sends a session_event wire message to this WS client.
    const unregisterSurface = bus.surface_register(connectionId, (event: SessionEvent): void => {
        send({
            type: 'session_event',
            sourceId: event.sourceId,
            input: event.input,
            response: event.response,
            timestamp: event.timestamp
        });
    });

    // Forward live telemetry from the kernel to this client.
    // Rebind on login because the kernel (and its TelemetryBus) is replaced.
    const telemetryForward = (event: TelemetryEvent): void => {
        send({ type: 'telemetry', payload: event });
    };
    let unsubscribeTelemetry: () => void = (): void => {};
    const telemetry_bind = (): void => {
        unsubscribeTelemetry();
        unsubscribeTelemetry = bus.telemetry_subscribe(telemetryForward);
    };

    telemetry_bind();

    ws.on('message', async (data: Buffer | string) => {
        // ── Boundary: parse + validate before touching any fields ────────────
        let raw: unknown;
        try {
            raw = JSON.parse(typeof data === 'string' ? data : data.toString());
        } catch {
            send({ type: 'error', id: 'unknown', message: 'Invalid JSON' });
            return;
        }

        const parsed = ClientMessageSchema.safeParse(raw);
        if (!parsed.success) {
            // Extract the correlation id from the raw object if possible so the
            // client can match this error to the failing request.
            const id = (raw as Record<string, unknown>)?.id;
            send({
                type: 'error',
                id: typeof id === 'string' ? id : 'unknown',
                message: `Invalid message: ${parsed.error.issues.map(i => i.message).join(', ')}`
            });
            return;
        }

        const msg = parsed.data;  // fully typed — all fields guaranteed by schema

        try {
            switch (msg.type) {
                case 'command': {
                    const response = await bus.intent_submit(msg.command, connectionId);
                    send({ type: 'response', id: msg.id, payload: response });
                    break;
                }

                case 'login': {
                    const sanitized = msg.username.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'developer';
                    deps.calypso_reinitialize(sanitized);

                    // Rebind telemetry FIRST so boot events stream to this client.
                    telemetry_bind();

                    try {
                        await bus.boot();
                    } catch (e) {
                        console.error('Handshake boot failed:', e);
                        const reason: string = e instanceof Error ? e.message : 'Unknown boot error';
                        send({ type: 'error', id: msg.id, message: `Boot failed: ${reason}` });
                        break;
                    }

                    console.log(`WS Login: User "${sanitized}" authenticated`);
                    send({
                        type: 'login-response',
                        id: msg.id,
                        success: true,
                        username: sanitized,
                        workflows: bus.workflows_available()
                    });
                    break;
                }

                case 'persona': {
                    if (!msg.workflowId || msg.workflowId === 'skip' || msg.workflowId === 'none') {
                        await bus.workflow_set(null);
                        send({ type: 'persona-response', id: msg.id, success: true, message: 'Workflow guidance disabled' });
                    } else {
                        const success = await bus.workflow_set(msg.workflowId);
                        send({
                            type: 'persona-response',
                            id: msg.id,
                            success,
                            message: success ? `Workflow set: ${msg.workflowId}` : `Unknown workflow: ${msg.workflowId}`
                        });
                    }
                    break;
                }

                case 'prompt': {
                    send({ type: 'prompt-response', id: msg.id, prompt: bus.prompt_get() });
                    break;
                }

                case 'tab-complete': {
                    const completions = bus.tab_complete(msg.line);
                    send({ type: 'tab-complete-response', id: msg.id, completions, partial: msg.line });
                    break;
                }
            }
        } catch (e: unknown) {
            const error = e instanceof Error ? e.message : 'Unknown error';
            send({ type: 'error', id: msg.id, message: error });
        }
    });

    ws.on('close', () => {
        unregisterSurface();
        unsubscribeTelemetry();
        console.log(`WebSocket client disconnected`);
    });

    ws.on('error', (err: Error) => {
        console.error(`WebSocket error: ${err.message}`);
    });
}
