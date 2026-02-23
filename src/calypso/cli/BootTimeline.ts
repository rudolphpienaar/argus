/**
 * @file Boot timeline state for CLI rendering.
 *
 * Encapsulates idempotent milestone tracking for boot telemetry so REPL
 * rendering code can remain a thin cursor/IO adapter.
 *
 * @module
 */

import type { BootLogEvent, BootStatus } from '../../lcarslm/types.js';

export type BootPhaseKey = 'login_boot' | 'workflow_boot' | 'legacy';

interface BootTimelineRow {
    key: string;
    lineIndex: number;
    status: BootStatus;
    lastSeq: number | null;
}

type BootTimelineIgnoredReason = 'stale_seq' | 'status_regression';

export interface BootTimelineResultNew {
    kind: 'new';
    lineIndex: number;
    linesBack: number;
}

export interface BootTimelineResultUpdate {
    kind: 'update';
    lineIndex: number;
    linesBack: number;
}

export interface BootTimelineResultIgnore {
    kind: 'ignore';
    reason: BootTimelineIgnoredReason;
}

export type BootTimelineResult = BootTimelineResultNew | BootTimelineResultUpdate | BootTimelineResultIgnore;

/**
 * Stateful row tracker for CLI boot timeline updates.
 */
export class BootTimeline {
    private readonly rowsByKey: Map<string, BootTimelineRow> = new Map<string, BootTimelineRow>();
    private lineCount: number = 0;

    /**
     * Apply one boot event to the timeline.
     *
     * @param event - Incoming boot milestone event.
     * @returns New/update/ignore decision for the renderer.
     */
    public event_apply(event: BootLogEvent): BootTimelineResult {
        const phase: BootPhaseKey = bootPhase_resolve(event);
        const key: string = `${phase}:${event.id}`;
        const status: BootStatus = bootStatus_resolve(event.status);
        const seq: number | null = typeof event.seq === 'number' ? event.seq : null;
        const existing: BootTimelineRow | undefined = this.rowsByKey.get(key);

        if (!existing) {
            const row: BootTimelineRow = {
                key,
                lineIndex: this.lineCount,
                status,
                lastSeq: seq,
            };
            this.rowsByKey.set(key, row);
            this.lineCount += 1;
            return {
                kind: 'new',
                lineIndex: row.lineIndex,
                linesBack: 0,
            };
        }

        if (seq !== null && existing.lastSeq !== null && seq <= existing.lastSeq) {
            return {
                kind: 'ignore',
                reason: 'stale_seq',
            };
        }

        if (this.status_rank(status) < this.status_rank(existing.status)) {
            return {
                kind: 'ignore',
                reason: 'status_regression',
            };
        }

        existing.status = status;
        if (seq !== null) {
            existing.lastSeq = seq;
        }

        return {
            kind: 'update',
            lineIndex: existing.lineIndex,
            linesBack: this.lineCount - existing.lineIndex,
        };
    }

    /**
     * Return current number of rendered rows.
     */
    public lineCount_get(): number {
        return this.lineCount;
    }

    /**
     * Reset timeline state.
     */
    public reset(): void {
        this.rowsByKey.clear();
        this.lineCount = 0;
    }

    /**
     * Strict monotonic rank for boot statuses.
     */
    private status_rank(status: BootStatus): number {
        const ranks: Record<BootStatus, number> = {
            WAIT: 0,
            OK: 1,
            FAIL: 2,
            DONE: 3,
        };
        return ranks[status];
    }
}

/**
 * Track whether any boot phase is currently active.
 */
export class BootPhaseLifecycle {
    private readonly activePhases: Set<BootPhaseKey> = new Set<BootPhaseKey>();

    /**
     * Apply one boot event to phase active-state.
     *
     * WAIT activates the phase; DONE/FAIL closes the phase.
     */
    public event_apply(event: BootLogEvent): void {
        const phase: BootPhaseKey = bootPhase_resolve(event);
        const status: BootStatus = bootStatus_resolve(event.status);

        if (status === 'WAIT') {
            this.activePhases.add(phase);
            return;
        }

        if (status === 'DONE' || status === 'FAIL') {
            this.activePhases.delete(phase);
        }
    }

    /**
     * Whether any boot phase is active.
     */
    public active_any(): boolean {
        return this.activePhases.size > 0;
    }

    /**
     * Return active phase keys (for diagnostics/tests).
     */
    public active_list(): BootPhaseKey[] {
        return Array.from(this.activePhases.values()).sort((left: BootPhaseKey, right: BootPhaseKey): number =>
            left.localeCompare(right),
        );
    }

    /**
     * Reset lifecycle state.
     */
    public reset(): void {
        this.activePhases.clear();
    }
}

/**
 * Normalize optional phase into internal phase key.
 */
function bootPhase_resolve(event: BootLogEvent): BootPhaseKey {
    if (event.phase === 'login_boot' || event.phase === 'workflow_boot') {
        return event.phase;
    }
    return 'legacy';
}

/**
 * Normalize nullable status to WAIT for ranking/consistency.
 */
function bootStatus_resolve(status: BootStatus | null): BootStatus {
    return status ?? 'WAIT';
}
