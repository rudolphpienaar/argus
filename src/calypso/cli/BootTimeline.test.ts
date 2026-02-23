import { describe, expect, it } from 'vitest';
import type { BootLogEvent } from '../../lcarslm/types.js';
import { BootTimeline, BootPhaseLifecycle } from './BootTimeline.js';

function event_create(overrides: Partial<BootLogEvent> = {}): BootLogEvent {
    const base: BootLogEvent = {
        type: 'boot_log',
        phase: 'login_boot',
        id: 'sys_genesis',
        seq: 1,
        status: 'WAIT',
        message: 'INITIATING ARGUS CORE GENESIS',
        timestamp: '2026-02-22T00:00:00.000Z',
    };
    return { ...base, ...overrides };
}

describe('BootTimeline', (): void => {
    it('creates one row for first event and updates same row for same key', (): void => {
        const timeline: BootTimeline = new BootTimeline();

        const first = timeline.event_apply(event_create({ seq: 1, status: 'WAIT' }));
        const second = timeline.event_apply(event_create({ seq: 2, status: 'OK' }));

        expect(first.kind).toBe('new');
        expect(second.kind).toBe('update');
        expect(timeline.lineCount_get()).toBe(1);
    });

    it('ignores duplicate or stale sequence values for an existing row', (): void => {
        const timeline: BootTimeline = new BootTimeline();

        timeline.event_apply(event_create({ seq: 3, status: 'OK' }));
        const stale = timeline.event_apply(event_create({ seq: 2, status: 'OK' }));
        const duplicate = timeline.event_apply(event_create({ seq: 3, status: 'OK' }));

        expect(stale.kind).toBe('ignore');
        if (stale.kind === 'ignore') {
            expect(stale.reason).toBe('stale_seq');
        }

        expect(duplicate.kind).toBe('ignore');
        if (duplicate.kind === 'ignore') {
            expect(duplicate.reason).toBe('stale_seq');
        }
    });

    it('ignores status regression even with forward sequence', (): void => {
        const timeline: BootTimeline = new BootTimeline();

        timeline.event_apply(event_create({ seq: 1, status: 'WAIT' }));
        timeline.event_apply(event_create({ seq: 2, status: 'OK' }));
        const regression = timeline.event_apply(event_create({ seq: 3, status: 'WAIT' }));

        expect(regression.kind).toBe('ignore');
        if (regression.kind === 'ignore') {
            expect(regression.reason).toBe('status_regression');
        }
    });

    it('separates rows by phase for identical milestone ids', (): void => {
        const timeline: BootTimeline = new BootTimeline();

        const loginRow = timeline.event_apply(event_create({ phase: 'login_boot', id: 'sys_ready', seq: 1, status: 'DONE' }));
        const workflowRow = timeline.event_apply(event_create({
            phase: 'workflow_boot',
            id: 'sys_ready',
            seq: 1,
            status: 'WAIT',
            message: 'LOADING PERSONA MANIFEST',
        }));

        expect(loginRow.kind).toBe('new');
        expect(workflowRow.kind).toBe('new');
        expect(timeline.lineCount_get()).toBe(2);
    });
});

describe('BootPhaseLifecycle', (): void => {
    it('marks phase active on WAIT and clears it on DONE', (): void => {
        const lifecycle: BootPhaseLifecycle = new BootPhaseLifecycle();

        lifecycle.event_apply(event_create({ phase: 'login_boot', status: 'WAIT', seq: 1 }));
        expect(lifecycle.active_any()).toBe(true);
        expect(lifecycle.active_list()).toEqual(['login_boot']);

        lifecycle.event_apply(event_create({ phase: 'login_boot', status: 'DONE', seq: 2 }));
        expect(lifecycle.active_any()).toBe(false);
        expect(lifecycle.active_list()).toEqual([]);
    });

    it('clears phase on FAIL terminal state', (): void => {
        const lifecycle: BootPhaseLifecycle = new BootPhaseLifecycle();

        lifecycle.event_apply(event_create({ phase: 'workflow_boot', status: 'WAIT', seq: 1 }));
        expect(lifecycle.active_list()).toEqual(['workflow_boot']);

        lifecycle.event_apply(event_create({ phase: 'workflow_boot', status: 'FAIL', seq: 2 }));
        expect(lifecycle.active_any()).toBe(false);
    });

    it('keeps phases independent when both are active', (): void => {
        const lifecycle: BootPhaseLifecycle = new BootPhaseLifecycle();

        lifecycle.event_apply(event_create({ phase: 'login_boot', status: 'WAIT', seq: 1 }));
        lifecycle.event_apply(event_create({ phase: 'workflow_boot', status: 'WAIT', seq: 1 }));
        expect(lifecycle.active_list()).toEqual(['login_boot', 'workflow_boot']);

        lifecycle.event_apply(event_create({ phase: 'login_boot', status: 'DONE', seq: 2 }));
        expect(lifecycle.active_list()).toEqual(['workflow_boot']);
    });
});
