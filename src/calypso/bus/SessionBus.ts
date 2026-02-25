/**
 * @file Session Bus
 *
 * Compositor layer between the kernel and all surface adapters.
 *
 * Every intent submitted from any surface is:
 *   1. Executed exactly once by the kernel.
 *   2. Broadcast as a SessionEvent to all OTHER registered surfaces.
 *
 * The originator receives only the direct CalypsoResponse. Secondary
 * surfaces receive a full SessionEvent containing the same response —
 * identical to what the originator received. This enforces the
 * full-fidelity rendering contract: no surface receives a summary or
 * a notification; each runs its complete rendering pipeline on the
 * same CalypsoResponse.
 *
 * The SessionBus is NOT a new pub/sub framework. Surface broadcast
 * mechanics are two iterations over a Map. The novelty is in the
 * semantics: intent equivalence (WUI pill = TUI typed command at the
 * kernel level) and full-fidelity cross-surface rendering.
 *
 * See PRINCIPLES.md §6 (Surfaces are Views) and §7 (Intent Equivalence).
 *
 * @module calypso/bus/SessionBus
 */

import type { TelemetryEvent } from '../../lcarslm/types.js';
import type { WorkflowSummary } from '../../core/workflows/types.js';
import type { WebSocketCalypso, SessionEvent } from './types.js';
import type { CalypsoResponse } from '../../lcarslm/types.js';

/**
 * Routes intents to the kernel and broadcasts responses to all surfaces.
 */
export class SessionBus {
    private kernel: WebSocketCalypso;
    private readonly surfaces = new Map<string, (event: SessionEvent) => void>();

    constructor(kernel: WebSocketCalypso) {
        this.kernel = kernel;
    }

    /**
     * Replace the kernel reference when CalypsoCore is reinitialized (e.g. on login).
     * Existing surface registrations are preserved.
     */
    kernel_replace(newKernel: WebSocketCalypso): void {
        this.kernel = newKernel;
    }

    /**
     * Register a surface to receive cross-surface SessionEvents.
     *
     * @param id      Unique surface identifier for this connection.
     * @param handler Called for every intent NOT originating from this surface.
     * @returns Unregister function — call on disconnect.
     */
    surface_register(id: string, handler: (event: SessionEvent) => void): () => void {
        this.surfaces.set(id, handler);
        return () => this.surfaces.delete(id);
    }

    /**
     * Submit an intent from a surface.
     *
     * Executes the command exactly once via the kernel, then broadcasts
     * a SessionEvent to every OTHER registered surface.
     *
     * @param input    Raw command string as submitted.
     * @param sourceId Identifier of the submitting surface.
     * @returns The kernel's CalypsoResponse (for the originator).
     */
    async intent_submit(input: string, sourceId: string): Promise<CalypsoResponse> {
        const response = await this.kernel.command_execute(input);
        const event: SessionEvent = { sourceId, input, response, timestamp: Date.now() };
        for (const [id, handler] of this.surfaces) {
            if (id !== sourceId) handler(event);
        }
        return response;
    }

    // ─── Kernel Passthroughs ────────────────────────────────────────────────
    // These delegate directly to the kernel. The bus is the single point of
    // contact for all surfaces — they never hold a direct kernel reference.

    async boot(): Promise<void> {
        return this.kernel.boot();
    }

    async workflow_set(workflowId: string | null): Promise<boolean> {
        return this.kernel.workflow_set(workflowId);
    }

    prompt_get(): string {
        return this.kernel.prompt_get();
    }

    tab_complete(line: string): string[] {
        return this.kernel.tab_complete(line);
    }

    workflows_available(): WorkflowSummary[] {
        return this.kernel.workflows_available();
    }

    telemetry_subscribe(observer: (event: TelemetryEvent) => void): () => void {
        return this.kernel.telemetry_subscribe(observer);
    }
}
