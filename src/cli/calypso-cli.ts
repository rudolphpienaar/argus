#!/usr/bin/env npx tsx
/**
 * @file Calypso CLI Client
 *
 * Interactive REPL for communicating with a Calypso server.
 * Can connect to either the headless server (make calypso) or
 * a running web app's WebSocket bridge.
 *
 * Usage:
 *   npx ts-node src/cli/calypso-cli.ts
 *   # or
 *   make calypso-cli
 *
 * @module
 * @see docs/calypso.adoc
 */

import * as readline from 'readline';
import http from 'http';
import fs from 'fs';
import path from 'path';
import type { CalypsoResponse, CalypsoAction } from '../lcarslm/types.js';
import { cliAdapter } from '../lcarslm/adapters/CLIAdapter.js';
import { DATASETS } from '../core/data/datasets.js';
import type { Dataset } from '../core/models/types.js';
import type { WorkflowSummary } from '../core/workflows/types.js';

// ─── Configuration ─────────────────────────────────────────────────────────

const HOST: string = process.env.CALYPSO_HOST || 'localhost';
const PORT: number = parseInt(process.env.CALYPSO_PORT || '8081', 10);
const BASE_URL: string = `http://${HOST}:${PORT}`;

// ─── ANSI Colors ───────────────────────────────────────────────────────────

// Dark background optimized colors (bright variants)
const COLORS = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',         // Bold
    italic: '\x1b[3m',         // Italic
    underline: '\x1b[4m',      // Underline
    dim: '\x1b[90m',           // Bright black (gray)
    cyan: '\x1b[96m',          // Bright cyan
    yellow: '\x1b[93m',        // Bright yellow
    red: '\x1b[91m',           // Bright red
    green: '\x1b[92m',         // Bright green
    blue: '\x1b[94m',          // Bright blue
    magenta: '\x1b[95m',       // Bright magenta
    white: '\x1b[97m',         // Bright white
    hideCursor: '\x1b[?25l',
    showCursor: '\x1b[?25h'
};

// ─── Spinner ────────────────────────────────────────────────────────────────

const SPINNER_FRAMES: readonly string[] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface CommandExecuteOptions {
    scriptStep?: boolean;
    stepIndex?: number;
    stepTotal?: number;
}

interface ScriptStepPlan {
    title: string;
    lines: string[];
}

/**
 * Starts a thinking spinner on the current line.
 * Returns a stop function that clears the spinner.
 */
function spinner_start(label: string = 'CALYPSO thinking'): () => void {
    let frameIdx: number = 0;
    process.stdout.write(COLORS.hideCursor);

    const timer: NodeJS.Timeout = setInterval((): void => {
        const frame: string = SPINNER_FRAMES[frameIdx % SPINNER_FRAMES.length];
        process.stdout.write(`\r${COLORS.cyan}${frame}${COLORS.reset} ${COLORS.dim}${label}...${COLORS.reset}  `);
        frameIdx++;
    }, 80);

    return (): void => {
        clearInterval(timer);
        // Clear the spinner line and reset cursor
        process.stdout.write(`\r${' '.repeat(label.length + 10)}\r`);
        process.stdout.write(COLORS.showCursor);
    };
}

/**
 * Resolve spinner label by command intent.
 */
function spinnerLabel_resolve(input: string, options: CommandExecuteOptions = {}): string {
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
function spinnerMinDuration_resolve(input: string, options: CommandExecuteOptions = {}): number {
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

/**
 * Human-readable step telemetry sentence for script execution.
 */
function scriptStepTelemetry_resolve(command: string): string {
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
function scriptStepPlan_resolve(command: string): ScriptStepPlan {
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
                    'Writing rename receipt into ops/rename/data/.'
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

// ─── Harmonization Animation ───────────────────────────────────────────────

/**
 * Runs an animated harmonization sequence in the terminal.
 * Creates a btop-style progress display with fake metrics.
 */
async function harmonization_animate(): Promise<void> {
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

    // Analysis phases with fake metrics
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

    // Draw header box
    console.log();
    boxRule_print('╔', '╗');
    boxRow_print(`  ${COLORS.bright}${COLORS.yellow}CALYPSO HARMONIZATION ENGINE${COLORS.reset}`);
    boxRow_print(`  ${COLORS.dim}Standardizing cohort for federated learning${COLORS.reset}`);
    boxRule_print('╠', '╣');

    // Process each phase
    for (let phaseIdx = 0; phaseIdx < phases.length; phaseIdx++) {
        const phase = phases[phaseIdx];

        // Phase header
        boxRow_print();
        boxRow_print(`  ${COLORS.green}▶${COLORS.reset} ${COLORS.bright}${phase.name}${COLORS.reset}`);

        // Animate progress bar
        for (let progress = 0; progress <= 100; progress += 5) {
            const filled: number = Math.floor((progress / 100) * BAR_WIDTH);
            const empty: number = BAR_WIDTH - filled;
            const bar: string = `${COLORS.green}${'█'.repeat(filled)}${COLORS.dim}${'░'.repeat(empty)}${COLORS.reset}`;

            // Pick a metric to display based on progress
            const metricIdx: number = Math.min(Math.floor((progress / 100) * phase.metrics.length), phase.metrics.length - 1);
            const metric: string = phase.metrics[metricIdx];
            const metricPadded: string = text_fit(metric, METRIC_WIDTH);

            const progressLine: string = `  [${bar}] ${COLORS.yellow}${progress.toString().padStart(3)}%${COLORS.reset} ${COLORS.dim}${metricPadded}${COLORS.reset}`;
            process.stdout.write(`\r${boxRow_render(progressLine)}`);

            await sleep_ms(30 + Math.random() * 40);
        }
        console.log(); // Move to next line after progress complete
    }

    // Summary stats
    boxRow_print();
    boxRule_print('╠', '╣');
    boxRow_print(`  ${COLORS.bright}HARMONIZATION SUMMARY${COLORS.reset}`);
    boxRow_print();

    // Fake stats with typewriter effect
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

/**
 * Sleep for specified milliseconds.
 */
function sleep_ms(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Strip ANSI codes from string for length calculation.
 */
function stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Detect whether response output should be streamed with timing.
 */
function outputMode_detect(
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

/**
 * Stream response output line-by-line for realistic execution feel.
 */
async function response_renderAnimated(
    message: string,
    input: string,
    options: CommandExecuteOptions = {}
): Promise<void> {
    const mode: 'plain' | 'training' | 'federation' | 'script' = outputMode_detect(message, input, options);
    if (mode === 'plain') {
        console.log(message_style(message, { input }));
        return;
    }

    const hasMarkdownTable: boolean = /\|(?:\s*:?-{3,}:?\s*\|)+/.test(message);
    if (hasMarkdownTable) {
        // Table rendering requires full multi-line context; line-by-line streaming
        // breaks markdown table detection and produces raw pipe output.
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

/**
 * Extract an executable command from a possibly pasted transcript line.
 *
 * Supported:
 * - Raw commands: `search histology`
 * - Prompt-prefixed commands: `user@CALYPSO:[~/x]> search histology`
 *
 * Returns `null` for known non-command transcript output lines so users can
 * paste whole conversations without replaying response text as commands.
 */
function transcriptCommand_extract(line: string): string | null {
    const trimmed: string = line.trim();
    if (!trimmed) return '';

    const promptMatch: RegExpMatchArray | null =
        trimmed.match(/^[^@\n]+@CALYPSO:\[[^\]]*\]>\s*(.+)$/i) ||
        trimmed.match(/^CALYPSO>\s*(.+)$/i);

    if (promptMatch) {
        return promptMatch[1].trim();
    }

    const isTranscriptOutput: boolean = /^(●|○|>>|╔|╠|╚|║|├|└|═|─|\[LOCAL EXECUTION:|--- TRAINING LOG ---|Epoch \d+\/\d+|Model weights saved to:|Validation metrics saved to:)/.test(trimmed);
    if (isTranscriptOutput) {
        return null;
    }

    return trimmed;
}

/**
 * Resolve a .clpso script path from user input.
 *
 * Lookup order:
 * 1) Direct path as provided (relative to cwd or absolute)
 * 2) Same with `.clpso` extension appended
 * 3) `scripts/calypso/<name>` in repo cwd
 * 4) `scripts/calypso/<name>.clpso` in repo cwd
 *
 * @param scriptRef - User-provided script reference.
 * @returns Absolute file path if found, else null.
 */
function scriptPath_resolve(scriptRef: string): string | null {
    const trimmedRef: string = scriptRef.trim();
    if (!trimmedRef) return null;

    const withExtension: string = trimmedRef.endsWith('.clpso') ? trimmedRef : `${trimmedRef}.clpso`;
    const candidates: string[] = [
        path.resolve(process.cwd(), trimmedRef),
        path.resolve(process.cwd(), withExtension),
        path.resolve(process.cwd(), 'scripts', 'calypso', trimmedRef),
        path.resolve(process.cwd(), 'scripts', 'calypso', withExtension)
    ];

    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue;
        const stat: fs.Stats = fs.statSync(candidate);
        if (stat.isFile()) {
            return candidate;
        }
    }

    return null;
}

/**
 * Structured `.clpso` script model.
 */
interface StructuredScriptStep {
    id: string;
    action: string;
    params: Record<string, unknown>;
    outputs?: { alias?: string };
}

interface StructuredScriptSpec {
    script: string;
    version: number;
    description?: string;
    defaults: Record<string, unknown>;
    steps: StructuredScriptStep[];
}

type ScriptPlan =
    | { mode: 'legacy'; commands: string[] }
    | { mode: 'structured'; spec: StructuredScriptSpec };

interface ScriptRuntimeContext {
    defaults: Record<string, unknown>;
    answers: Record<string, unknown>;
    outputs: Record<string, unknown>;
}

interface StructuredStepExecutionResult {
    success: boolean;
    output?: unknown;
}

/**
 * Parse script file content into either legacy command lines or structured spec.
 */
function scriptPlan_parse(content: string): ScriptPlan {
    const spec: StructuredScriptSpec | null = scriptStructured_parse(content);
    if (spec && spec.steps.length > 0) {
        return { mode: 'structured', spec };
    }

    const commands: string[] = content
        .split(/\r?\n/)
        .map((line: string): string => line.trim())
        .filter((line: string): boolean => line.length > 0 && !line.startsWith('#'));
    return { mode: 'legacy', commands };
}

/**
 * Parse minimal YAML-like structured script format.
 */
function scriptStructured_parse(content: string): StructuredScriptSpec | null {
    const linesRaw: string[] = content.split(/\r?\n/);
    const lines: Array<{ indent: number; text: string }> = [];

    for (const rawLine of linesRaw) {
        const trimmedLeft: string = rawLine.trimStart();
        if (!trimmedLeft || trimmedLeft.startsWith('#')) continue;
        const indent: number = rawLine.length - trimmedLeft.length;
        lines.push({ indent, text: trimmedLeft });
    }

    if (!lines.some((line) => line.text === 'steps:' || line.text.startsWith('steps:'))) {
        return null;
    }

    const spec: StructuredScriptSpec = {
        script: 'unnamed',
        version: 1,
        defaults: {},
        steps: []
    };

    const parseScalar = (raw: string): unknown => {
        const v: string = raw.trim();
        if (v === '{}') return {};
        if (v === '[]') return [];
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            return v.slice(1, -1);
        }
        if (v === 'true') return true;
        if (v === 'false') return false;
        if (/^-?\d+$/.test(v)) return parseInt(v, 10);
        if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
        return v;
    };

    const kv_parse = (text: string): { key: string; value: string } | null => {
        const idx: number = text.indexOf(':');
        if (idx < 0) return null;
        return {
            key: text.slice(0, idx).trim(),
            value: text.slice(idx + 1).trim()
        };
    };

    const map_parse = (
        startIdx: number,
        parentIndent: number
    ): { map: Record<string, unknown>; nextIdx: number } => {
        const out: Record<string, unknown> = {};
        let i: number = startIdx;
        while (i < lines.length) {
            const line = lines[i];
            if (line.indent <= parentIndent) break;
            const kv = kv_parse(line.text);
            if (!kv) {
                i++;
                continue;
            }
            if (kv.value === '') {
                const nested = map_parse(i + 1, line.indent);
                out[kv.key] = nested.map;
                i = nested.nextIdx;
                continue;
            }
            out[kv.key] = parseScalar(kv.value);
            i++;
        }
        return { map: out, nextIdx: i };
    };

    const steps_parse = (startIdx: number, parentIndent: number): { steps: StructuredScriptStep[]; nextIdx: number } => {
        const steps: StructuredScriptStep[] = [];
        let i: number = startIdx;
        while (i < lines.length) {
            const line = lines[i];
            if (line.indent <= parentIndent) break;
            if (!line.text.startsWith('- ')) {
                i++;
                continue;
            }

            const stepIndent: number = line.indent;
            const step: StructuredScriptStep = { id: '', action: '', params: {} };
            const firstPayload: string = line.text.slice(2).trim();
            if (firstPayload) {
                const firstKv = kv_parse(firstPayload);
                if (firstKv) {
                    if (firstKv.key === 'id') step.id = String(parseScalar(firstKv.value));
                    else if (firstKv.key === 'action') step.action = String(parseScalar(firstKv.value));
                }
            }

            i++;
            while (i < lines.length && lines[i].indent > stepIndent) {
                const child = lines[i];
                const childKv = kv_parse(child.text);
                if (!childKv) {
                    i++;
                    continue;
                }
                if (childKv.value === '') {
                    const nested = map_parse(i + 1, child.indent);
                    if (childKv.key === 'params') {
                        step.params = nested.map;
                    } else if (childKv.key === 'outputs') {
                        step.outputs = nested.map as { alias?: string };
                    }
                    i = nested.nextIdx;
                    continue;
                }

                const parsedValue: unknown = parseScalar(childKv.value);
                if (childKv.key === 'id') step.id = String(parsedValue);
                else if (childKv.key === 'action') step.action = String(parsedValue);
                else if (childKv.key === 'params' && typeof parsedValue === 'object' && parsedValue !== null) {
                    step.params = parsedValue as Record<string, unknown>;
                } else if (childKv.key === 'outputs' && typeof parsedValue === 'object' && parsedValue !== null) {
                    step.outputs = parsedValue as { alias?: string };
                }
                i++;
            }

            if (!step.id) step.id = `step-${steps.length + 1}`;
            if (!step.action) step.action = 'noop';
            steps.push(step);
        }
        return { steps, nextIdx: i };
    };

    let i: number = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (line.indent !== 0) {
            i++;
            continue;
        }

        const kv = kv_parse(line.text);
        if (!kv) {
            i++;
            continue;
        }

        if (kv.key === 'steps') {
            const parsed = steps_parse(i + 1, line.indent);
            spec.steps = parsed.steps;
            i = parsed.nextIdx;
            continue;
        }

        if (kv.key === 'defaults') {
            const parsed = map_parse(i + 1, line.indent);
            spec.defaults = parsed.map;
            i = parsed.nextIdx;
            continue;
        }

        if (kv.key === 'script') spec.script = String(parseScalar(kv.value));
        else if (kv.key === 'version') spec.version = Number(parseScalar(kv.value));
        else if (kv.key === 'description') spec.description = String(parseScalar(kv.value));
        i++;
    }

    if (!spec.steps || spec.steps.length === 0) return null;
    return spec;
}

/**
 * Dataset search helper for structured script output references.
 */
function datasets_search(query: string): Dataset[] {
    const q: string = query.trim().toLowerCase();
    if (!q) return [];
    const score = (ds: Dataset): number => {
        let s: number = 0;
        const fields: string[] = [
            ds.id,
            ds.name,
            ds.modality,
            ds.annotationType,
            ds.provider,
            ds.description
        ].map((v: string): string => v.toLowerCase());

        for (const f of fields) {
            if (f === q) s += 8;
            else if (f.includes(q)) s += 3;
        }
        return s;
    };

    return [...DATASETS]
        .map((ds: Dataset) => ({ ds, score: score(ds) }))
        .filter((entry: { ds: Dataset; score: number }): boolean => entry.score > 0)
        .sort((a: { ds: Dataset; score: number }, b: { ds: Dataset; score: number }): number => b.score - a.score)
        .map((entry: { ds: Dataset; score: number }): Dataset => entry.ds);
}

/**
 * Prompt helper for runtime values.
 */
async function prompt_value(rl: readline.Interface, question: string, fallback: string = ''): Promise<string> {
    return new Promise((resolve) => {
        rl.pause();
        rl.question(`${COLORS.yellow}${question}${COLORS.reset} `, (answer: string): void => {
            rl.resume();
            const trimmed: string = answer.trim();
            resolve(trimmed || fallback);
        });
    });
}

/**
 * Resolve dotted/indexed reference path.
 */
function reference_resolve(pathExpr: string, scope: Record<string, unknown>): unknown {
    const tokens: Array<string | number> = [];
    const tokenRe: RegExp = /([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = tokenRe.exec(pathExpr)) !== null) {
        if (match[1]) tokens.push(match[1]);
        else if (match[2]) tokens.push(parseInt(match[2], 10));
    }
    if (tokens.length === 0) return undefined;

    let current: unknown = scope;
    for (const token of tokens) {
        if (typeof token === 'number') {
            if (!Array.isArray(current) || token >= current.length) return undefined;
            current = current[token];
            continue;
        }
        if (typeof current !== 'object' || current === null || !(token in (current as Record<string, unknown>))) {
            return undefined;
        }
        current = (current as Record<string, unknown>)[token];
    }
    return current;
}

/**
 * Evaluate simple expression for `${...}` references with `??` fallback.
 */
function expression_evaluate(expr: string, runtime: ScriptRuntimeContext): unknown {
    const scope: Record<string, unknown> = {
        answers: runtime.answers,
        defaults: runtime.defaults,
        ...runtime.outputs
    };

    const parts: string[] = expr.split('??').map((part: string): string => part.trim());
    for (const part of parts) {
        if (!part) continue;
        const resolved: unknown = reference_resolve(part, scope);
        if (resolved !== null && resolved !== undefined && resolved !== '') {
            return resolved;
        }
    }
    return undefined;
}

/**
 * Resolve step value recursively with references and runtime prompts.
 */
async function stepValue_resolve(
    value: unknown,
    runtime: ScriptRuntimeContext,
    rl: readline.Interface,
    stepId: string,
    paramKey: string
): Promise<unknown> {
    if (Array.isArray(value)) {
        const resolved: unknown[] = [];
        for (const item of value) {
            resolved.push(await stepValue_resolve(item, runtime, rl, stepId, paramKey));
        }
        return resolved;
    }

    if (typeof value === 'object' && value !== null) {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = await stepValue_resolve(v, runtime, rl, stepId, k);
        }
        return out;
    }

    if (typeof value !== 'string') return value;

    if (value.trim() === '?') {
        const promptMap: Record<string, string> = {
            query: 'Search term?',
            project: 'Project name?',
            app_name: 'Application name?',
            org: 'Organization/namespace?'
        };
        const question: string = promptMap[paramKey] || `Value for ${stepId}.${paramKey}?`;
        const answer: string = await prompt_value(rl, question);
        runtime.answers[paramKey] = answer;
        return answer;
    }

    const fullRefMatch: RegExpMatchArray | null = value.match(/^\$\{([^}]+)\}$/);
    if (fullRefMatch) {
        return expression_evaluate(fullRefMatch[1], runtime);
    }

    return value.replace(/\$\{([^}]+)\}/g, (_m: string, expr: string): string => {
        const resolved: unknown = expression_evaluate(expr, runtime);
        return resolved === null || resolved === undefined ? '' : String(resolved);
    });
}

/**
 * Resolve all step params.
 */
async function stepParams_resolve(
    step: StructuredScriptStep,
    runtime: ScriptRuntimeContext,
    rl: readline.Interface
): Promise<Record<string, unknown>> {
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(step.params || {})) {
        resolved[k] = await stepValue_resolve(v, runtime, rl, step.id, k);
    }
    return resolved;
}

/**
 * Build command-like hint for spinner/telemetry based on structured action.
 */
function stepCommandHint_build(action: string, params: Record<string, unknown>): string {
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

/**
 * Execute a structured step action.
 */
async function structuredStep_execute(
    step: StructuredScriptStep,
    params: Record<string, unknown>,
    runtime: ScriptRuntimeContext,
    commandExecute: (command: string, options?: CommandExecuteOptions) => Promise<boolean>,
    rl: readline.Interface,
    stepIndex: number,
    stepTotal: number
): Promise<StructuredStepExecutionResult> {
    const runCommand = async (command: string): Promise<boolean> =>
        commandExecute(command, { scriptStep: true, stepIndex, stepTotal });

    switch (step.action) {
        case 'search': {
            const query: string = String(params.query || '').trim();
            if (!query) return { success: false };
            const success: boolean = await runCommand(`search ${query}`);
            if (!success) return { success: false };
            const results: Dataset[] = datasets_search(query);
            return { success: true, output: results };
        }

        case 'select_dataset': {
            const from: unknown = params.from;
            const candidates: Dataset[] = Array.isArray(from) ? from as Dataset[] : [];
            if (candidates.length === 0) {
                console.log(`${COLORS.red}>> No dataset candidates available for selection.${COLORS.reset}`);
                return { success: false };
            }
            const strategy: string = String(params.strategy || 'ask').toLowerCase();
            let selected: Dataset | null = null;

            if (strategy === 'first' || strategy === 'best_match') {
                selected = candidates[0];
            } else if (strategy === 'by_id') {
                const desired: string = String(params.id || params.dataset || '').trim().toLowerCase();
                selected = candidates.find((ds: Dataset): boolean => ds.id.toLowerCase() === desired) || null;
            } else {
                console.log(`${COLORS.cyan}○ Dataset candidates:${COLORS.reset}`);
                candidates.forEach((ds: Dataset, idx: number): void => {
                    console.log(`  ${idx + 1}. [${ds.id}] ${ds.name} (${ds.modality}/${ds.annotationType})`);
                });
                const answer: string = await prompt_value(rl, 'Select dataset by number or id:');
                const idx: number = parseInt(answer, 10);
                if (!isNaN(idx) && idx >= 1 && idx <= candidates.length) {
                    selected = candidates[idx - 1];
                } else {
                    selected = candidates.find((ds: Dataset): boolean => ds.id.toLowerCase() === answer.toLowerCase()) || null;
                }
            }

            if (!selected) {
                console.log(`${COLORS.red}>> Dataset selection failed.${COLORS.reset}`);
                return { success: false };
            }
            runtime.answers.selected_dataset_id = selected.id;
            return { success: true, output: selected };
        }

        case 'add': {
            const datasetId: string = String(params.dataset || '').trim();
            if (!datasetId) return { success: false };
            return { success: await runCommand(`add ${datasetId}`) };
        }

        case 'rename': {
            const projectName: string = String(params.project || '').trim();
            if (!projectName) return { success: false };
            return { success: await runCommand(`rename ${projectName}`) };
        }

        case 'harmonize':
            return { success: await runCommand('harmonize') };
        case 'proceed':
        case 'code':
            return { success: await runCommand(step.action) };

        case 'run_python': {
            const scriptName: string = String(params.script || 'train.py').trim() || 'train.py';
            const args: string[] = Array.isArray(params.args) ? (params.args as unknown[]).map((v: unknown): string => String(v)) : [];
            const cmd: string = ['python', scriptName, ...args].join(' ').trim();
            return { success: await runCommand(cmd) };
        }

        case 'federate.transcompile':
            return { success: (await runCommand('federate')) && (await runCommand('federate --yes')) };
        case 'federate.containerize':
            return { success: await runCommand('federate --yes') };
        case 'federate.publish_metadata': {
            // Enter metadata stage then apply provided values.
            if (!(await runCommand('federate --yes'))) return { success: false };
            if (params.app_name && !(await runCommand(`federate --name ${String(params.app_name)}`))) return { success: false };
            if (params.org && String(params.org).trim() && !(await runCommand(`federate --org ${String(params.org)}`))) return { success: false };
            if (params.visibility) {
                const vis: string = String(params.visibility).toLowerCase();
                if (vis === 'private' && !(await runCommand('federate --private'))) return { success: false };
                if (vis === 'public' && !(await runCommand('federate --public'))) return { success: false };
            }
            return { success: true, output: params };
        }
        case 'federate.publish':
            return { success: await runCommand('federate --yes') };
        case 'federate.dispatch_compute':
            return { success: await runCommand('federate --yes') };

        default:
            console.log(`${COLORS.red}>> Unsupported script action: ${step.action}${COLORS.reset}`);
            return { success: false };
    }
}

/**
 * Execute a `.clpso` script line-by-line (fail-fast).
 *
 * @param scriptRef - Script path or short name.
 * @param commandExecute - Command executor callback.
 * @returns True if script fully succeeded; false on first failure.
 */
async function script_run(
    scriptRef: string,
    commandExecute: (command: string, options?: CommandExecuteOptions) => Promise<boolean>,
    rl: readline.Interface
): Promise<boolean> {
    const resolvedPath: string | null = scriptPath_resolve(scriptRef);
    if (!resolvedPath) {
        console.log(`${COLORS.dim}○ Local script not found, trying built-in catalog on server...${COLORS.reset}`);
        return commandExecute(`/run ${scriptRef}`);
    }

    const content: string = fs.readFileSync(resolvedPath, 'utf-8');
    const plan: ScriptPlan = scriptPlan_parse(content);

    console.log(`${COLORS.cyan}● Running script:${COLORS.reset} ${COLORS.magenta}${resolvedPath}${COLORS.reset}`);

    if (plan.mode === 'legacy') {
        const commands: string[] = plan.commands;
        if (commands.length === 0) {
            console.log(`${COLORS.yellow}○ Script has no executable commands: ${resolvedPath}${COLORS.reset}`);
            return true;
        }
        for (let i = 0; i < commands.length; i++) {
            const command: string = commands[i];
            console.log(`${COLORS.dim}[RUN ${i + 1}/${commands.length}] ${command}${COLORS.reset}`);
            const stepPlan: ScriptStepPlan = scriptStepPlan_resolve(command);
            console.log(`${COLORS.yellow}○ ${stepPlan.title}${COLORS.reset}`);
            console.log(`${COLORS.dim}○ ${scriptStepTelemetry_resolve(command)}${COLORS.reset}`);
            for (const line of stepPlan.lines) {
                console.log(`${COLORS.dim}   • ${line}${COLORS.reset}`);
                await sleep_ms(110 + Math.floor(Math.random() * 120));
            }
            const success: boolean = await commandExecute(command, {
                scriptStep: true,
                stepIndex: i + 1,
                stepTotal: commands.length
            });
            if (!success) {
                console.log(`${COLORS.red}>> Script aborted at step ${i + 1}.${COLORS.reset}`);
                return false;
            }
        }
        console.log(`${COLORS.green}● Script complete.${COLORS.reset}`);
        return true;
    }

    const spec: StructuredScriptSpec = plan.spec;
    const steps: StructuredScriptStep[] = spec.steps;
    const runtime: ScriptRuntimeContext = {
        defaults: { ...(spec.defaults || {}) },
        answers: {},
        outputs: {}
    };

    console.log(`${COLORS.dim}○ Script mode: structured v${spec.version} (${spec.script})${COLORS.reset}`);
    if (spec.description) {
        console.log(`${COLORS.dim}○ ${spec.description}${COLORS.reset}`);
    }

    for (let i = 0; i < steps.length; i++) {
        const step: StructuredScriptStep = steps[i];
        const params: Record<string, unknown> = await stepParams_resolve(step, runtime, rl);
        const commandHint: string = stepCommandHint_build(step.action, params);
        console.log(`${COLORS.dim}[RUN ${i + 1}/${steps.length}] ${step.id} :: ${step.action}${COLORS.reset}`);

        const stepPlan: ScriptStepPlan = scriptStepPlan_resolve(commandHint);
        console.log(`${COLORS.yellow}○ ${stepPlan.title}${COLORS.reset}`);
        console.log(`${COLORS.dim}○ ${scriptStepTelemetry_resolve(commandHint)}${COLORS.reset}`);
        for (const line of stepPlan.lines) {
            console.log(`${COLORS.dim}   • ${line}${COLORS.reset}`);
            await sleep_ms(100 + Math.floor(Math.random() * 120));
        }

        const result: StructuredStepExecutionResult = await structuredStep_execute(
            step,
            params,
            runtime,
            commandExecute,
            rl,
            i + 1,
            steps.length
        );
        if (!result.success) {
            console.log(`${COLORS.red}>> Script aborted at step ${i + 1} (${step.id}).${COLORS.reset}`);
            return false;
        }

        const alias: string | undefined = step.outputs?.alias;
        if (alias) {
            runtime.outputs[alias] = result.output !== undefined ? result.output : params;
        }
    }

    console.log(`${COLORS.green}● Script complete.${COLORS.reset}`);
    return true;
}

// ─── HTTP Client ───────────────────────────────────────────────────────────

/**
 * Send a command to the Calypso server.
 */
async function command_send(command: string): Promise<CalypsoResponse> {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({ command });

        const options: http.RequestOptions = {
            hostname: HOST,
            port: PORT,
            path: '/calypso/command',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(body) as CalypsoResponse;
                    resolve(response);
                } catch (e: unknown) {
                    reject(new Error(`Invalid response: ${body}`));
                }
            });
        });

        req.on('error', (e) => {
            reject(new Error(`Connection failed: ${e.message}`));
        });

        req.write(postData);
        req.end();
    });
}

/**
 * Fetch current prompt from server and apply colors.
 */
async function prompt_fetch(): Promise<string> {
    return new Promise((resolve) => {
        const req = http.request({
            hostname: HOST,
            port: PORT,
            path: '/calypso/prompt',
            method: 'GET'
        }, (res: http.IncomingMessage): void => {
            let body = '';
            res.on('data', (chunk: Buffer | string): void => { body += chunk; });
            res.on('end', (): void => {
                try {
                    const data = JSON.parse(body) as { prompt: string };
                    // Parse prompt parts: user@CALYPSO:[path]>
                    const match: RegExpMatchArray | null = data.prompt.match(/^([^@]+)@([^:]+):\[([^\]]+)\]>\s*$/);
                    if (match) {
                        const [, user, host, path] = match;
                        resolve(`${COLORS.green}${user}${COLORS.reset}@${COLORS.cyan}${host}${COLORS.reset}:[${COLORS.magenta}${path}${COLORS.reset}]> `);
                    } else {
                        // Fallback: return raw prompt with basic styling
                        resolve(`${COLORS.cyan}${data.prompt}${COLORS.reset}`);
                    }
                } catch {
                    resolve(`${COLORS.yellow}CALYPSO>${COLORS.reset} `);
                }
            });
        });
        req.on('error', (): void => resolve(`${COLORS.yellow}CALYPSO>${COLORS.reset} `));
        req.end();
    });
}

/** Login response from server */
interface LoginResponse {
    success: boolean;
    username: string;
    workflows: WorkflowSummary[];
}

/**
 * Send login request to server with username.
 *
 * @param username - The username to login with
 * @returns Login response with available workflows
 */
async function login_send(username: string): Promise<LoginResponse> {
    return new Promise((resolve) => {
        const postData = JSON.stringify({ username });
        const req = http.request({
            hostname: HOST,
            port: PORT,
            path: '/calypso/login',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        }, (res: http.IncomingMessage): void => {
            let body: string = '';
            res.on('data', (chunk: Buffer): void => { body += chunk.toString(); });
            res.on('end', (): void => {
                try {
                    const data = JSON.parse(body);
                    resolve({
                        success: res.statusCode === 200,
                        username: data.username || username,
                        workflows: data.workflows || []
                    });
                } catch {
                    resolve({ success: false, username, workflows: [] });
                }
            });
        });
        req.on('error', (): void => resolve({ success: false, username, workflows: [] }));
        req.write(postData);
        req.end();
    });
}

/**
 * Send persona/workflow selection to server.
 *
 * @param workflowId - The workflow ID to set (or 'skip' for none)
 * @returns True if successful
 */
async function persona_send(workflowId: string): Promise<boolean> {
    return new Promise((resolve) => {
        const postData = JSON.stringify({ workflowId });
        const req = http.request({
            hostname: HOST,
            port: PORT,
            path: '/calypso/persona',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        }, (res: http.IncomingMessage): void => {
            resolve(res.statusCode === 200);
        });
        req.on('error', (): void => resolve(false));
        req.write(postData);
        req.end();
    });
}

/**
 * Prompt user to select a persona/workflow (conversational style).
 *
 * Called after Calypso greets the user, so she asks about workflow preference.
 *
 * @param workflows - Available workflows from server
 * @param rl - Existing readline interface to reuse
 * @returns Selected workflow ID or 'skip'
 */
async function persona_prompt(workflows: WorkflowSummary[], rl: readline.Interface): Promise<string> {
    return new Promise((resolve) => {
        // Calypso asks about workflow preference
        console.log();
        console.log(message_style(`I can guide you through a **structured workflow** if you'd like. Here are the available paths:`));
        console.log();

        // Display available workflows conversationally
        workflows.forEach((wf: WorkflowSummary, idx: number): void => {
            console.log(`  ${COLORS.cyan}${idx + 1}.${COLORS.reset} ${COLORS.bright}${wf.name}${COLORS.reset}`);
            console.log(`     ${COLORS.dim}${wf.description} (${wf.stageCount} steps)${COLORS.reset}`);
        });
        console.log(`  ${COLORS.cyan}${workflows.length + 1}.${COLORS.reset} ${COLORS.dim}No guidance needed - I'll explore freely${COLORS.reset}`);
        console.log();

        // Pause the main REPL and ask
        rl.pause();
        rl.question(`${COLORS.yellow}Which workflow would you like to follow? [1-${workflows.length + 1}]:${COLORS.reset} `, (answer: string) => {
            const choice: number = parseInt(answer.trim(), 10);

            if (isNaN(choice) || choice < 1 || choice > workflows.length + 1) {
                // Default to first workflow
                resolve(workflows[0]?.id || 'skip');
            } else if (choice === workflows.length + 1) {
                resolve('skip');
            } else {
                resolve(workflows[choice - 1].id);
            }
            rl.resume();
        });
    });
}

/**
 * Check if server is running.
 */
async function server_ping(): Promise<boolean> {
    return new Promise((resolve) => {
        const req = http.request({
            hostname: HOST,
            port: PORT,
            path: '/calypso/version',
            method: 'GET'
        }, (res: http.IncomingMessage): void => {
            resolve(res.statusCode === 200);
        });

        req.on('error', (): void => resolve(false));
        req.end();
    });
}

// ─── Output Formatting ─────────────────────────────────────────────────────

/**
 * Render a markdown table as formatted terminal output.
 */
function table_render(tableText: string): string {
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

    // Parse rows into cells
    const rows: string[][] = [];
    for (const line of lines) {
        // Skip separator lines (| :--- | --- |)
        if (separatorRow_is(line)) continue;

        const cells = line.split('|')
            .slice(1, -1)  // Remove empty first/last from | split
            .map((cell: string): string => cell.trim().replace(/\*\*/g, '')); // Remove bold markers
        if (cells.length > 0) {
            rows.push(cells);
        }
    }

    if (rows.length === 0) return tableText;

    const colCount: number = rows.reduce((max: number, row: string[]): number => Math.max(max, row.length), 0);
    rows.forEach((row: string[]): void => {
        while (row.length < colCount) row.push('');
    });

    // Calculate natural column widths
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
        // UX requirement: for Field|Value tables, keep the field column wide and stable.
        // Prefer a 40-char first column, with graceful fallback on narrow terminals.
        const fixedFieldWidth: number = 40;
        const minValueWidth: number = 18;

        if (contentBudget >= fixedFieldWidth + minValueWidth) {
            colWidths[0] = fixedFieldWidth;
            colWidths[1] = Math.max(minValueWidth, contentBudget - fixedFieldWidth);
        } else {
            // Degrade proportionally when terminal is too narrow for 40 + minimum value column.
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

    // Build output with box drawing
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

interface MessageStyleOptions {
    input?: string;
}

/**
 * Infer syntax language from a filename/path extension.
 */
function syntaxLanguage_fromPath(filePath: string): string | null {
    const basename: string = path.basename(filePath).toLowerCase();
    if (basename === 'dockerfile') return 'dockerfile';
    if (basename === 'makefile') return 'makefile';

    const ext: string = path.extname(basename).replace('.', '');
    switch (ext) {
        case 'py':
            return 'python';
        case 'json':
            return 'json';
        case 'yaml':
        case 'yml':
            return 'yaml';
        case 'md':
        case 'markdown':
        case 'adoc':
            return 'markdown';
        case 'sh':
        case 'bash':
        case 'zsh':
            return 'bash';
        case 'ts':
        case 'tsx':
            return 'typescript';
        case 'js':
        case 'mjs':
        case 'cjs':
            return 'javascript';
        case 'toml':
            return 'toml';
        case 'ini':
        case 'cfg':
        case 'conf':
            return 'ini';
        case 'txt':
            return 'text';
        default:
            return null;
    }
}

/**
 * Detect `cat <path>` command language for direct file output highlighting.
 */
function catLanguage_detect(input?: string): string | null {
    if (!input) return null;
    const tokens: RegExpMatchArray | null = input.match(/(?:[^\s"'`]+|"[^"]*"|'[^']*')+/g);
    if (!tokens || tokens.length === 0) return null;
    if (tokens[0].toLowerCase() !== 'cat') return null;

    const fileToken: string | undefined = tokens.slice(1).find((token: string): boolean => !token.startsWith('-'));
    if (!fileToken) return null;
    const normalized: string = fileToken.replace(/^['"]|['"]$/g, '');
    return syntaxLanguage_fromPath(normalized);
}

/**
 * Apply lightweight ANSI syntax highlighting for code content.
 */
function syntaxHighlight_renderAnsi(code: string, language: string): string {
    let text: string = code;
    const lang: string = language.toLowerCase();
    const masks: Map<string, string> = new Map();
    let maskIdx: number = 0;

    const maskWithColor = (pattern: RegExp, color: string): void => {
        text = text.replace(pattern, (match: string): string => {
            const key: string = `__SYNTAX_MASK_${maskIdx++}__`;
            masks.set(key, `${color}${match}${COLORS.reset}`);
            return key;
        });
    };

    const restoreMasks = (): void => {
        for (const [key, value] of masks.entries()) {
            text = text.replaceAll(key, value);
        }
    };

    if (lang === 'python') {
        maskWithColor(/("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g, COLORS.yellow);
        maskWithColor(/#[^\n]*/g, COLORS.dim);
        text = text.replace(/\b(import|from|as|def|class|return|if|elif|else|for|while|in|not|and|or|True|False|None|with|try|except|raise|yield|lambda|pass|break|continue|async|await)\b/g, `${COLORS.magenta}$1${COLORS.reset}`);
        text = text.replace(/\b(\d+(?:\.\d+)?)\b/g, `${COLORS.cyan}$1${COLORS.reset}`);
        restoreMasks();
        return text;
    }

    if (lang === 'json') {
        text = text.replace(/"(?:[^"\\]|\\.)*"/g, (match: string, offset: number, source: string): string => {
            const remainder: string = source.slice(offset + match.length);
            const isKey: boolean = /^\s*:/.test(remainder);
            return isKey
                ? `${COLORS.cyan}${match}${COLORS.reset}`
                : `${COLORS.green}${match}${COLORS.reset}`;
        });
        text = text.replace(/\b(true|false|null)\b/gi, `${COLORS.magenta}$1${COLORS.reset}`);
        text = text.replace(/\b(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi, `${COLORS.yellow}$1${COLORS.reset}`);
        return text;
    }

    if (lang === 'yaml' || lang === 'yml') {
        maskWithColor(/#[^\n]*/g, COLORS.dim);
        maskWithColor(/(".*?"|'.*?')/g, COLORS.green);
        text = text.replace(/^(\s*[\w.-]+)(\s*:)/gm, `${COLORS.cyan}$1${COLORS.reset}$2`);
        text = text.replace(/\b(true|false|null|yes|no|on|off)\b/gi, `${COLORS.magenta}$1${COLORS.reset}`);
        text = text.replace(/\b(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi, `${COLORS.yellow}$1${COLORS.reset}`);
        restoreMasks();
        return text;
    }

    if (lang === 'bash' || lang === 'shell' || lang === 'zsh') {
        maskWithColor(/#[^\n]*/g, COLORS.dim);
        maskWithColor(/(".*?"|'.*?')/g, COLORS.green);
        text = text.replace(/\$(\w+|\{[^}]+\})/g, (match: string): string => `${COLORS.magenta}${match}${COLORS.reset}`);
        text = text.replace(/\b(if|then|else|fi|for|while|do|done|case|esac|function|return|export|local|in)\b/g, `${COLORS.blue}$1${COLORS.reset}`);
        restoreMasks();
        return text;
    }

    if (lang === 'typescript' || lang === 'javascript') {
        maskWithColor(/(".*?"|'.*?'|`[\s\S]*?`)/g, COLORS.green);
        maskWithColor(/\/\/[^\n]*/g, COLORS.dim);
        maskWithColor(/\/\*[\s\S]*?\*\//g, COLORS.dim);
        text = text.replace(/\b(import|from|export|const|let|var|function|class|return|if|else|for|while|switch|case|break|continue|new|try|catch|finally|async|await|interface|type)\b/g, `${COLORS.magenta}$1${COLORS.reset}`);
        text = text.replace(/\b(-?\d+(?:\.\d+)?)\b/g, `${COLORS.yellow}$1${COLORS.reset}`);
        restoreMasks();
        return text;
    }

    if (lang === 'markdown' || lang === 'md') {
        text = text.replace(/^(#{1,6}\s+.+)$/gm, `${COLORS.cyan}$1${COLORS.reset}`);
        text = text.replace(/(\*\*[^*]+\*\*)/g, `${COLORS.bright}$1${COLORS.reset}`);
        text = text.replace(/(`[^`]+`)/g, `${COLORS.yellow}$1${COLORS.reset}`);
        return text;
    }

    // Generic fallback
    text = text.replace(/\b(-?\d+(?:\.\d+)?)\b/g, `${COLORS.yellow}$1${COLORS.reset}`);
    return text;
}

/**
 * Style a message for terminal output (dark background optimized).
 */
function message_style(message: string, options: MessageStyleOptions = {}): string {
    const codeMasks: Map<string, string> = new Map();
    let codeMaskIdx: number = 0;
    const codeMask_stash = (renderedBlock: string): string => {
        const key: string = `__CODE_BLOCK_${codeMaskIdx++}__`;
        codeMasks.set(key, renderedBlock);
        return key;
    };

    // Render fenced code blocks with syntax highlighting before markdown/text transforms.
    message = message.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g, (_full: string, rawLang: string, code: string): string => {
        const language: string = rawLang?.trim().toLowerCase() || 'text';
        const highlighted: string = syntaxHighlight_renderAnsi(code, language);
        const label: string = `${COLORS.dim}[${language.toUpperCase()}]${COLORS.reset}`;
        return codeMask_stash(`${label}\n${highlighted}`);
    });

    // If this is direct `cat` output, highlight the whole payload as source text.
    const catLanguage: string | null = catLanguage_detect(options.input);
    if (catLanguage && codeMasks.size === 0) {
        const looksStructuredResponse: boolean = /(^\s*[●○>>]|<span class=|^\s*POWER SCRIPTS AVAILABLE|^\s*CALYPSO GUIDANCE)/m.test(message);
        if (!looksStructuredResponse) {
            return syntaxHighlight_renderAnsi(message, catLanguage);
        }
    }

    // Check for markdown tables and render them
    const tableRegex = /(\|[^\n]+\|\n)+/g;
    message = message.replace(tableRegex, (match) => {
        // Only process if it looks like a proper table (has separator row)
        if (match.includes('---')) {
            return table_render(match);
        }
        return match;
    });

    let styled: string = message
        // Convert HTML spans to ANSI colors
        .replace(/<span class="dir">(.*?)<\/span>/g, `${COLORS.cyan}$1${COLORS.reset}`)
        .replace(/<span class="file">(.*?)<\/span>/g, `${COLORS.white}$1${COLORS.reset}`)
        .replace(/<span class="exec">(.*?)<\/span>/g, `${COLORS.green}$1${COLORS.reset}`)
        .replace(/<span class="dim">(.*?)<\/span>/g, `${COLORS.dim}$1${COLORS.reset}`)
        .replace(/<span class="highlight">(.*?)<\/span>/g, `${COLORS.yellow}$1${COLORS.reset}`)
        .replace(/<span class="success">(.*?)<\/span>/g, `${COLORS.green}$1${COLORS.reset}`)
        .replace(/<span class="error">(.*?)<\/span>/g, `${COLORS.red}$1${COLORS.reset}`)
        // Strip any remaining HTML tags
        .replace(/<[^>]+>/g, '')
        // Markdown bold (**text**) → bright white bold (must precede italic)
        .replace(/\*\*([^*]+)\*\*/g, `${COLORS.bright}${COLORS.white}$1${COLORS.reset}`)
        // Markdown italic (*text*) → italic
        .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, `${COLORS.italic}$1${COLORS.reset}`)
        // Markdown inline code (`text`) → yellow
        .replace(/`([^`]+)`/g, `${COLORS.yellow}$1${COLORS.reset}`)
        // Markdown headers (### text) → bold cyan
        .replace(/^(#{1,4})\s+(.+)$/gm, `${COLORS.bright}${COLORS.cyan}$2${COLORS.reset}`)
        // Affirmation markers (bright green bullet)
        .replace(/●/g, `${COLORS.green}●${COLORS.reset}`)
        // Data markers (bright cyan circle)
        .replace(/○/g, `${COLORS.cyan}○${COLORS.reset}`)
        // Error markers (bright red)
        .replace(/>>/g, `${COLORS.red}>>${COLORS.reset}`)
        // Dataset IDs (bright yellow)
        .replace(/\[(ds-\d+)\]/g, `${COLORS.yellow}[$1]${COLORS.reset}`)
        // Paths (bright magenta for visibility)
        .replace(/(~\/[^\s]+)/g, `${COLORS.magenta}$1${COLORS.reset}`)
        .replace(/(\/home\/[^\s]+)/g, `${COLORS.magenta}$1${COLORS.reset}`);

    for (const [key, value] of codeMasks.entries()) {
        styled = styled.replaceAll(key, value);
    }
    return styled;
}

/**
 * Print the banner.
 */
function banner_print(): void {
    console.log(cliAdapter.banner_render());
    console.log(`${COLORS.dim}Connected to ${HOST}:${PORT}${COLORS.reset}`);
    console.log(`${COLORS.dim}Type "/help", "/scripts" to list automation flows, "/run <script>" to execute, "quit" to exit.${COLORS.reset}\n`);
}

// ─── Tab Completion ─────────────────────────────────────────────────────────

/**
 * Fetch directory listing from server for tab completion.
 */
function dir_list(path: string): Promise<string[]> {
    return new Promise((resolve) => {
        const encodedPath = encodeURIComponent(path);
        const req = http.request({
            hostname: HOST,
            port: PORT,
            path: `/calypso/command`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, (res: http.IncomingMessage): void => {
            let body: string = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(body);
                    // Parse ls output - extract names from the HTML/text
                    const names: string[] = [];
                    const lines = response.message.split('\n');
                    for (const line of lines) {
                        // Extract filename from "name/   " or "name   " pattern
                        const match = line.match(/^(?:<[^>]+>)?([^\s<]+)/);
                        if (match && match[1]) {
                            names.push(match[1].replace(/<[^>]+>/g, ''));
                        }
                    }
                    resolve(names);
                } catch {
                    resolve([]);
                }
            });
        });
        req.on('error', () => resolve([]));
        req.write(JSON.stringify({ command: `ls ${path}` }));
        req.end();
    });
}

/**
 * Tab completion handler.
 */
async function completer(line: string): Promise<[string[], string]> {
    const words = line.split(/\s+/);
    const lastWord = words[words.length - 1] || '';

    // Commands that take paths
    const pathCommands = ['ls', 'cd', 'cat', 'mkdir', 'touch', 'rm', 'cp', 'mv', 'tree'];
    const cmd = words[0]?.toLowerCase();

    // Complete commands if first word
    if (words.length === 1 && !line.endsWith(' ')) {
        const allCommands = [...pathCommands, 'search', 'add', 'gather', 'mount', 'federate', 'pwd', 'env', 'whoami', 'help', '/scripts', '/run', 'quit'];
        const matches: string[] = allCommands.filter((c: string): boolean => c.startsWith(lastWord));
        return [matches, lastWord];
    }

    // Complete paths for path commands
    if (pathCommands.includes(cmd) || lastWord.startsWith('/') || lastWord.startsWith('~') || lastWord.startsWith('.')) {
        // Determine directory to list and prefix to match
        let dirPath = '.';
        let prefix = lastWord;

        if (lastWord.includes('/')) {
            const lastSlash = lastWord.lastIndexOf('/');
            dirPath = lastWord.substring(0, lastSlash) || '/';
            prefix = lastWord.substring(lastSlash + 1);
        } else if (lastWord === '~') {
            dirPath = '~';
            prefix = '';
        }

        const entries: string[] = await dir_list(dirPath);
        const matches: string[] = entries
            .filter((name: string): boolean => name.startsWith(prefix))
            .map((name: string): string => {
                const base: string = lastWord.includes('/')
                    ? lastWord.substring(0, lastWord.lastIndexOf('/') + 1)
                    : (dirPath === '.' ? '' : dirPath + '/');
                return base + name;
            });

        return [matches, lastWord];
    }

    // Complete dataset IDs for add/remove
    if (cmd === 'add' || cmd === 'remove') {
        const dsIds: string[] = ['ds-001', 'ds-002', 'ds-003', 'ds-004', 'ds-005', 'ds-006'];
        const matches: string[] = dsIds.filter((id: string): boolean => id.startsWith(lastWord));
        return [matches, lastWord];
    }

    return [[], lastWord];
}

// ─── REPL ──────────────────────────────────────────────────────────────────

/**
 * Prompt user for login credentials (SSH-style).
 */
async function login_prompt(): Promise<string> {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log(`${COLORS.cyan}╔════════════════════════════════════════════════════════════════╗${COLORS.reset}`);
        console.log(`${COLORS.cyan}║${COLORS.reset}  ${COLORS.bright}CALYPSO TERMINAL ACCESS${COLORS.reset}                                       ${COLORS.cyan}║${COLORS.reset}`);
        console.log(`${COLORS.cyan}║${COLORS.reset}  ${COLORS.dim}Secure connection to ARGUS Federation Network${COLORS.reset}                 ${COLORS.cyan}║${COLORS.reset}`);
        console.log(`${COLORS.cyan}╚════════════════════════════════════════════════════════════════╝${COLORS.reset}`);
        console.log();

        rl.question(`${COLORS.yellow}login as:${COLORS.reset} `, (answer: string) => {
            rl.close();
            const username: string = answer.trim() || 'developer';
            resolve(username);
        });
    });
}

/**
 * Main REPL loop.
 */
async function repl_start(): Promise<void> {
    // Check server connectivity
    const isRunning = await server_ping();
    if (!isRunning) {
        console.error(`${COLORS.red}>> ERROR: Cannot connect to Calypso server at ${BASE_URL}`);
        console.error(`${COLORS.dim}   Make sure the server is running: make calypso${COLORS.reset}`);
        process.exit(1);
    }

    // Login prompt (SSH-style)
    const username: string = await login_prompt();

    // Send login to server to initialize with username
    const loginResponse: LoginResponse = await login_send(username);
    if (!loginResponse.success) {
        console.error(`${COLORS.red}>> Login failed${COLORS.reset}`);
        process.exit(1);
    }

    console.log(`${COLORS.dim}Authenticating ${loginResponse.username}...${COLORS.reset}`);
    console.log(`${COLORS.green}● Access granted.${COLORS.reset}`);
    console.log();

    banner_print();

    // Fetch initial prompt from server
    let currentPrompt: string = await prompt_fetch();

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: currentPrompt,
        completer: (line: string, callback: (err: Error | null, result: [string[], string]) => void) => {
            completer(line).then(result => callback(null, result)).catch(() => callback(null, [[], line]));
        }
    });

    // Fetch personalized greeting from LLM
    try {
        const stopGreetSpinner: () => void = spinner_start('CALYPSO initializing');
        const greetingResponse = await command_send(`/greet ${username}`);
        stopGreetSpinner();
        if (greetingResponse.message) {
            console.log(message_style(greetingResponse.message));
        }
    } catch {
        // Greeting is optional - continue if it fails
    }

    // Calypso asks about workflow preference (after greeting)
    if (loginResponse.workflows.length > 0) {
        const selectedWorkflowId: string = await persona_prompt(loginResponse.workflows, rl);

        // Send selection to server
        const personaSuccess: boolean = await persona_send(selectedWorkflowId);
        if (personaSuccess) {
            console.log();
            if (selectedWorkflowId === 'skip') {
                try {
                    const standbyResponse: CalypsoResponse = await command_send(`/standby ${username}`);
                    if (standbyResponse.message) {
                        console.log(message_style(standbyResponse.message));
                    }
                } catch {
                    console.log(message_style(
                        `● Acknowledged, ${username}. Workflow guidance is in standby.\n` +
                        `○ Free exploration mode is active.\n` +
                        `○ Use \`/next\` for immediate command guidance or \`/workflow\` for stage status.`
                    ));
                }
            } else {
                const selected: WorkflowSummary | undefined = loginResponse.workflows.find(
                    (w: WorkflowSummary): boolean => w.id === selectedWorkflowId
                );
                console.log(message_style(`**${selected?.name || selectedWorkflowId}** activated. I'll guide you through each step.`));
            }
        }
    }
    console.log();

    rl.prompt();

    const command_executeAndRender = async (input: string, options: CommandExecuteOptions = {}): Promise<boolean> => {
        try {
            const spinnerLabel: string = spinnerLabel_resolve(input, options);
            const minSpinnerMs: number = spinnerMinDuration_resolve(input, options);
            const startedAt: number = Date.now();
            const stopSpinner: () => void = spinner_start(spinnerLabel);
            const response = await command_send(input);
            const elapsed: number = Date.now() - startedAt;
            if (elapsed < minSpinnerMs) {
                await sleep_ms(minSpinnerMs - elapsed);
            }
            stopSpinner();

            // Check for special animation markers
            if (response.message === '__HARMONIZE_ANIMATE__') {
                await harmonization_animate();
                console.log(message_style(`● **COHORT HARMONIZATION COMPLETE.** Data is now standardized for federated training.`));
            } else {
                await response_renderAnimated(response.message, input, options);
            }

            // Show actions in verbose mode (can be toggled with env var)
            if (process.env.CALYPSO_VERBOSE === 'true' && response.actions.length > 0) {
                const actionTypes: string = response.actions.map((a: CalypsoAction): string => a.type).join(', ');
                console.log(`${COLORS.dim}[Actions: ${actionTypes}]${COLORS.reset}`);
            }

            // Update prompt (pwd may have changed)
            currentPrompt = await prompt_fetch();
            rl.setPrompt(currentPrompt);
            return response.success;
        } catch (e: unknown) {
            const error = e instanceof Error ? e.message : 'Unknown error';
            console.log(`${COLORS.red}>> ERROR: ${error}${COLORS.reset}`);
            return false;
        }
    };

    rl.on('line', async (line: string) => {
        const extracted: string | null = transcriptCommand_extract(line);

        // Ignore known transcript output lines to support conversation paste replay.
        if (extracted === null) {
            rl.prompt();
            return;
        }

        const input: string = extracted.trim();

        // Handle exit commands
        if (input === 'quit' || input === 'exit' || input === 'q') {
            console.log(`${COLORS.dim}Goodbye.${COLORS.reset}`);
            rl.close();
            process.exit(0);
        }

        // Skip empty input
        if (!input) {
            rl.prompt();
            return;
        }

        if (input === '/run' || input.startsWith('/run ')) {
            const scriptRef: string = input.replace(/^\/run\s*/, '').trim();
            if (!scriptRef) {
                console.log(`${COLORS.yellow}Usage: /run <script.clpso>${COLORS.reset}`);
                console.log(`${COLORS.dim}Examples: /scripts, /run hist-harmonize${COLORS.reset}`);
            } else {
                await script_run(scriptRef, command_executeAndRender, rl);
            }
            rl.prompt();
            return;
        }

        await command_executeAndRender(input);
        rl.prompt();
    });

    rl.on('close', () => {
        console.log(`\n${COLORS.dim}Goodbye.${COLORS.reset}`);
        process.exit(0);
    });
}

// ─── Main ──────────────────────────────────────────────────────────────────

repl_start().catch((e) => {
    console.error(`${COLORS.red}Fatal error: ${e.message}${COLORS.reset}`);
    process.exit(1);
});
