/**
 * @file TUI Renderer
 *
 * Terminal UI rendering: colors, spinner, animated output, table
 * formatting, and message styling. Shared by the CLI REPL and any
 * future TUI surface that renders CalypsoResponse in a terminal.
 *
 * @module
 */

import { syntaxHighlight_renderAnsi, catLanguage_detect } from './SyntaxHighlight.js';
import type { CalypsoResponse } from '../../../lcarslm/types.js';
import { WorkflowAdapter } from '../../../dag/bridge/WorkflowAdapter.js';

// ─── ANSI Colors ────────────────────────────────────────────────────────────

/** Dark background optimized ANSI color palette. */
export const COLORS = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    italic: '\x1b[3m',
    underline: '\x1b[4m',
    dim: '\x1b[90m',
    cyan: '\x1b[96m',
    yellow: '\x1b[93m',
    red: '\x1b[91m',
    green: '\x1b[92m',
    blue: '\x1b[94m',
    magenta: '\x1b[95m',
    white: '\x1b[97m',
    hideCursor: '\x1b[?25l',
    showCursor: '\x1b[?25h'
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Sleep for specified milliseconds. */
export function sleep_ms(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Strip ANSI codes from string for length calculation. */
export function ansi_strip(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// ─── Spinner ────────────────────────────────────────────────────────────────

const SPINNER_FRAMES: readonly string[] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface CommandExecuteOptions {
    scriptStep?: boolean;
    stepIndex?: number;
    stepTotal?: number;
}

/**
 * Starts a thinking spinner on the current line.
 * Returns a stop function that clears the spinner.
 */
export function spinner_start(label: string = 'CALYPSO thinking'): () => void {
    let frameIdx: number = 0;
    process.stdout.write(COLORS.hideCursor);

    const timer: NodeJS.Timeout = setInterval((): void => {
        const frame: string = SPINNER_FRAMES[frameIdx % SPINNER_FRAMES.length];
        process.stdout.write(`\r${COLORS.cyan}${frame}${COLORS.reset} ${COLORS.dim}${label}...${COLORS.reset}  `);
        frameIdx++;
    }, 80);

    return (): void => {
        clearInterval(timer);
        process.stdout.write(`\r${' '.repeat(label.length + 10)}\r`);
        process.stdout.write(COLORS.showCursor);
    };
}

/**
 * Resolve spinner label by command intent.
 */
export function spinnerLabel_resolve(
    input: string, 
    options: CommandExecuteOptions = {},
    ui_hints?: CalypsoResponse['ui_hints']
): string {
    if (ui_hints?.spinner_label) {
        return ui_hints.spinner_label;
    }
    const stepPrefix: string = options.scriptStep && options.stepIndex && options.stepTotal
        ? `STEP ${options.stepIndex}/${options.stepTotal} · `
        : '';
    return `${stepPrefix}CALYPSO thinking`;
}

/**
 * Resolve minimum spinner duration per command to avoid instant flashes.
 */
export function spinnerMinDuration_resolve(input: string, options: CommandExecuteOptions = {}): number {
    if (options.scriptStep) return 1400;
    return 280;
}

// ─── Script Step Telemetry ──────────────────────────────────────────────────

export interface ScriptStepPlan {
    title: string;
    lines: string[];
}

/**
 * Build command-like hint for spinner/telemetry based on structured action.
 */
export function stepCommandHint_build(action: string, params: Record<string, unknown>): string {
    switch (action) {
        case 'search':
            return `search ${String(params.query || '')}`.trim();
        case 'add':
            return `add ${String(params.dataset || '')}`.trim();
        case 'rename':
            return `rename ${String(params.project || '')}`.trim();
        case 'run_python':
            return `python ${String(params.script || 'train.py')}`.trim();
        default:
            return action;
    }
}

// ─── Reactive UI Primitives ────────────────────────────────────────────────

const FRAME_WIDTH: number = 64;

/**
 * Open a styled UI frame (box start).
 */
export function rendererFrame_open(title: string, subtitle?: string): void {
    const boxRule_print = (left: '╔' | '╠' | '╚', right: '╗' | '╣' | '╝'): void => {
        console.log(`${COLORS.cyan}${left}${'═'.repeat(FRAME_WIDTH)}${right}${COLORS.reset}`);
    };

    const boxRow_print = (content: string = ''): void => {
        const visibleLength: number = Array.from(ansi_strip(content)).length;
        const paddingLength: number = Math.max(0, FRAME_WIDTH - visibleLength);
        console.log(`${COLORS.cyan}║${COLORS.reset}${content}${' '.repeat(paddingLength)}${COLORS.cyan}║${COLORS.reset}`);
    };

    process.stdout.write(COLORS.hideCursor);
    console.log();
    boxRule_print('╔', '╗');
    boxRow_print(`  ${COLORS.bright}${COLORS.yellow}${title.toUpperCase()}${COLORS.reset}`);
    if (subtitle) {
        boxRow_print(`  ${COLORS.dim}${subtitle}${COLORS.reset}`);
    }
    boxRule_print('╠', '╣');
}

/**
 * Close a styled UI frame (box end) and print summary.
 */
export function rendererFrame_close(summary?: string[]): void {
    const boxRule_print = (left: '╔' | '╠' | '╚', right: '╗' | '╣' | '╝'): void => {
        console.log(`${COLORS.cyan}${left}${'═'.repeat(FRAME_WIDTH)}${right}${COLORS.reset}`);
    };

    const boxRow_print = (content: string = ''): void => {
        const visibleLength: number = Array.from(ansi_strip(content)).length;
        const paddingLength: number = Math.max(0, FRAME_WIDTH - visibleLength);
        console.log(`${COLORS.cyan}║${COLORS.reset}${content}${' '.repeat(paddingLength)}${COLORS.cyan}║${COLORS.reset}`);
    };

    if (summary && summary.length > 0) {
        boxRow_print();
        boxRow_print(`  ${COLORS.bright}EXECUTION SUMMARY${COLORS.reset}`);
        boxRow_print();
        for (const stat of summary) {
            boxRow_print(`  ${COLORS.green}✓${COLORS.reset} ${stat}`);
        }
    }

    boxRow_print();
    boxRule_print('╚', '╝');
    console.log();
    process.stdout.write(COLORS.showCursor);
}

/**
 * Mark the start of a sub-phase within an open frame.
 */
export function rendererPhase_start(name: string): void {
    const boxRow_print = (content: string = ''): void => {
        const visibleLength: number = Array.from(ansi_strip(content)).length;
        const paddingLength: number = Math.max(0, FRAME_WIDTH - visibleLength);
        console.log(`${COLORS.cyan}║${COLORS.reset}${content}${' '.repeat(paddingLength)}${COLORS.cyan}║${COLORS.reset}`);
    };

    boxRow_print();
    boxRow_print(`  ${COLORS.green}▶${COLORS.reset} ${COLORS.bright}${name}${COLORS.reset}`);
}

/**
 * Stream response output line-by-line for realistic execution feel.
 *
 * v10.1+: Fully data-driven. No workflow-specific string-sniffing or regex.
 * Behavior is controlled via message content and ui_hints.
 */
export async function response_renderAnimated(
    message: string,
    input: string,
    options: CommandExecuteOptions = {},
    ui_hints?: CalypsoResponse['ui_hints']
): Promise<void> {
    const renderMode = ui_hints?.render_mode || 'plain';
    
    if (renderMode === 'plain') {
        console.log(message_style(message, { input }));
        return;
    }

    // Handle generic step animation primitive
    if (ui_hints?.animation === 'harmonization' && ui_hints?.animation_config) {
        await stepAnimation_render(ui_hints.animation_config);
        return;
    }

    // Generic line streaming
    const lines: string[] = message.split('\n');
    const baseDelay: number = ui_hints?.stream_delay_ms ?? 50;

    for (const line of lines) {
        console.log(message_style(line, { input }));
        if (!line.trim()) {
            await sleep_ms(baseDelay / 2);
            continue;
        }
        await sleep_ms(baseDelay + Math.floor(Math.random() * baseDelay));
    }
}

// ─── Table Rendering ────────────────────────────────────────────────────────

/**
 * Render a markdown table as formatted terminal output with box drawing.
 *
 * Decomposes the table into header/rows, calculates constrained column
 * widths, and applies box-drawing borders.
 */
export function table_render(tableText: string): string {
    const rows: string[][] = tableMarkdown_parse(tableText);
    if (rows.length === 0) return tableText;

    const colCount: number = rows.reduce((max: number, row: string[]): number => Math.max(max, row.length), 0);
    const contentBudget: number = tableContentBudget_calculate(colCount);
    const colWidths: number[] = tableColumnWidths_calculate(rows, colCount, contentBudget);

    const output: string[] = [tableBorder_render(colWidths, 'top')];

    rows.forEach((row: string[], rowIdx: number): void => {
        output.push(tableRow_render(row, colWidths, rowIdx === 0));
        if (rowIdx === 0) output.push(tableBorder_render(colWidths, 'mid'));
    });

    output.push(tableBorder_render(colWidths, 'bot'));
    return output.join('\n');
}

/**
 * Parse markdown table text into a 2D array of cells, stripping separators.
 */
function tableMarkdown_parse(tableText: string): string[][] {
    const lines = tableText.trim().split('\n');
    if (lines.length < 2) return [];

    const separatorRow_is = (line: string): boolean => {
        const trimmed: string = line.trim();
        if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false;
        const cells: string[] = trimmed
            .split('|')
            .slice(1, -1)
            .map((cell: string): string => cell.trim())
            .filter((cell: string): boolean => cell.length > 0);
        return cells.length > 0 && cells.every((cell: string): boolean => /^:?-{3,}:?$/.test(cell));
    };

    const rows: string[][] = [];
    for (const line of lines) {
        if (separatorRow_is(line)) continue;
        const cells = line.split('|')
            .slice(1, -1)
            .map((cell: string): string => cell.trim().replace(/\*\*/g, ''));
        if (cells.length > 0) rows.push(cells);
    }
    return rows;
}

/**
 * Calculate available width for table content based on terminal size.
 */
function tableContentBudget_calculate(colCount: number): number {
    const terminalWidth: number = Math.max(process.stdout.columns || 120, 80);
    return terminalWidth - (colCount + 1) - (colCount * 2) - 2;
}

/**
 * Calculate optimal column widths within the available budget.
 */
function tableColumnWidths_calculate(rows: string[][], colCount: number, budget: number): number[] {
    const natural: number[] = new Array(colCount).fill(0);
    rows.forEach(row => {
        row.forEach((cell, i) => {
            natural[i] = Math.max(natural[i] || 0, cell.length);
        });
    });

    const colWidths: number[] = [...natural];
    const minWidths: number[] = new Array(colCount).fill(8);

    // Specialized logic for 2-column detail tables (ID/Value pairs)
    if (colCount === 2) {
        const fixedFieldWidth: number = 40;
        const minValueWidth: number = 18;
        if (budget >= fixedFieldWidth + minValueWidth) {
            colWidths[0] = fixedFieldWidth;
            colWidths[1] = Math.max(minValueWidth, budget - fixedFieldWidth);
        } else {
            const fallbackField: number = Math.max(12, Math.min(fixedFieldWidth, budget - minValueWidth));
            colWidths[0] = fallbackField;
            colWidths[1] = Math.max(minValueWidth, budget - fallbackField);
        }
        minWidths[0] = Math.min(colWidths[0], 12);
        minWidths[1] = Math.min(colWidths[1], minValueWidth);
    }

    // Shrink columns that exceed budget
    let total: number = colWidths.reduce((sum, w) => sum + w, 0);
    while (total > budget && colWidths.some((w, i) => w > minWidths[i])) {
        let widestIdx = -1;
        let widestWidth = -1;
        for (let i = 0; i < colWidths.length; i++) {
            if (colWidths[i] > minWidths[i] && colWidths[i] > widestWidth) {
                widestIdx = i; widestWidth = colWidths[i];
            }
        }
        if (widestIdx < 0) break;
        colWidths[widestIdx] -= 1;
        total -= 1;
    }
    return colWidths;
}

/**
 * Render a table border line.
 */
function tableBorder_render(widths: number[], type: 'top' | 'mid' | 'bot'): string {
    const h = '─';
    const [left, mid, right] = type === 'top' ? ['┌', '┬', '┐'] : (type === 'mid' ? ['├', '┼', '┤'] : ['└', '┴', '┘']);
    return `${left}${widths.map(w => h.repeat(w + 2)).join(mid)}${right}`;
}

/**
 * Render a single data row, handling multi-line cell wrapping.
 */
function tableRow_render(cells: string[], widths: number[], isHeader: boolean): string {
    const wrapped: string[][] = cells.map((cell, i) => tableCell_wrap(cell, widths[i]));
    const height: number = wrapped.reduce((max, lines) => Math.max(max, lines.length), 1);
    const lines: string[] = [];

    for (let i = 0; i < height; i++) {
        const padded = wrapped.map((lines, j) => ` ${(lines[i] || '').padEnd(widths[j])} `);
        const line = `│${padded.join('│')}│`;
        lines.push(isHeader ? `${COLORS.yellow}${line}${COLORS.reset}` : line);
    }
    return lines.join('\n');
}

/**
 * Wrap cell text to a specific width.
 */
function tableCell_wrap(text: string, width: number): string[] {
    if (width <= 0) return [''];
    const raw: string = text.trim();
    if (!raw) return [''];

    const words: string[] = raw.split(/\s+/);
    const lines: string[] = [];
    let current: string = '';

    for (const word of words) {
        if (word.length > width) {
            if (current) lines.push(current);
            for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
            current = '';
            continue;
        }
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length <= width) current = candidate;
        else {
            if (current) lines.push(current);
            current = word;
        }
    }
    if (current) lines.push(current);
    return lines.length > 0 ? lines : [''];
}

// ─── Message Styling ────────────────────────────────────────────────────────

interface MessageStyleOptions {
    input?: string;
}

/**
 * Style a message for terminal output (dark background optimized).
 *
 * Applies multi-pass transformations: code blocks, cat-payloads,
 * markdown tables, HTML spans, markdown emphasis, and LCARS markers.
 */
export function message_style(message: string, options: MessageStyleOptions = {}): string {
    const { styled: codeStyled, masks } = fencedCodeBlocks_style(message);
    let styled: string = codeStyled;

    // Special handling for raw 'cat' output
    const catStyled = catPayload_style(styled, options.input, masks.size);
    if (catStyled) return catStyled;

    styled = markdownTables_style(styled);
    styled = htmlSpans_style(styled);
    styled = markdownEmphasis_style(styled);
    styled = lcarsMarkers_style(styled);

    // Restore code blocks from masks
    for (const [key, value] of masks.entries()) {
        styled = styled.replaceAll(key, value);
    }
    return styled;
}

/**
 * Replace fenced code blocks with syntax-highlighted placeholders (masks).
 */
function fencedCodeBlocks_style(message: string): { styled: string, masks: Map<string, string> } {
    const masks: Map<string, string> = new Map();
    let idx: number = 0;
    const styled = message.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g, (_full, rawLang, code) => {
        const lang = rawLang?.trim().toLowerCase() || 'text';
        const highlighted = syntaxHighlight_renderAnsi(code, lang);
        const label = `${COLORS.dim}[${lang.toUpperCase()}]${COLORS.reset}`;
        const key = `__CODE_BLOCK_${idx++}__`;
        masks.set(key, `${label}\n${highlighted}`);
        return key;
    });
    return { styled, masks };
}

/**
 * Apply full-payload syntax highlighting for 'cat' commands if not already structured.
 */
function catPayload_style(message: string, input?: string, maskCount: number = 0): string | null {
    const catLang = catLanguage_detect(input);
    if (!catLang || maskCount > 0) return null;

    const structuredPattern = /(^\s*[●○>>]|<span class=|^\s*POWER SCRIPTS AVAILABLE|^\s*CALYPSO GUIDANCE)/m;
    if (structuredPattern.test(message)) return null;

    return syntaxHighlight_renderAnsi(message, catLang);
}

/**
 * Detect and render markdown tables within the message.
 */
function markdownTables_style(message: string): string {
    const tableRegex = /(\|[^\n]+\|\n)+/g;
    return message.replace(tableRegex, (match) => match.includes('---') ? table_render(match) : match);
}

/**
 * Convert HTML-style spans used in browser-mode to ANSI terminal colors.
 */
function htmlSpans_style(message: string): string {
    return message
        .replace(/<span class="dir">(.*?)<\/span>/g, `${COLORS.cyan}$1${COLORS.reset}`)
        .replace(/<span class="file">(.*?)<\/span>/g, `${COLORS.white}$1${COLORS.reset}`)
        .replace(/<span class="exec">(.*?)<\/span>/g, `${COLORS.green}$1${COLORS.reset}`)
        .replace(/<span class="dim">(.*?)<\/span>/g, `${COLORS.dim}$1${COLORS.reset}`)
        .replace(/<span class="highlight">(.*?)<\/span>/g, `${COLORS.yellow}$1${COLORS.reset}`)
        .replace(/<span class="success">(.*?)<\/span>/g, `${COLORS.green}$1${COLORS.reset}`)
        .replace(/<span class="error">(.*?)<\/span>/g, `${COLORS.red}$1${COLORS.reset}`)
        .replace(/<[^>]+>/g, '');
}

/**
 * Apply ANSI styles for standard markdown emphasis (bold, italic, code).
 */
function markdownEmphasis_style(message: string): string {
    return message
        .replace(/\*\*([^*]+)\*\*/g, `${COLORS.bright}${COLORS.white}$1${COLORS.reset}`)
        .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, `${COLORS.italic}$1${COLORS.reset}`)
        .replace(/`([^`]+)`/g, `${COLORS.yellow}$1${COLORS.reset}`)
        .replace(/^(#{1,4})\s+(.+)$/gm, `${COLORS.bright}${COLORS.cyan}$2${COLORS.reset}`);
}

/**
 * Colorize LCARS-specific markers and entities (markers, site-ids, paths).
 */
function lcarsMarkers_style(message: string): string {
    return message
        .replace(/●/g, `${COLORS.green}●${COLORS.reset}`)
        .replace(/○/g, `${COLORS.cyan}○${COLORS.reset}`)
        .replace(/>>/g, `${COLORS.red}>>${COLORS.reset}`)
        .replace(/\[(ds-\d+)\]/g, `${COLORS.yellow}[$1]${COLORS.reset}`)
        .replace(/(~\/[^\s]+)/g, `${COLORS.magenta}$1${COLORS.reset}`)
        .replace(/(\/home\/[^\s]+)/g, `${COLORS.magenta}$1${COLORS.reset}`);
}
