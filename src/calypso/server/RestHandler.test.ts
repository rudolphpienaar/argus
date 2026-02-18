import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import type http from 'http';
import { restRequest_handle } from './RestHandler.js';
import type { RestHandlerDeps } from './rest/types.js';
import type { CalypsoCore } from '../../lcarslm/CalypsoCore.js';
import { CalypsoStatusCode } from '../../lcarslm/types.js';

interface ResponseCapture {
    statusCode: number | null;
    headers: Record<string, string>;
    body: string;
}

class MockRequest extends EventEmitter {
    public method?: string;
    public url?: string;

    constructor(method: string, url: string) {
        super();
        this.method = method;
        this.url = url;
    }

    body_emit(payload: string): void {
        this.emit('data', payload);
        this.emit('end');
    }
}

function response_create(): { res: http.ServerResponse; capture: ResponseCapture } {
    const capture: ResponseCapture = {
        statusCode: null,
        headers: {},
        body: ''
    };

    let res: http.ServerResponse;
    const responseStub = {
        writeHead(statusCode: number, headers?: Record<string, string>): http.ServerResponse {
            capture.statusCode = statusCode;
            capture.headers = headers ?? {};
            return res;
        },
        end(chunk?: unknown): http.ServerResponse {
            if (typeof chunk === 'string') {
                capture.body += chunk;
            }
            return res;
        }
    };

    res = responseStub as unknown as http.ServerResponse;

    return { res, capture };
}

function deps_create(): RestHandlerDeps {
    const calypso: CalypsoCore = {
        version_get(): string {
            return 'test-version';
        },
        async command_execute(): Promise<{
            message: string;
            actions: [];
            success: true;
            statusCode: CalypsoStatusCode.OK;
        }> {
            return {
                message: 'ok',
                actions: [],
                success: true,
                statusCode: CalypsoStatusCode.OK
            };
        }
    } as unknown as CalypsoCore;

    return {
        calypso_get(): CalypsoCore {
            return calypso;
        },
        calypso_reinitialize(): CalypsoCore {
            return calypso;
        },
        host: '127.0.0.1',
        port: 8080
    };
}

describe('restRequest_handle', (): void => {
    it('returns false for unhandled routes', async (): Promise<void> => {
        const req: http.IncomingMessage = new MockRequest('GET', '/unhandled') as unknown as http.IncomingMessage;
        const { res } = response_create();

        const handled: boolean = await restRequest_handle(req, res, deps_create());
        expect(handled).toBe(false);
    });

    it('handles CORS preflight requests', async (): Promise<void> => {
        const req: http.IncomingMessage = new MockRequest('OPTIONS', '/anything') as unknown as http.IncomingMessage;
        const { res, capture } = response_create();

        const handled: boolean = await restRequest_handle(req, res, deps_create());
        expect(handled).toBe(true);
        expect(capture.statusCode).toBe(204);
        expect(capture.headers['Access-Control-Allow-Origin']).toBe('*');
    });

    it('handles root health route', async (): Promise<void> => {
        const req: http.IncomingMessage = new MockRequest('GET', '/') as unknown as http.IncomingMessage;
        const { res, capture } = response_create();

        const handled: boolean = await restRequest_handle(req, res, deps_create());
        expect(handled).toBe(true);
        expect(capture.statusCode).toBe(200);
        expect(capture.body).toContain('"service": "Calypso Server"');
        expect(capture.body).toContain('"version": "test-version"');
    });

    it('returns HTTP 500 when a route throws while handling request body', async (): Promise<void> => {
        const reqImpl: MockRequest = new MockRequest('POST', '/calypso/command');
        const req: http.IncomingMessage = reqImpl as unknown as http.IncomingMessage;
        const { res, capture } = response_create();

        const handlePromise: Promise<boolean> = restRequest_handle(req, res, deps_create());
        reqImpl.body_emit('{ invalid json');
        const handled: boolean = await handlePromise;

        expect(handled).toBe(true);
        expect(capture.statusCode).toBe(500);
        expect(capture.body).toContain('Invalid JSON');
    });
});
