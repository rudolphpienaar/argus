/**
 * @file Graphviz-backed DAG box renderer
 *
 * Produces terminal-friendly box-glyph DAG visuals by delegating node layout
 * and edge routing to Graphviz (`dot -Tplain`), then rasterizing to a glyph
 * canvas.
 */

import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export interface DagBoxNodeInput {
    id: string;
    line1: string;
    line2: string;
    order: number;
}

export interface DagBoxEdgeInput {
    from: string;
    to: string;
}

export interface DagBoxRenderInput {
    nodes: DagBoxNodeInput[];
    edges: DagBoxEdgeInput[];
}

interface Point {
    x: number;
    y: number;
}

interface LayoutNode {
    id: string;
    x: number;
    y: number;
}

interface LayoutEdge {
    from: string;
    to: string;
    points: Point[];
}

interface LayoutGraph {
    width: number;
    height: number;
    nodes: Map<string, LayoutNode>;
    edges: LayoutEdge[];
}

const BOX_W = 30;
const BOX_H = 4;
const X_SCALE = 12;
const Y_SCALE = 6;
const DOT_TIMEOUT_MS = 5000;

const DIR_N = 1;
const DIR_E = 2;
const DIR_S = 4;
const DIR_W = 8;

/**
 * Render a boxed DAG using graphviz layout when available.
 */
export function dagBoxGraphviz_render(input: DagBoxRenderInput): string[] {
    const nodes: DagBoxNodeInput[] = [...input.nodes].sort((a: DagBoxNodeInput, b: DagBoxNodeInput): number => a.order - b.order);
    const edges: DagBoxEdgeInput[] = [...input.edges];
    const layout: LayoutGraph | null = graphvizLayout_resolve(nodes, edges);

    if (!layout) {
        return fallback_render(nodes, edges);
    }

    const nodeGeo: Map<string, { x: number; y: number; cx: number; cy: number }> = new Map();
    const edgePoints: LayoutEdge[] = [];
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const node of nodes) {
        const ln: LayoutNode | undefined = layout.nodes.get(node.id);
        if (!ln) continue;
        const cx = Math.round(ln.x * X_SCALE);
        const cy = Math.round((layout.height - ln.y) * Y_SCALE);
        const x = Math.round(cx - Math.floor(BOX_W / 2));
        const y = Math.round(cy - Math.floor(BOX_H / 2));
        nodeGeo.set(node.id, { x, y, cx, cy });
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + BOX_W + 1);
        maxY = Math.max(maxY, y + BOX_H + 1);
    }

    for (const edge of layout.edges) {
        const transformed: Point[] = edge.points.map((p: Point): Point => ({
            x: Math.round(p.x * X_SCALE),
            y: Math.round((layout.height - p.y) * Y_SCALE),
        }));
        for (const p of transformed) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        }
        edgePoints.push({ ...edge, points: dedupe_points(transformed) });
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
        return fallback_render(nodes, edges);
    }

    const shiftX = minX < 2 ? 2 - minX : 0;
    const shiftY = minY < 1 ? 1 - minY : 0;

    for (const geo of nodeGeo.values()) {
        geo.x += shiftX;
        geo.y += shiftY;
        geo.cx += shiftX;
        geo.cy += shiftY;
    }
    for (const edge of edgePoints) {
        edge.points = edge.points.map((p: Point): Point => ({ x: p.x + shiftX, y: p.y + shiftY }));
    }

    const width = Math.max(1, maxX + shiftX + 3);
    const height = Math.max(1, maxY + shiftY + 3);
    const edgeMask: number[][] = Array.from({ length: height }, (): number[] => Array.from({ length: width }, (): number => 0));
    const overlay: string[][] = Array.from({ length: height }, (): string[] => Array.from({ length: width }, (): string => ' '));

    const connect = (a: Point, b: Point): void => {
        if (a.x === b.x && a.y === b.y) return;
        if (a.x === b.x) {
            const step = b.y > a.y ? 1 : -1;
            for (let y = a.y; y !== b.y; y += step) {
                bit_add(edgeMask, a.x, y, step > 0 ? DIR_S : DIR_N);
                bit_add(edgeMask, a.x, y + step, step > 0 ? DIR_N : DIR_S);
            }
            return;
        }
        if (a.y === b.y) {
            const step = b.x > a.x ? 1 : -1;
            for (let x = a.x; x !== b.x; x += step) {
                bit_add(edgeMask, x, a.y, step > 0 ? DIR_E : DIR_W);
                bit_add(edgeMask, x + step, a.y, step > 0 ? DIR_W : DIR_E);
            }
            return;
        }
        // Non-orthogonal pair after rounding: route as L-shape.
        connect(a, { x: b.x, y: a.y });
        connect({ x: b.x, y: a.y }, b);
    };

    for (const edge of edgePoints) {
        const pts: Point[] = edge.points;
        if (pts.length < 2) continue;
        for (let i = 0; i < pts.length - 1; i++) {
            connect(pts[i], pts[i + 1]);
        }
    }

    // Draw boxes after edges for readability.
    for (const node of nodes) {
        const geo = nodeGeo.get(node.id);
        if (!geo) continue;
        box_draw(overlay, geo.x, geo.y, node.line1, node.line2);
    }

    // Arrowheads rendered last.
    for (const edge of edgePoints) {
        if (edge.points.length < 2) continue;
        const tail: Point = edge.points[edge.points.length - 2];
        const head: Point = edge.points[edge.points.length - 1];
        const dx = head.x - tail.x;
        const dy = head.y - tail.y;
        let arrow = '▼';
        if (Math.abs(dx) > Math.abs(dy)) {
            arrow = dx > 0 ? '▶' : '◀';
        } else if (Math.abs(dy) > 0) {
            arrow = dy > 0 ? '▼' : '▲';
        }
        char_put(overlay, head.x, head.y, arrow);
    }

    const rows: string[] = [];
    for (let y = 0; y < height; y++) {
        let row = '';
        for (let x = 0; x < width; x++) {
            if (overlay[y][x] !== ' ') {
                row += overlay[y][x];
            } else {
                row += edgeGlyph_resolve(edgeMask[y][x]);
            }
        }
        rows.push(row.replace(/\s+$/g, ''));
    }

    while (rows.length > 0 && rows[rows.length - 1].trim().length === 0) {
        rows.pop();
    }
    return rows;
}

/**
 * Resolve graph layout from Graphviz plain output.
 */
function graphvizLayout_resolve(nodes: DagBoxNodeInput[], edges: DagBoxEdgeInput[]): LayoutGraph | null {
    const dot = dotSource_build(nodes, edges);
    const tempDir: string = mkdtempSync(join(tmpdir(), 'argus-dag-'));
    const dotPath: string = join(tempDir, 'graph.dot');
    let result: ReturnType<typeof spawnSync>;

    try {
        writeFileSync(dotPath, dot, { encoding: 'utf-8' });
        result = spawnSync('dot', ['-Tplain', dotPath], {
            encoding: 'utf-8',
            maxBuffer: 4 * 1024 * 1024,
            timeout: DOT_TIMEOUT_MS,
        });
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }

    const err = result.error as NodeJS.ErrnoException | undefined;
    const hasStdout: boolean = typeof result.stdout === 'string' && result.stdout.length > 0;
    const ignorableEperm: boolean =
        err?.code === 'EPERM' &&
        result.status === 0 &&
        hasStdout;

    if ((err && !ignorableEperm) || result.status !== 0 || !hasStdout) {
        return null;
    }

    const graph: LayoutGraph = {
        width: 0,
        height: 0,
        nodes: new Map<string, LayoutNode>(),
        edges: [],
    };

    const lines: string[] = (result.stdout as string).split(/\r?\n/).map((line: string): string => line.trim()).filter(Boolean);
    for (const line of lines) {
        const t: string[] = tokens_split(line);
        if (t.length === 0) continue;

        if (t[0] === 'graph' && t.length >= 4) {
            graph.width = Number(t[2]);
            graph.height = Number(t[3]);
            continue;
        }

        if (t[0] === 'node' && t.length >= 4) {
            const id: string = token_unquote(t[1]);
            graph.nodes.set(id, { id, x: Number(t[2]), y: Number(t[3]) });
            continue;
        }

        if (t[0] === 'edge' && t.length >= 6) {
            const from: string = token_unquote(t[1]);
            const to: string = token_unquote(t[2]);
            const n: number = Number(t[3]);
            const points: Point[] = [];
            const count = Math.max(0, Math.min(n, Math.floor((t.length - 4) / 2)));
            for (let i = 0; i < count; i++) {
                const x = Number(t[4 + i * 2]);
                const y = Number(t[5 + i * 2]);
                if (Number.isFinite(x) && Number.isFinite(y)) {
                    points.push({ x, y });
                }
            }
            graph.edges.push({ from, to, points });
        }
    }

    if (!Number.isFinite(graph.width) || !Number.isFinite(graph.height) || graph.nodes.size === 0) {
        return null;
    }
    return graph;
}

function dotSource_build(nodes: DagBoxNodeInput[], edges: DagBoxEdgeInput[]): string {
    const lines: string[] = [
        'digraph G {',
        // `splines=ortho` can stall on some graphviz builds for moderately
        // branched DAGs; polyline keeps layout predictable without deadlocking.
        '  graph [rankdir=TB, splines=polyline, nodesep=0.5, ranksep=0.8];',
        '  node [shape=box, width=2.5, height=0.75, fixedsize=true, fontsize=10, fontname="Courier"];',
        '  edge [arrowsize=0.5];',
    ];

    for (const node of nodes) {
        lines.push(`  "${dot_escape(node.id)}" [label="${dot_escape(node.id)}"];`);
    }
    for (const edge of edges) {
        lines.push(`  "${dot_escape(edge.from)}" -> "${dot_escape(edge.to)}";`);
    }

    lines.push('}');
    return lines.join('\n');
}

function dot_escape(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function tokens_split(line: string): string[] {
    return line.match(/"[^"]*"|\S+/g) || [];
}

function token_unquote(token: string): string {
    if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) {
        return token.slice(1, -1);
    }
    return token;
}

function dedupe_points(points: Point[]): Point[] {
    const out: Point[] = [];
    for (const p of points) {
        const last: Point | undefined = out[out.length - 1];
        if (!last || last.x !== p.x || last.y !== p.y) {
            out.push(p);
        }
    }
    return out;
}

function bit_add(mask: number[][], x: number, y: number, bit: number): void {
    if (y < 0 || y >= mask.length || x < 0 || x >= mask[0].length) return;
    mask[y][x] |= bit;
}

function edgeGlyph_resolve(mask: number): string {
    switch (mask) {
        case 0: return ' ';
        case DIR_N:
        case DIR_S:
        case DIR_N | DIR_S: return '│';
        case DIR_E:
        case DIR_W:
        case DIR_E | DIR_W: return '─';
        case DIR_N | DIR_E: return '└';
        case DIR_N | DIR_W: return '┘';
        case DIR_S | DIR_E: return '┌';
        case DIR_S | DIR_W: return '┐';
        case DIR_N | DIR_S | DIR_E: return '├';
        case DIR_N | DIR_S | DIR_W: return '┤';
        case DIR_E | DIR_W | DIR_N: return '┴';
        case DIR_E | DIR_W | DIR_S: return '┬';
        default: return '┼';
    }
}

function box_draw(canvas: string[][], x: number, y: number, line1: string, line2: string): void {
    const inner = BOX_W - 2;
    char_put(canvas, x, y, '┌');
    for (let i = 1; i <= inner; i++) char_put(canvas, x + i, y, '─');
    char_put(canvas, x + inner + 1, y, '┐');

    const row1 = label_fit(line1, inner);
    const row2 = label_fit(line2, inner);
    char_put(canvas, x, y + 1, '│');
    for (let i = 0; i < inner; i++) char_put(canvas, x + 1 + i, y + 1, row1[i]);
    char_put(canvas, x + inner + 1, y + 1, '│');

    char_put(canvas, x, y + 2, '│');
    for (let i = 0; i < inner; i++) char_put(canvas, x + 1 + i, y + 2, row2[i]);
    char_put(canvas, x + inner + 1, y + 2, '│');

    char_put(canvas, x, y + 3, '└');
    for (let i = 1; i <= inner; i++) char_put(canvas, x + i, y + 3, '─');
    char_put(canvas, x + inner + 1, y + 3, '┘');
}

function label_fit(value: string, width: number): string {
    const compact = value.length > width ? `${value.slice(0, Math.max(0, width - 1))}…` : value;
    return compact.padEnd(width, ' ');
}

function char_put(canvas: string[][], x: number, y: number, ch: string): void {
    if (y < 0 || y >= canvas.length || x < 0 || x >= canvas[0].length) return;
    canvas[y][x] = ch;
}

function fallback_render(nodes: DagBoxNodeInput[], edges: DagBoxEdgeInput[]): string[] {
    const lines: string[] = ['(graphviz unavailable; fallback render)', ''];
    const childMap: Map<string, string[]> = new Map<string, string[]>();
    for (const n of nodes) childMap.set(n.id, []);
    for (const edge of edges) {
        if (childMap.has(edge.from)) childMap.get(edge.from)!.push(edge.to);
    }
    for (const node of nodes) {
        const width = Math.max(node.line1.length, node.line2.length) + 2;
        lines.push(`┌${'─'.repeat(width)}┐`);
        lines.push(`│ ${label_fit(node.line1, width - 2)} │`);
        lines.push(`│ ${label_fit(node.line2, width - 2)} │`);
        lines.push(`└${'─'.repeat(width)}┘`);
        const children = childMap.get(node.id) || [];
        children.forEach((child: string, i: number): void => {
            lines.push(`${i === children.length - 1 ? '└' : '├'}─► ${child}`);
        });
        lines.push('');
    }
    return lines;
}
