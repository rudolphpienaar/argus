/**
 * @file WebSocket Connection Handler
 *
 * Per-connection handler that maps WebSocket messages to CalypsoCore
 * method calls and sends typed responses with correlation IDs.
 *
 * @module
 */

import type { WebSocket } from 'ws';
import type { CalypsoCore } from '../../lcarslm/CalypsoCore.js';
import type {
    ClientMessage,
    ServerMessage
} from '../protocol/types.js';

export interface WebSocketHandlerDeps {
    calypso_get: () => CalypsoCore;
    calypso_reinitialize: (username?: string) => CalypsoCore;
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
                    const calypso = deps.calypso_get();
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
                        calypso.workflow_set(null);
                        send({
                            type: 'persona-response',
                            id: msg.id,
                            success: true,
                            message: 'Workflow guidance disabled'
                        });
                    } else {
                        const success = calypso.workflow_set(msg.workflowId);
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
                    // Tab completion via VFS ls — simplified for now
                    const calypso = deps.calypso_get();
                    try {
                        const response = await calypso.command_execute(`ls ${msg.line}`);
                        const names: string[] = [];
                        const lines = response.message.split('\n');
                        for (const line of lines) {
                            const match = line.match(/^(?:<[^>]+>)?([^\s<]+)/);
                            if (match && match[1]) {
                                names.push(match[1].replace(/<[^>]+>/g, ''));
                            }
                        }
                        send({
                            type: 'tab-complete-response',
                            id: msg.id,
                            completions: names,
                            partial: msg.line
                        });
                    } catch {
                        send({
                            type: 'tab-complete-response',
                            id: msg.id,
                            completions: [],
                            partial: msg.line
                        });
                    }
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
        // Connection cleanup — no per-connection state to clean up currently
    });

    ws.on('error', (err: Error) => {
        console.error(`WebSocket error: ${err.message}`);
    });
}
