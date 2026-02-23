/**
 * @file Workflow Routes
 *
 * Handles workflow persona and discovery endpoints.
 *
 * @module
 */

import { body_parse, bodyString_get, json_send } from '../http.js';
import type { WorkflowSummary } from '../../../../dag/bridge/WorkflowAdapter.js';
import type { RestRouteContext } from '../types.js';

/**
 * Handle workflow configuration routes.
 *
 * @param context - Route context.
 * @returns True if handled.
 */
export async function route_workflowHandle(context: RestRouteContext): Promise<boolean> {
    if (context.pathname === '/calypso/persona' && context.method === 'POST') {
        const body: Record<string, unknown> = await body_parse(context.req);
        const workflowId: string | null = bodyString_get(body, 'workflowId');

        if (!workflowId || workflowId === 'none' || workflowId === 'skip') {
            context.calypso.workflow_set(null);
            console.log('Persona: Workflow guidance disabled');
            json_send(context.res, { message: 'Workflow guidance disabled', workflow: null });
            return true;
        }

        const selected: boolean = await context.calypso.workflow_set(workflowId);
        if (!selected) {
            json_send(context.res, { error: `Unknown workflow: ${workflowId}` }, 400);
            return true;
        }

        const workflows: WorkflowSummary[] = context.calypso.workflows_available();
        const chosen: WorkflowSummary | undefined = workflows.find(
            (workflow: WorkflowSummary): boolean => workflow.id === workflowId
        );
        console.log(`Persona: Workflow set to "${workflowId}"`);
        json_send(context.res, { message: `Workflow set: ${chosen?.name || workflowId}`, workflow: chosen });
        return true;
    }

    if (context.pathname === '/calypso/workflows' && context.method === 'GET') {
        json_send(context.res, { workflows: context.calypso.workflows_available() });
        return true;
    }

    return false;
}
