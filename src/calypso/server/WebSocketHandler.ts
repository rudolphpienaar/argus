/**
 * @file WebSocket Connection Handler
 *
 * Per-connection handler that maps WebSocket messages to CalypsoCore
 * method calls and sends typed responses with correlation IDs.
 *
 * @module
 */

import type { WebSocket } from 'ws';
import type { WorkflowSummary } from '../../core/workflows/types.js';
import type { CalypsoResponse, TelemetryEvent } from '../../lcarslm/types.js';
import type {
    ClientMessage,
    ServerMessage
} from '../protocol/types.js';

export interface WebSocketCalypso {
    command_execute(command: string): Promise<CalypsoResponse>;
    boot(): Promise<void>;
    workflow_set(workflowId: string | null): Promise<boolean>;
    prompt_get(): string;
    tab_complete(line: string): string[];
    workflows_available(): WorkflowSummary[];
    telemetry_subscribe(observer: (event: TelemetryEvent) => void): () => void;
}

export interface WebSocketHandlerDeps {
    calypso_get: () => WebSocketCalypso;
    calypso_reinitialize: (username?: string) => WebSocketCalypso;
}

/**
 * Handle a single WebSocket connection.
 * Sets up message routing and lifecycle management.
 */
export function wsConnection_handle(ws: WebSocket, deps: WebSocketHandlerDeps): void {
    const send = (msg: ServerMessage): void => {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(msg));
        }
    };

    // v10.2: Subscribe to live telemetry and broadcast to client.
    // Rebind on login because core is reinitialized per authenticated user.
    const telemetryForward = (event: TelemetryEvent): void => {
        send({ type: 'telemetry', payload: event });
    };
    let unsubscribe: () => void = (): void => {};
    const telemetry_bind = (): void => {
        unsubscribe();
        unsubscribe = deps.calypso_get().telemetry_subscribe(telemetryForward);
    };

    telemetry_bind();

    ws.on('message', async (data: Buffer | string) => {
        let msg: ClientMessage;
        try {
            msg = JSON.parse(typeof data === 'string' ? data : data.toString()) as ClientMessage;
        } catch {
            send({ type: 'error', id: 'unknown', message: 'Invalid JSON' });
            return;
        }

        try {
            switch (msg.type) {
                case 'command': {
                    const calypso = deps.calypso_get();
                    const response = await calypso.command_execute(msg.command);
                    send({ type: 'response', id: msg.id, payload: response });
                    break;
                }

                case 'login': {
                    const sanitized = msg.username.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'developer';
                    deps.calypso_reinitialize(sanitized);
                    
                    // 1. Bind telemetry FIRST
                    telemetry_bind();
                    
                    // 2. Await the Boot Sequence so telemetry streams in real-time
                    const calypso = deps.calypso_get();
                    try {
                        await calypso.boot();
                    } catch (e) {
                        console.error('Handshake boot failed:', e);
                        const reason: string = e instanceof Error ? e.message : 'Unknown boot error';
                        send({
                            type: 'error',
                            id: msg.id,
                            message: `Boot failed: ${reason}`
                        });
                        break;
                    }

                    console.log(`WS Login: User "${sanitized}" authenticated`);
                    send({
                        type: 'login-response',
                        id: msg.id,
                        success: true,
                        username: sanitized,
                        workflows: calypso.workflows_available()
                    });
                    break;
                }

                case 'persona': {
                    const calypso = deps.calypso_get();
                    if (!msg.workflowId || msg.workflowId === 'skip' || msg.workflowId === 'none') {
                        await calypso.workflow_set(null);
                        send({
                            type: 'persona-response',
                            id: msg.id,
                            success: true,
                            message: 'Workflow guidance disabled'
                        });
                    } else {
                        const success = await calypso.workflow_set(msg.workflowId);
                        send({
                            type: 'persona-response',
                            id: msg.id,
                            success,
                            message: success
                                ? `Workflow set: ${msg.workflowId}`
                                : `Unknown workflow: ${msg.workflowId}`
                        });
                    }
                    break;
                }

                case 'prompt': {
                    const calypso = deps.calypso_get();
                    send({
                        type: 'prompt-response',
                        id: msg.id,
                        prompt: calypso.prompt_get()
                    });
                    break;
                }

                case 'tab-complete': {
                    const calypso = deps.calypso_get();
                    const completions = calypso.tab_complete(msg.line);
                    send({
                        type: 'tab-complete-response',
                        id: msg.id,
                        completions,
                        partial: msg.line
                    });
                    break;
                }

                default:
                    send({
                        type: 'error',
                        id: (msg as { id?: string }).id || 'unknown',
                        message: `Unknown message type: ${(msg as { type: string }).type}`
                    });
            }
        } catch (e: unknown) {
            const error = e instanceof Error ? e.message : 'Unknown error';
            send({ type: 'error', id: msg.id, message: error });
        }
    });

    ws.on('close', () => {
        unsubscribe();
        console.log(`WebSocket client disconnected`);
    });

    ws.on('error', (err: Error) => {
        console.error(`WebSocket error: ${err.message}`);
    });
}
