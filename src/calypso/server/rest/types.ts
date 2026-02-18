/**
 * @file REST Handler Types
 *
 * Shared interfaces for REST request handling and route modules.
 *
 * @module
 */

import http from 'http';
import type { URL } from 'url';
import type { CalypsoCore } from '../../../lcarslm/CalypsoCore.js';

export interface RestHandlerDeps {
    calypso_get: () => CalypsoCore;
    calypso_reinitialize: (username?: string) => CalypsoCore;
    host: string;
    port: number;
}

export interface RestRouteContext {
    req: http.IncomingMessage;
    res: http.ServerResponse;
    deps: RestHandlerDeps;
    url: URL;
    pathname: string;
    method: string;
    calypso: CalypsoCore;
}

export type RestRouteHandler = (context: RestRouteContext) => Promise<boolean>;
