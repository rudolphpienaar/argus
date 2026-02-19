/**
 * @file Calypso WebSocket Client
 *
 * Shared WebSocket transport used by both TUI and future WUI clients.
 * Provides typed request/response matching via correlation IDs and
 * Promise-based API for CalypsoCore operations.
 *
 * @module
 */

import WebSocket from 'ws';
import type { CalypsoResponse, TelemetryEvent } from '../../lcarslm/types.js';
import type { WorkflowSummary } from '../../core/workflows/types.js';
import type {
    ClientMessage,
    ServerMessage,
    LoginResponseMessage,
    PersonaResponseMessage,
    PromptResponseMessage,
    TabCompleteResponseMessage,
    ResponseMessage
} from '../protocol/types.js';
import { messageId_generate } from '../protocol/types.js';

export interface CalypsoClientOptions {
    url?: string;
    host?: string;
    port?: number;
}

interface PendingRequest {
    resolve: (msg: ServerMessage) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
}

/**
 * WebSocket client for communicating with CalypsoServer.
 */
export class CalypsoClient {
    private ws: WebSocket | null = null;
    private pending: Map<string, PendingRequest> = new Map();
    private readonly url: string;
    private readonly timeout: number = 30000;

    /** v10.2 Live telemetry listener. */
    public onTelemetry: ((event: TelemetryEvent) => void) | null = null;

    constructor(options: CalypsoClientOptions = {}) {
        if (options.url) {
            this.url = options.url;
        } else {
            const host = options.host || process.env.CALYPSO_HOST || 'localhost';
            const port = options.port || parseInt(process.env.CALYPSO_PORT || '8081', 10);
            this.url = `ws://${host}:${port}/calypso/ws`;
        }
    }

    /**
     * Connect to the CalypsoServer WebSocket endpoint.
     */
    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.url);

            this.ws.on('open', () => {
                resolve();
            });

            this.ws.on('message', (data: Buffer | string) => {
                try {
                    const msg = JSON.parse(typeof data === 'string' ? data : data.toString()) as ServerMessage;
                    
                    if (msg.type === 'telemetry') {
                        if (this.onTelemetry) this.onTelemetry(msg.payload);
                        return;
                    }

                    const pending = this.pending.get(msg.id);
                    if (pending) {
                        clearTimeout(pending.timer);
                        this.pending.delete(msg.id);
                        pending.resolve(msg);
                    }
                } catch {
                    // Ignore malformed messages
                }
            });

            this.ws.on('close', () => {
                // Reject all pending requests
                for (const [id, pending] of this.pending) {
                    clearTimeout(pending.timer);
                    pending.reject(new Error('Connection closed'));
                    this.pending.delete(id);
                }
                this.ws = null;
            });

            this.ws.on('error', (err: Error) => {
                if (!this.ws || this.ws.readyState === WebSocket.CONNECTING) {
                    reject(new Error(`Connection failed: ${err.message}`));
                }
            });
        });
    }

    /**
     * Disconnect from the server.
     */
    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    /**
     * Check if connected.
     */
    get connected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    /**
     * Send a typed message and wait for the correlated response.
     */
    private async request(msg: ClientMessage): Promise<ServerMessage> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('Not connected');
        }

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(msg.id);
                reject(new Error('Request timeout'));
            }, this.timeout);

            this.pending.set(msg.id, { resolve, reject, timer });
            this.ws!.send(JSON.stringify(msg));
        });
    }

    /**
     * Execute a command on the server.
     */
    async command_send(command: string): Promise<CalypsoResponse> {
        const id = messageId_generate();
        const response = await this.request({ type: 'command', id, command });
        if (response.type === 'error') {
            throw new Error(response.message);
        }
        return (response as ResponseMessage).payload;
    }

    /**
     * Login with username.
     */
    async login_send(username: string): Promise<{ success: boolean; username: string; workflows: WorkflowSummary[] }> {
        const id = messageId_generate();
        const response = await this.request({ type: 'login', id, username });
        if (response.type === 'error') {
            return { success: false, username, workflows: [] };
        }
        const loginResp = response as LoginResponseMessage;
        return {
            success: loginResp.success,
            username: loginResp.username,
            workflows: loginResp.workflows
        };
    }

    /**
     * Set persona/workflow.
     */
    async persona_send(workflowId: string | null): Promise<{ success: boolean; message: string }> {
        const id = messageId_generate();
        const response = await this.request({ type: 'persona', id, workflowId });
        if (response.type === 'error') {
            return { success: false, message: response.message };
        }
        const personaResp = response as PersonaResponseMessage;
        return { success: personaResp.success, message: personaResp.message };
    }

    /**
     * Fetch current prompt.
     */
    async prompt_fetch(): Promise<string> {
        const id = messageId_generate();
        const response = await this.request({ type: 'prompt', id });
        if (response.type === 'error') {
            return 'CALYPSO> ';
        }
        return (response as PromptResponseMessage).prompt;
    }

    /**
     * Request tab completions.
     */
    async tabComplete(line: string, cursor: number = line.length): Promise<{ completions: string[]; partial: string }> {
        const id = messageId_generate();
        const response = await this.request({ type: 'tab-complete', id, line, cursor });
        if (response.type === 'error') {
            return { completions: [], partial: line };
        }
        const tcResp = response as TabCompleteResponseMessage;
        return { completions: tcResp.completions, partial: tcResp.partial };
    }
}
