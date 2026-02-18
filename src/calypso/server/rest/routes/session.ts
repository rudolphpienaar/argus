/**
 * @file Session Routes
 *
 * Handles login/reset/version/prompt endpoints.
 *
 * @module
 */

import { body_parse, bodyString_get, json_send } from '../http.js';
import type { CalypsoCore } from '../../../../lcarslm/CalypsoCore.js';
import type { RestRouteContext } from '../types.js';

/**
 * Handle session and identity lifecycle routes.
 *
 * @param context - Route context.
 * @returns True if handled.
 */
export async function route_sessionHandle(context: RestRouteContext): Promise<boolean> {
    if (context.pathname === '/calypso/reset' && context.method === 'POST') {
        context.deps.calypso_reinitialize();
        json_send(context.res, { message: 'System reset to clean state' });
        return true;
    }

    if (context.pathname === '/calypso/version' && context.method === 'GET') {
        json_send(context.res, { version: context.calypso.version_get() });
        return true;
    }

    if (context.pathname === '/calypso/prompt' && context.method === 'GET') {
        json_send(context.res, { prompt: context.calypso.prompt_get() });
        return true;
    }

    if (context.pathname === '/calypso/login' && context.method === 'POST') {
        const body: Record<string, unknown> = await body_parse(context.req);
        const requestedUsername: string = bodyString_get(body, 'username') || 'developer';
        const sanitizedUsername: string = username_sanitize(requestedUsername);

        context.deps.calypso_reinitialize(sanitizedUsername);
        const nextCalypso: CalypsoCore = context.deps.calypso_get();

        console.log(`Login: User "${sanitizedUsername}" authenticated`);
        json_send(context.res, {
            message: 'Login successful',
            username: sanitizedUsername,
            workflows: nextCalypso.workflows_available()
        });
        return true;
    }

    return false;
}

/**
 * Sanitize a user-provided username into a safe shell identity token.
 *
 * @param rawUsername - User-provided text.
 * @returns Sanitized username.
 */
function username_sanitize(rawUsername: string): string {
    const sanitized: string = rawUsername.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
    return sanitized || 'developer';
}
