import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'child_process';
import { dagBoxGraphviz_render } from './graphvizBox.js';

vi.mock('child_process', () => ({
    spawnSync: vi.fn(),
}));

const spawnSyncMock = vi.mocked(spawnSync);

describe('dag/visualizer/graphvizBox', () => {
    beforeEach(() => {
        spawnSyncMock.mockReset();
    });

    it('falls back when graphviz execution fails/times out', () => {
        spawnSyncMock.mockReturnValue({
            pid: 101,
            output: [null, '', ''],
            stdout: '',
            stderr: 'timed out',
            status: null,
            signal: 'SIGTERM',
            error: Object.assign(new Error('spawnSync dot ETIMEDOUT'), { code: 'ETIMEDOUT' }),
        } as unknown as ReturnType<typeof spawnSync>);

        const lines: string[] = dagBoxGraphviz_render({
            nodes: [
                { id: 'a', line1: '○ a', line2: 'Stage A', order: 1 },
                { id: 'b', line1: '○ b', line2: 'Stage B', order: 2 },
            ],
            edges: [{ from: 'a', to: 'b' }],
        });

        expect(spawnSyncMock).toHaveBeenCalledOnce();
        expect(lines[0]).toContain('graphviz unavailable');
    });

    it('renders box-glyph output from graphviz plain layout', () => {
        const plain = [
            'graph 1 4 4',
            'node "a" 2 3 1 0.5 "a" solid box black lightgrey',
            'node "b" 2 1 1 0.5 "b" solid box black lightgrey',
            'edge "a" "b" 2 2 2.75 2 1.25 solid black',
            'stop',
        ].join('\n');

        spawnSyncMock.mockReturnValue({
            pid: 102,
            output: [null, plain, ''],
            stdout: plain,
            stderr: '',
            status: 0,
            signal: null,
            error: undefined,
        } as unknown as ReturnType<typeof spawnSync>);

        const lines: string[] = dagBoxGraphviz_render({
            nodes: [
                { id: 'a', line1: '○ a', line2: 'Stage A', order: 1 },
                { id: 'b', line1: '○ b', line2: 'Stage B', order: 2 },
            ],
            edges: [{ from: 'a', to: 'b' }],
        });

        expect(lines.some((line: string): boolean => line.includes('┌'))).toBe(true);
        expect(lines.some((line: string): boolean => line.includes('▼'))).toBe(true);
        expect(lines[0]).not.toContain('graphviz unavailable');
    });
});

