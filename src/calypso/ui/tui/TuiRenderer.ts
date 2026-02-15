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
export function stripAnsi(str: string): string {
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
export function spinnerLabel_resolve(input: string, options: CommandExecuteOptions = {}): string {
    const cmd: string = input.trim().split(/\s+/)[0]?.toLowerCase() || '';
    const stepPrefix: string = options.scriptStep && options.stepIndex && options.stepTotal
        ? `STEP ${options.stepIndex}/${options.stepTotal} · `
        : '';
    switch (cmd) {
        case 'search':
            return `${stepPrefix}CALYPSO scanning catalog`;
        case 'add':
        case 'gather':
            return `${stepPrefix}CALYPSO assembling cohort`;
        case 'rename':
            return `${stepPrefix}CALYPSO updating project context`;
        case 'harmonize':
            return `${stepPrefix}CALYPSO harmonizing cohort`;
        case 'proceed':
        case 'code':
            return `${stepPrefix}CALYPSO preparing code workspace`;
        case 'python':
            return `${stepPrefix}CALYPSO executing local validation`;
        case 'federate':
            return `${stepPrefix}CALYPSO preparing federation sequence`;
        case '/run':
            return `${stepPrefix}CALYPSO running script`;
        default:
            return `${stepPrefix}CALYPSO thinking`;
    }
}

/**
 * Resolve minimum spinner duration per command to avoid instant flashes.
 */
export function spinnerMinDuration_resolve(input: string, options: CommandExecuteOptions = {}): number {
    const cmd: string = input.trim().split(/\s+/)[0]?.toLowerCase() || '';
    if (options.scriptStep) {
        switch (cmd) {
            case 'search':
                return 1800;
            case 'add':
            case 'gather':
                return 1650;
            case 'rename':
                return 1300;
            case 'harmonize':
                return 1200;
            case 'proceed':
            case 'code':
                return 1700;
            case 'python':
                return 2400;
            case 'federate':
                return 2100;
            default:
                return 1400;
        }
    }
    switch (cmd) {
        case 'search':
        case 'add':
            case 'gather':
            return 360;
        case 'proceed':
        case 'code':
            return 520;
        case 'python':
            return 700;
        case 'federate':
            return 820;
        default:
            return 280;
    }
}

// ─── Script Step Telemetry ──────────────────────────────────────────────────

export interface ScriptStepPlan {
    title: string;
    lines: string[];
}

/**
 * Human-readable step telemetry sentence for script execution.
 */
export function scriptStepTelemetry_resolve(command: string): string {
    const cmd: string = command.trim().split(/\s+/)[0]?.toLowerCase() || '';
    switch (cmd) {
        case 'search':
            return 'Scanning catalog indices and ranking candidate cohorts.';
        case 'add':
        case 'gather':
            return 'Mounting cohort assets and validating provenance metadata.';
        case 'rename':
            return 'Updating project identity and synchronizing workspace paths.';
        case 'harmonize':
            return 'Standardizing site heterogeneity for federated readiness.';
        case 'proceed':
        case 'code':
            return 'Generating scaffold source and manifest assets.';
        case 'python':
            return 'Running local execution pass and collecting validation artifacts.';
        case 'federate':
            return 'Preparing federation orchestration and execution artifacts.';
        default:
            return 'Executing scripted DAG step.';
    }
}

/**
 * Verbose foreground plan lines for a script step.
 */
export function scriptStepPlan_resolve(command: string): ScriptStepPlan {
    const cmd: string = command.trim().split(/\s+/)[0]?.toLowerCase() || '';
    switch (cmd) {
        case 'search':
            return {
                title: 'SEARCH STAGE',
                lines: [
                    'Querying ATLAS catalog shards for cohort candidates.',
                    'Scoring modality/provider relevance and confidence.',
                    'Materializing search snapshot artifact in ~/searches/.'
                ]
            };
        case 'add':
        case 'gather':
            return {
                title: 'GATHER STAGE',
                lines: [
                    'Resolving dataset identity and provenance signature.',
                    'Mounting cohort tree into project input workspace.',
                    'Writing gather receipts and .cohort completion marker.'
                ]
            };
        case 'rename':
            return {
                title: 'RENAME STAGE',
                lines: [
                    'Computing path migration plan for active project root.',
                    'Applying VFS move and shell-context synchronization.',
                    'Updating project model and shell context.'
                ]
            };
        case 'harmonize':
            return {
                title: 'HARMONIZE STAGE',
                lines: [
                    'Profiling cross-site metadata variance and label schema drift.',
                    'Applying normalization/resampling/alignment transforms.',
                    'Writing harmonization report and .harmonized marker.'
                ]
            };
        default:
            return {
                title: 'EXECUTION STAGE',
                lines: [
                    'Executing scripted DAG operation.',
                    'Validating output artifacts and stage completion markers.'
                ]
            };
    }
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
        case 'harmonize':
            return 'harmonize';
        case 'proceed':
            return 'proceed';
        case 'code':
            return 'code';
        case 'run_python':
            return `python ${String(params.script || 'train.py')}`.trim();
        case 'federate.transcompile':
        case 'federate.containerize':
        case 'federate.publish_metadata':
        case 'federate.publish':
        case 'federate.dispatch_compute':
            return 'federate';
        default:
            return action;
    }
}

// ─── Harmonization Animation ────────────────────────────────────────────────

/**
 * Runs an animated harmonization sequence in the terminal.
 * Creates a btop-style progress display with fake metrics.
 */
export async function harmonization_animate(): Promise<void> {
    const WIDTH: number = 64;
    const BAR_WIDTH: number = 24;
    const METRIC_WIDTH: number = 28;

    const boxRow_render = (content: string): string => {
        const visibleLength: number = Array.from(stripAnsi(content)).length;
        const paddingLength: number = Math.max(0, WIDTH - visibleLength);
        return `${COLORS.cyan}║${COLORS.reset}${content}${' '.repeat(paddingLength)}${COLORS.cyan}║${COLORS.reset}`;
    };

    const boxRow_print = (content: string = ''): void => {
        console.log(boxRow_render(content));
    };

    const boxRule_print = (left: '╔' | '╠' | '╚', right: '╗' | '╣' | '╝'): void => {
        console.log(`${COLORS.cyan}${left}${'═'.repeat(WIDTH)}${right}${COLORS.reset}`);
    };

    const text_fit = (text: string, width: number): string => {
        const chars: string[] = Array.from(text);
        if (chars.length <= width) return text.padEnd(width);
        if (width <= 1) return chars.slice(0, width).join('');
        return `${chars.slice(0, width - 1).join('')}…`;
    };

    const phases: Array<{ name: string; metrics: string[] }> = [
        {
            name: 'DICOM Header Analysis',
            metrics: ['Patient ID normalization', 'Study date validation', 'Modality tag verification']
        },
        {
            name: 'Image Geometry Check',
            metrics: ['Pixel spacing validation', 'Slice thickness analysis', 'Orientation matrix check']
        },
        {
            name: 'Intensity Normalization',
            metrics: ['Histogram equalization', 'Window/level standardization', 'Bit depth conversion']
        },
        {
            name: 'Metadata Reconciliation',
            metrics: ['Institution code mapping', 'Series description cleanup', 'Annotation format sync']
        },
        {
            name: 'Quality Metrics Generation',
            metrics: ['SNR calculation', 'Artifact detection', 'Coverage completeness']
        }
    ];

    process.stdout.write(COLORS.hideCursor);

    console.log();
    boxRule_print('╔', '╗');
    boxRow_print(`  ${COLORS.bright}${COLORS.yellow}CALYPSO HARMONIZATION ENGINE${COLORS.reset}`);
    boxRow_print(`  ${COLORS.dim}Standardizing cohort for federated learning${COLORS.reset}`);
    boxRule_print('╠', '╣');

    for (let phaseIdx = 0; phaseIdx < phases.length; phaseIdx++) {
        const phase = phases[phaseIdx];

        boxRow_print();
        boxRow_print(`  ${COLORS.green}▶${COLORS.reset} ${COLORS.bright}${phase.name}${COLORS.reset}`);

        for (let progress = 0; progress <= 100; progress += 5) {
            const filled: number = Math.floor((progress / 100) * BAR_WIDTH);
            const empty: number = BAR_WIDTH - filled;
            const bar: string = `${COLORS.green}${'█'.repeat(filled)}${COLORS.dim}${'░'.repeat(empty)}${COLORS.reset}`;

            const metricIdx: number = Math.min(Math.floor((progress / 100) * phase.metrics.length), phase.metrics.length - 1);
            const metric: string = phase.metrics[metricIdx];
            const metricPadded: string = text_fit(metric, METRIC_WIDTH);

            const progressLine: string = `  [${bar}] ${COLORS.yellow}${progress.toString().padStart(3)}%${COLORS.reset} ${COLORS.dim}${metricPadded}${COLORS.reset}`;
            process.stdout.write(`\r${boxRow_render(progressLine)}`);

            await sleep_ms(30 + Math.random() * 40);
        }
        console.log();
    }

    boxRow_print();
    boxRule_print('╠', '╣');
    boxRow_print(`  ${COLORS.bright}HARMONIZATION SUMMARY${COLORS.reset}`);
    boxRow_print();

    const stats: string[] = [
        `  ${COLORS.green}✓${COLORS.reset} Images processed:     ${COLORS.yellow}1,247${COLORS.reset}`,
        `  ${COLORS.green}✓${COLORS.reset} Metadata fields:      ${COLORS.yellow}18,705${COLORS.reset}`,
        `  ${COLORS.green}✓${COLORS.reset} Format conversions:   ${COLORS.yellow}312${COLORS.reset}`,
        `  ${COLORS.green}✓${COLORS.reset} Quality score:        ${COLORS.yellow}94.7%${COLORS.reset}`,
        `  ${COLORS.green}✓${COLORS.reset} Federation ready:     ${COLORS.green}YES${COLORS.reset}`
    ];

    for (const stat of stats) {
        boxRow_print(stat);
        await sleep_ms(100);
    }

    boxRow_print();
    boxRule_print('╚', '╝');
    console.log();

    process.stdout.write(COLORS.showCursor);
}

// ─── Output Mode Detection ──────────────────────────────────────────────────

/**
 * Detect whether response output should be streamed with timing.
 */
export function outputMode_detect(
    message: string,
    input: string,
    options: CommandExecuteOptions = {}
): 'plain' | 'training' | 'federation' | 'script' {
    const lowerInput: string = input.toLowerCase();
    if (message.includes('--- TRAINING LOG ---') || (lowerInput.startsWith('python ') && message.includes('LOCAL TRAINING COMPLETE'))) {
        return 'training';
    }
    if (options.scriptStep) {
        return 'script';
    }
    if (message.includes('RUNNING SCRIPT:') && /\[(OK|ERR)\]\s+\[\d+\/\d+\]/.test(message)) {
        return 'script';
    }
    if (
        /STEP\s+[1-5]\/5/.test(message) ||
        message.includes('PHASE 1/3 COMPLETE: BUILD ARTIFACTS') ||
        message.includes('PHASE 2/3: MARKETPLACE PUBLISH PREPARATION') ||
        message.includes('PHASE 2/3 COMPLETE: MARKETPLACE PUBLISHING') ||
        message.includes('PHASE 3/3: FEDERATION DISPATCH & COMPUTE') ||
        message.includes('DISTRIBUTING CONTAINER TO TRUSTED DOMAINS') ||
        message.includes('FEDERATED COMPUTE ROUNDS') ||
        message.includes('[1/5] SOURCE CODE TRANSCOMPILE') ||
        message.includes('[2/5] CONTAINER COMPILATION') ||
        message.includes('[3/5] MARKETPLACE PUBLISHING COMPLETE')
    ) {
        return 'federation';
    }
    return 'plain';
}

// ─── Animated Response Rendering ────────────────────────────────────────────

/**
 * Stream response output line-by-line for realistic execution feel.
 */
export async function response_renderAnimated(
    message: string,
    input: string,
    options: CommandExecuteOptions = {}
): Promise<void> {
    const mode = outputMode_detect(message, input, options);
    if (mode === 'plain') {
        console.log(message_style(message, { input }));
        return;
    }

    const hasMarkdownTable: boolean = /\|(?:\s*:?-{3,}:?\s*\|)+/.test(message);
    if (hasMarkdownTable) {
        console.log(message_style(message, { input }));
        await sleep_ms(180 + Math.floor(Math.random() * 140));
        return;
    }

    const lines: string[] = message.split('\n');
    for (const line of lines) {
        console.log(message_style(line, { input }));

        if (!line.trim()) {
            await sleep_ms(70 + Math.floor(Math.random() * 70));
            continue;
        }

        if (mode === 'training') {
            if (/^Epoch \d+\/\d+/i.test(line)) {
                await sleep_ms(320 + Math.floor(Math.random() * 340));
            } else if (line.includes('LOCAL TRAINING COMPLETE')) {
                await sleep_ms(180 + Math.floor(Math.random() * 140));
            } else {
                await sleep_ms(130 + Math.floor(Math.random() * 170));
            }
            continue;
        }

        if (mode === 'script') {
            if (/\[(OK|ERR)\]\s+\[\d+\/\d+\]/.test(line)) {
                await sleep_ms(650 + Math.floor(Math.random() * 520));
            } else if (/^\s*->/.test(line)) {
                await sleep_ms(260 + Math.floor(Math.random() * 220));
            } else {
                await sleep_ms(180 + Math.floor(Math.random() * 180));
            }
            continue;
        }

        // federation mode
        if (/ROUND\s+\d+\/\d+/i.test(line)) {
            await sleep_ms(700 + Math.floor(Math.random() * 700));
        } else if (line.includes('DISPATCHED')) {
            await sleep_ms(520 + Math.floor(Math.random() * 520));
        } else if (/^\s*○\s+\[\d\/5\]/.test(line)) {
            await sleep_ms(620 + Math.floor(Math.random() * 520));
        } else if (line.includes('PHASE 3/3') || line.includes('PHASE 2/3') || line.includes('PHASE 1/3') || /STEP\s+[1-5]\/5/.test(line)) {
            await sleep_ms(540 + Math.floor(Math.random() * 420));
        } else {
            await sleep_ms(260 + Math.floor(Math.random() * 340));
        }
    }
}

// ─── Table Rendering ────────────────────────────────────────────────────────

/**
 * Render a markdown table as formatted terminal output with box drawing.
 */
export function table_render(tableText: string): string {
    const lines = tableText.trim().split('\n');
    if (lines.length < 2) return tableText;

    const separatorRow_is = (line: string): boolean => {
        const trimmed: string = line.trim();
        if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false;
        const cells: string[] = trimmed
            .split('|')
            .slice(1, -1)
            .map((cell: string): string => cell.trim())
            .filter((cell: string): boolean => cell.length > 0);
        if (cells.length === 0) return false;
        return cells.every((cell: string): boolean => /^:?-{3,}:?$/.test(cell));
    };

    const cell_wrap = (text: string, width: number): string[] => {
        if (width <= 0) return [''];
        const raw: string = text.trim();
        if (!raw) return [''];

        const words: string[] = raw.split(/\s+/);
        const wrapped: string[] = [];
        let current: string = '';

        for (const word of words) {
            if (word.length > width) {
                if (current) {
                    wrapped.push(current);
                    current = '';
                }
                for (let i = 0; i < word.length; i += width) {
                    wrapped.push(word.slice(i, i + width));
                }
                continue;
            }

            const candidate: string = current ? `${current} ${word}` : word;
            if (candidate.length <= width) {
                current = candidate;
            } else {
                if (current) wrapped.push(current);
                current = word;
            }
        }

        if (current) wrapped.push(current);
        return wrapped.length > 0 ? wrapped : [''];
    };

    const rows: string[][] = [];
    for (const line of lines) {
        if (separatorRow_is(line)) continue;
        const cells = line.split('|')
            .slice(1, -1)
            .map((cell: string): string => cell.trim().replace(/\*\*/g, ''));
        if (cells.length > 0) {
            rows.push(cells);
        }
    }

    if (rows.length === 0) return tableText;

    const colCount: number = rows.reduce((max: number, row: string[]): number => Math.max(max, row.length), 0);
    rows.forEach((row: string[]): void => {
        while (row.length < colCount) row.push('');
    });

    const colWidthsNatural: number[] = new Array(colCount).fill(0);
    for (const row of rows) {
        row.forEach((cell: string, i: number): void => {
            colWidthsNatural[i] = Math.max(colWidthsNatural[i] || 0, cell.length);
        });
    }

    const terminalWidth: number = Math.max(process.stdout.columns || 120, 80);
    const contentBudget: number = terminalWidth - (colCount + 1) - (colCount * 2) - 2;
    const colWidths: number[] = [...colWidthsNatural];
    const minWidths: number[] = new Array(colCount).fill(8);
    if (colCount === 2) {
        const fixedFieldWidth: number = 40;
        const minValueWidth: number = 18;

        if (contentBudget >= fixedFieldWidth + minValueWidth) {
            colWidths[0] = fixedFieldWidth;
            colWidths[1] = Math.max(minValueWidth, contentBudget - fixedFieldWidth);
        } else {
            const fallbackField: number = Math.max(12, Math.min(fixedFieldWidth, contentBudget - minValueWidth));
            colWidths[0] = fallbackField;
            colWidths[1] = Math.max(minValueWidth, contentBudget - fallbackField);
        }

        minWidths[0] = Math.min(colWidths[0], 12);
        minWidths[1] = Math.min(colWidths[1], minValueWidth);
    }

    let totalWidth: number = colWidths.reduce((sum: number, w: number): number => sum + w, 0);
    while (totalWidth > contentBudget && colWidths.some((w: number, i: number): boolean => w > minWidths[i])) {
        let widestIdx: number = -1;
        let widestWidth: number = -1;
        for (let i = 0; i < colWidths.length; i++) {
            if (colWidths[i] > minWidths[i] && colWidths[i] > widestWidth) {
                widestIdx = i;
                widestWidth = colWidths[i];
            }
        }
        if (widestIdx < 0) break;
        colWidths[widestIdx] -= 1;
        totalWidth -= 1;
    }

    const hLine = '─';
    const topBorder: string = `┌${colWidths.map((w: number): string => hLine.repeat(w + 2)).join('┬')}┐`;
    const midBorder: string = `├${colWidths.map((w: number): string => hLine.repeat(w + 2)).join('┼')}┤`;
    const botBorder: string = `└${colWidths.map((w: number): string => hLine.repeat(w + 2)).join('┴')}┘`;

    const output: string[] = [topBorder];

    rows.forEach((row: string[], rowIdx: number): void => {
        const wrappedCells: string[][] = row.map((cell: string, i: number): string[] => cell_wrap(cell, colWidths[i]));
        const rowHeight: number = wrappedCells.reduce(
            (max: number, linesPerCell: string[]): number => Math.max(max, linesPerCell.length),
            1
        );

        for (let lineIdx = 0; lineIdx < rowHeight; lineIdx++) {
            const paddedCells: string[] = wrappedCells.map(
                (cellLines: string[], i: number): string => ` ${(cellLines[lineIdx] || '').padEnd(colWidths[i])} `
            );
            const rowLine: string = `│${paddedCells.join('│')}│`;
            if (rowIdx === 0) {
                output.push(`${COLORS.yellow}${rowLine}${COLORS.reset}`);
            } else {
                output.push(rowLine);
            }
        }

        if (rowIdx === 0) output.push(midBorder);
    });

    output.push(botBorder);
    return output.join('\n');
}

// ─── Message Styling ────────────────────────────────────────────────────────

interface MessageStyleOptions {
    input?: string;
}

/**
 * Style a message for terminal output (dark background optimized).
 */
export function message_style(message: string, options: MessageStyleOptions = {}): string {
    const codeMasks: Map<string, string> = new Map();
    let codeMaskIdx: number = 0;
    const codeMask_stash = (renderedBlock: string): string => {
        const key: string = `__CODE_BLOCK_${codeMaskIdx++}__`;
        codeMasks.set(key, renderedBlock);
        return key;
    };

    // Render fenced code blocks with syntax highlighting
    message = message.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g, (_full: string, rawLang: string, code: string): string => {
        const language: string = rawLang?.trim().toLowerCase() || 'text';
        const highlighted: string = syntaxHighlight_renderAnsi(code, language);
        const label: string = `${COLORS.dim}[${language.toUpperCase()}]${COLORS.reset}`;
        return codeMask_stash(`${label}\n${highlighted}`);
    });

    // If this is direct `cat` output, highlight the whole payload
    const catLang: string | null = catLanguage_detect(options.input);
    if (catLang && codeMasks.size === 0) {
        const looksStructuredResponse: boolean = /(^\s*[●○>>]|<span class=|^\s*POWER SCRIPTS AVAILABLE|^\s*CALYPSO GUIDANCE)/m.test(message);
        if (!looksStructuredResponse) {
            return syntaxHighlight_renderAnsi(message, catLang);
        }
    }

    // Markdown tables
    const tableRegex = /(\|[^\n]+\|\n)+/g;
    message = message.replace(tableRegex, (match) => {
        if (match.includes('---')) {
            return table_render(match);
        }
        return match;
    });

    let styled: string = message
        .replace(/<span class="dir">(.*?)<\/span>/g, `${COLORS.cyan}$1${COLORS.reset}`)
        .replace(/<span class="file">(.*?)<\/span>/g, `${COLORS.white}$1${COLORS.reset}`)
        .replace(/<span class="exec">(.*?)<\/span>/g, `${COLORS.green}$1${COLORS.reset}`)
        .replace(/<span class="dim">(.*?)<\/span>/g, `${COLORS.dim}$1${COLORS.reset}`)
        .replace(/<span class="highlight">(.*?)<\/span>/g, `${COLORS.yellow}$1${COLORS.reset}`)
        .replace(/<span class="success">(.*?)<\/span>/g, `${COLORS.green}$1${COLORS.reset}`)
        .replace(/<span class="error">(.*?)<\/span>/g, `${COLORS.red}$1${COLORS.reset}`)
        .replace(/<[^>]+>/g, '')
        .replace(/\*\*([^*]+)\*\*/g, `${COLORS.bright}${COLORS.white}$1${COLORS.reset}`)
        .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, `${COLORS.italic}$1${COLORS.reset}`)
        .replace(/`([^`]+)`/g, `${COLORS.yellow}$1${COLORS.reset}`)
        .replace(/^(#{1,4})\s+(.+)$/gm, `${COLORS.bright}${COLORS.cyan}$2${COLORS.reset}`)
        .replace(/●/g, `${COLORS.green}●${COLORS.reset}`)
        .replace(/○/g, `${COLORS.cyan}○${COLORS.reset}`)
        .replace(/>>/g, `${COLORS.red}>>${COLORS.reset}`)
        .replace(/\[(ds-\d+)\]/g, `${COLORS.yellow}[$1]${COLORS.reset}`)
        .replace(/(~\/[^\s]+)/g, `${COLORS.magenta}$1${COLORS.reset}`)
        .replace(/(\/home\/[^\s]+)/g, `${COLORS.magenta}$1${COLORS.reset}`);

    for (const [key, value] of codeMasks.entries()) {
        styled = styled.replaceAll(key, value);
    }
    return styled;
}
