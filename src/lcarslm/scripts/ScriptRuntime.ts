/**
 * @file ScriptRuntime - Structured Script Execution Engine
 *
 * Manages the lifecycle of power scripts: listing, dry-run preview,
 * execution of legacy (sequential) scripts, and the interactive
 * structured script protocol with parameter resolution and user prompts.
 *
 * Extracted from CalypsoCore to isolate script state management.
 *
 * @module
 */

import type { CalypsoResponse, CalypsoAction, CalypsoStoreActions } from '../types.js';
import { CalypsoStatusCode } from '../types.js';
import type { Dataset } from '../../core/models/types.js';
import type {
    ScriptRuntimeContext,
    ScriptPendingInput,
    ScriptRuntimeSession,
    ScriptStepParamsResolved,
    ScriptStepParamsPending,
    ScriptStepParamResolution,
    ScriptValueResolved,
    ScriptValuePending,
    ScriptValueResolution,
    ScriptStepExecutionSuccess,
    ScriptStepExecutionFailure,
    ScriptStepExecutionPending,
    ScriptStepExecutionResult,
    ScriptSuggestionScore
} from './types.js';
import {
    script_find,
    scripts_list,
    type CalypsoScript,
    type CalypsoStructuredScript,
    type CalypsoStructuredStep
} from './Catalog.js';

/**
 * Callback type for executing a CalypsoCore command from within a script step.
 */
export type CommandExecutor = (command: string) => Promise<CalypsoResponse>;

/**
 * Manages power script listing, execution, and interactive structured sessions.
 *
 * Scripts are declarative automation sequences that compose CalypsoCore commands.
 * Structured scripts support parameter resolution, user prompts, and step outputs.
 */
export class ScriptRuntime {
    /** Active structured script runtime session awaiting completion/input. */
    private session: ScriptRuntimeSession | null = null;

    constructor(
        private storeActions: CalypsoStoreActions,
        private commandExecutor: CommandExecutor,
        private lastMentionedDatasets_get: () => Dataset[]
    ) {}

    // ─── Public API ───────────────────────────────────────────────────────

    /**
     * Whether a script session is currently active.
     */
    get active(): boolean {
        return this.session !== null;
    }

    /**
     * Reset the active script session.
     */
    session_reset(): void {
        this.session = null;
    }

    /**
     * List available scripts or show details for a specific script.
     */
    scripts_response(args: string[]): CalypsoResponse {
        const targetRaw: string = args.join(' ').trim();
        if (!targetRaw) {
            const lines: string[] = [
                '● Yes. I can show you the available power scripts now.',
                '○ Tip: You can type `/scripts` anytime to see this list.',
                '',
                'POWER SCRIPTS AVAILABLE:',
                ''
            ];

            const scripts: ReadonlyArray<CalypsoScript> = scripts_list();
            scripts.forEach((script: CalypsoScript, idx: number): void => {
                lines.push(`  ${idx + 1}. ${script.id} - ${script.description}`);
            });

            lines.push('');
            lines.push('Use: /scripts [name] or /run [name]');
            return this.response_create(lines.join('\n'), [], true);
        }

        const script: CalypsoScript | null = script_find(targetRaw);
        if (!script) {
            return this.response_create(this.scriptNotFound_message(targetRaw), [], false);
        }

        const lines: string[] = [
            `● SCRIPT: ${script.id}`,
            `○ ${script.description}`,
            `○ Target: ${script.target}`,
            ''
        ];

        if (script.aliases.length > 0) {
            lines.push(`○ Aliases: ${script.aliases.join(', ')}`);
        }
        if (script.requires.length > 0) {
            lines.push(`○ Requires: ${script.requires.join(', ')}`);
        }

        if (script.structured) {
            lines.push(`○ Mode: structured v${script.structured.version}`);
            lines.push('○ Steps:');
            script.structured.steps.forEach((step: CalypsoStructuredStep, idx: number): void => {
                lines.push(`  ${idx + 1}. [${step.id}] ${step.action}`);
            });
        } else {
            lines.push('○ Steps:');
            script.steps.forEach((step: string, idx: number): void => {
                lines.push(`  ${idx + 1}. ${step}`);
            });
        }

        lines.push('');
        lines.push(`Run: /run ${script.id}`);
        lines.push(`Dry run: /run --dry ${script.id}`);
        return this.response_create(lines.join('\n'), [], true);
    }

    /**
     * Execute a script by reference (with optional --dry flag).
     */
    async script_execute(args: string[]): Promise<CalypsoResponse> {
        let dryRun: boolean = false;
        let scriptRef: string = '';

        if (args[0] === '--dry' || args[0] === '-n') {
            dryRun = true;
            scriptRef = args.slice(1).join(' ').trim();
        } else {
            scriptRef = args.join(' ').trim();
        }

        if (!scriptRef) {
            return this.response_create('Usage: /run [script] OR /run --dry [script]', [], false);
        }

        const script: CalypsoScript | null = script_find(scriptRef);
        if (!script) {
            return this.response_create(this.scriptNotFound_message(scriptRef), [], false);
        }

        const unmetRequirement: string | null = this.scriptRequirement_unmet(script.requires);
        if (unmetRequirement) {
            return this.response_create(`>> ERROR: SCRIPT REQUIREMENT FAILED (${unmetRequirement})`, [], false);
        }

        if (dryRun) {
            return this.scriptDryRun_response(script);
        }

        if (script.structured) {
            return this.scriptStructured_begin(script);
        }

        const lines: string[] = [
            `● RUNNING SCRIPT: ${script.id}`,
            `○ ${script.description}`
        ];
        const actions: CalypsoAction[] = [];

        for (let i: number = 0; i < script.steps.length; i++) {
            const step: string = script.steps[i];
            const trimmedStep: string = step.trim();
            if (/^\/?(run|scripts)\b/i.test(trimmedStep)) {
                return this.response_create(
                    `>> ERROR: SCRIPT "${script.id}" CONTAINS NESTED SCRIPT COMMAND AT STEP ${i + 1}.`,
                    actions,
                    false
                );
            }

            let result: CalypsoResponse = await this.commandExecutor(trimmedStep);
            
            // Handle automatic phase jump confirmation within scripts
            if (!result.success && /PHASE JUMP/i.test(result.message || '')) {
                result = await this.commandExecutor('confirm');
            }

            actions.push(...result.actions);

            const summary: string | null = this.scriptStep_summary(result.message);

            if (!result.success) {
                lines.push(`[FAIL] [${i + 1}/${script.steps.length}] ${trimmedStep}`);
                if (summary) lines.push(`  -> ${summary}`);
                lines.push(`>> SCRIPT ABORTED AT STEP ${i + 1}.`);
                if (result.message && result.message !== '__HARMONIZE_ANIMATE__' && !summary) {
                    lines.push(result.message);
                }
                return this.response_create(lines.join('\n'), actions, false);
            }

            lines.push(`[OK] [${i + 1}/${script.steps.length}] ${trimmedStep}`);
            if (summary) lines.push(`  -> ${summary}`);
        }

        lines.push('');
        lines.push(`● SCRIPT COMPLETE. TARGET ${script.target.toUpperCase()} READY.`);
        return this.response_create(lines.join('\n'), actions, true);
    }

    /**
     * Consume user input for an active structured script prompt if present.
     *
     * @returns Response if input was consumed, null to pass through.
     */
    async maybeConsumeInput(input: string): Promise<CalypsoResponse | null> {
        const session: ScriptRuntimeSession | null = this.session;
        if (!session || !session.pending) {
            return null;
        }

        if (input.trim().startsWith('/')) {
            return null;
        }

        if (/^\/?(abort|cancel)$/i.test(input.trim())) {
            const scriptId: string = session.script.id;
            this.session = null;
            return this.response_create(`○ SCRIPT ABORTED: ${scriptId}`, [], false);
        }

        const normalized: string = input.trim() === '-' ? '' : input.trim();
        session.context.answers[session.pending.key] = normalized;
        session.pending = null;
        return this.scriptStructured_continue();
    }

    // ─── Dry Run ──────────────────────────────────────────────────────────

    /**
     * Render dry-run output for legacy or structured scripts.
     */
    private scriptDryRun_response(script: CalypsoScript): CalypsoResponse {
        const lines: string[] = [
            `● DRY RUN: ${script.id}`,
            `○ ${script.description}`,
            `○ Target: ${script.target}`,
            ''
        ];

        if (script.structured) {
            const spec: CalypsoStructuredScript = script.structured;
            lines.push(`○ Mode: structured v${spec.version}`);
            lines.push('');
            spec.steps.forEach((step: CalypsoStructuredStep, idx: number): void => {
                lines.push(`  ${idx + 1}. [${step.id}] action=${step.action}`);
                if (step.params) {
                    Object.entries(step.params).forEach(([key, val]): void => {
                        lines.push(`     ${key} = ${JSON.stringify(val)}`);
                    });
                }
            });
        } else {
            lines.push('○ Steps:');
            script.steps.forEach((step: string, idx: number): void => {
                lines.push(`  ${idx + 1}. ${step}`);
            });
        }

        lines.push('');
        lines.push(`Run: /run ${script.id}`);
        return this.response_create(lines.join('\n'), [], true);
    }

    // ─── Structured Script Engine ─────────────────────────────────────────

    /**
     * Begin a structured script session.
     */
    private async scriptStructured_begin(script: CalypsoScript): Promise<CalypsoResponse> {
        const spec: CalypsoStructuredScript | undefined = script.structured;
        if (!spec) {
            return this.response_create(`>> ERROR: SCRIPT ${script.id} HAS NO STRUCTURED SPEC.`, [], false);
        }

        this.session = {
            script,
            spec,
            stepIndex: 0,
            context: {
                defaults: { ...(spec.defaults || {}) },
                answers: {},
                outputs: {}
            },
            actions: [],
            pending: null
        };

        const lines: string[] = [
            `● RUNNING SCRIPT: ${script.id}`,
            `○ ${script.description}`,
            `○ MODE: structured v${spec.version}`
        ];
        return this.scriptStructured_continue(lines);
    }

    /**
     * Continue structured script execution from current step.
     */
    private async scriptStructured_continue(prefixLines: string[] = []): Promise<CalypsoResponse> {
        const session: ScriptRuntimeSession | null = this.session;
        if (!session) {
            return this.response_create('>> ERROR: NO ACTIVE SCRIPT RUNTIME.', [], false);
        }

        const lines: string[] = [...prefixLines];
        const totalSteps: number = session.spec.steps.length;

        while (session.stepIndex < totalSteps) {
            const step: CalypsoStructuredStep = session.spec.steps[session.stepIndex];
            const progress: string = `${session.stepIndex + 1}/${totalSteps}`;

            const resolved: ScriptStepParamResolution = this.scriptStructured_stepParamsResolve(step, session.context);
            if (!resolved.ok) {
                session.pending = resolved.pending;
                lines.push(`[WAIT] [${progress}] ${step.id} :: ${step.action}`);
                lines.push('● SCRIPT INPUT REQUIRED.');
                lines.push(`○ ${resolved.pending.prompt}`);
                if (resolved.pending.options && resolved.pending.options.length > 0) {
                    lines.push(...resolved.pending.options);
                }
                lines.push('○ Reply with a value, or type abort.');
                return this.response_create(lines.join('\n'), [...session.actions], true);
            }

            const execution: ScriptStepExecutionResult = await this.scriptStructured_stepExecute(step, resolved.params, session);
            session.actions.push(...execution.actions);

            if (execution.success === 'pending') {
                session.pending = execution.pending;
                lines.push(`[WAIT] [${progress}] ${step.id} :: ${step.action}`);
                lines.push('● SCRIPT INPUT REQUIRED.');
                lines.push(`○ ${execution.pending.prompt}`);
                if (execution.pending.options && execution.pending.options.length > 0) {
                    lines.push(...execution.pending.options);
                }
                lines.push('○ Reply with a value, or type abort.');
                return this.response_create(lines.join('\n'), [...session.actions], true);
            }

            if (!execution.success) {
                lines.push(`[FAIL] [${progress}] ${step.id} :: ${step.action}`);
                if (execution.message) {
                    lines.push(`>> ${execution.message}`);
                }
                lines.push(`>> SCRIPT ABORTED AT STEP ${session.stepIndex + 1}.`);
                const actions: CalypsoAction[] = [...session.actions];
                this.session = null;
                return this.response_create(lines.join('\n'), actions, false);
            }

            lines.push(`[OK] [${progress}] ${step.id} :: ${step.action}`);
            if (execution.summary) {
                lines.push(`  -> ${execution.summary}`);
            }

            const alias: string | undefined = step.outputs?.alias;
            if (alias) {
                session.context.outputs[alias] = execution.output !== undefined ? execution.output : resolved.params;
            }

            session.stepIndex += 1;
        }

        lines.push('');
        lines.push(`● SCRIPT COMPLETE. TARGET ${session.script.target.toUpperCase()} READY.`);
        const actions: CalypsoAction[] = [...session.actions];
        this.session = null;
        return this.response_create(lines.join('\n'), actions, true);
    }

    // ─── Parameter Resolution ─────────────────────────────────────────────

    /**
     * Resolve structured step params using defaults/answers/aliases.
     */
    private scriptStructured_stepParamsResolve(step: CalypsoStructuredStep, runtime: ScriptRuntimeContext): ScriptStepParamResolution {
        if (!step.params || Object.keys(step.params).length === 0) {
            return { ok: true, params: {} };
        }

        const resolved: Record<string, unknown> = {};

        for (const [key, rawValue] of Object.entries(step.params)) {
            const valueResolution: ScriptValueResolution = this.scriptStructured_valueResolve(key, rawValue, step.id, runtime);
            if (!valueResolution.ok) {
                return { ok: false, pending: valueResolution.pending, params: {} };
            }
            resolved[key] = valueResolution.value;
        }

        return { ok: true, params: resolved };
    }

    /**
     * Resolve a single parameter value — literal, expression, or user prompt.
     */
    private scriptStructured_valueResolve(
        key: string,
        rawValue: unknown,
        stepId: string,
        runtime: ScriptRuntimeContext
    ): ScriptValueResolution {
        if (typeof rawValue === 'string' && rawValue.startsWith('${')) {
            const exprResult: unknown = this.scriptStructured_expressionResolve(rawValue, runtime);
            if (exprResult !== undefined) {
                return { ok: true, value: exprResult };
            }
        }

        if (rawValue !== null && rawValue !== undefined && rawValue !== '') {
            return { ok: true, value: rawValue };
        }

        const answerKey: string = `${stepId}.${key}`;
        const existingAnswer: string | undefined = runtime.answers[answerKey];
        if (existingAnswer !== undefined) {
            return { ok: true, value: existingAnswer };
        }

        const defaultValue: unknown = runtime.defaults[key];
        if (defaultValue !== undefined) {
            return { ok: true, value: defaultValue };
        }

        return {
            ok: false,
            pending: {
                kind: 'param',
                key: answerKey,
                prompt: `Enter value for "${key}" (step ${stepId}):`,
                options: []
            },
            value: undefined
        };
    }

    /**
     * Resolve a ${...} expression reference.
     *
     * Syntax: ${name}, ${name.field}, ${scope.path}, ${a ?? b}
     *
     * Bare names (no recognized scope prefix) resolve against outputs first,
     * then defaults. Scoped names (outputs., defaults., answers.) resolve
     * directly. The ?? operator provides fallback: try left, if undefined
     * try right.
     */
    private scriptStructured_expressionResolve(expr: string, runtime: ScriptRuntimeContext): unknown {
        const trimmed: string = expr.trim();
        if (!trimmed.startsWith('${') || !trimmed.endsWith('}')) return undefined;

        const inner: string = trimmed.slice(2, -1).trim();

        // Handle ?? fallback operator
        if (inner.includes('??')) {
            const parts: string[] = inner.split('??').map(p => p.trim());
            for (const part of parts) {
                const result: unknown = this.scriptStructured_pathResolve(part, runtime);
                if (result !== undefined) return result;
            }
            return undefined;
        }

        return this.scriptStructured_pathResolve(inner, runtime);
    }

    /**
     * Resolve a single dotted path against the runtime scopes.
     *
     * If the first segment is a known scope (outputs, defaults, answers),
     * resolve the rest within that scope. Otherwise treat the entire path
     * as an outputs reference (bare name shorthand).
     */
    private scriptStructured_pathResolve(path: string, runtime: ScriptRuntimeContext): unknown {
        const dotIndex: number = path.indexOf('.');
        if (dotIndex !== -1) {
            const scope: string = path.slice(0, dotIndex);
            const rest: string = path.slice(dotIndex + 1);

            if (scope === 'outputs' && runtime.outputs) {
                return this.scriptStructured_referenceResolve(rest, runtime.outputs);
            }
            if (scope === 'defaults' && runtime.defaults) {
                return this.scriptStructured_referenceResolve(rest, runtime.defaults);
            }
            if (scope === 'answers' && runtime.answers) {
                return this.scriptStructured_referenceResolve(rest, runtime.answers);
            }
        }

        // Bare name or unrecognized scope — search outputs first, then defaults
        if (runtime.outputs) {
            const result: unknown = this.scriptStructured_referenceResolve(path, runtime.outputs);
            if (result !== undefined) return result;
        }
        if (runtime.defaults) {
            const result: unknown = this.scriptStructured_referenceResolve(path, runtime.defaults);
            if (result !== undefined) return result;
        }

        return undefined;
    }

    /**
     * Walk a dot-delimited path into an object.
     */
    private scriptStructured_referenceResolve(pathExpr: string, scope: Record<string, unknown>): unknown {
        const segments: string[] = pathExpr.split('.');
        let current: unknown = scope;

        for (const segment of segments) {
            if (current === null || current === undefined) return undefined;

            if (typeof current === 'object') {
                if (Array.isArray(current)) {
                    const idx: number = parseInt(segment, 10);
                    if (!isNaN(idx) && idx >= 1 && idx < current.length) {
                        current = current[idx];
                    } else {
                        return undefined;
                    }
                } else {
                    const obj = current as Record<string, unknown>;
                    if (segment in obj) {
                        current = obj[segment];
                    } else {
                        return undefined;
                    }
                }
            } else {
                return undefined;
            }
        }

        return current;
    }

    // ─── Step Execution ───────────────────────────────────────────────────

    /**
     * Execute a single structured script step.
     */
    private async scriptStructured_stepExecute(
        step: CalypsoStructuredStep,
        params: Record<string, unknown>,
        session: ScriptRuntimeSession
    ): Promise<ScriptStepExecutionResult> {
        const runCommand = async (command: string): Promise<ScriptStepExecutionResult> => {
            let response: CalypsoResponse = await this.commandExecutor(command);
            
            // Handle automatic phase jump confirmation within scripts
            if (!response.success && /PHASE JUMP/i.test(response.message || '')) {
                response = await this.commandExecutor('confirm');
            }

            if (!response.success) {
                return {
                    success: false,
                    actions: response.actions,
                    message: this.scriptStep_summary(response.message) || response.message || `command failed: ${command}`
                };
            }
            return {
                success: true,
                actions: response.actions,
                summary: this.scriptStep_summary(response.message) || undefined
            };
        };

        if (step.action === 'search') return this.step_search(params, runCommand);
        if (step.action === 'select_dataset') return this.step_selectDataset(step, params, session);
        if (step.action === 'add') return this.step_add(params, runCommand);
        if (step.action === 'rename') return this.step_rename(params, runCommand);
        if (step.action === 'harmonize') return runCommand('harmonize');
        if (step.action === 'proceed' || step.action === 'code') return runCommand(step.action);
        if (step.action === 'run_python') return this.step_runPython(params, runCommand);
        if (step.action === 'federate.transcompile') return this.step_federateTranscompile(runCommand);
        if (step.action === 'federate.containerize' || step.action === 'federate.publish' || step.action === 'federate.dispatch_compute') return runCommand('federate --yes');
        if (step.action === 'federate.publish_metadata') return this.step_federatePublishMetadata(params, runCommand);

        return { success: false, actions: [], message: `unsupported script action: ${step.action}` };
    }

    private async step_search(params: Record<string, unknown>, runCommand: (cmd: string) => Promise<ScriptStepExecutionResult>): Promise<ScriptStepExecutionResult> {
        const query: string = String(params.query || '').trim();
        if (!query) return { success: false, actions: [], message: 'missing query for search step' };
        
        const run = await runCommand(`search ${query}`);
        if (run.success !== true) return run;
        
        return {
            success: true,
            actions: run.actions,
            summary: run.summary,
            output: [...this.lastMentionedDatasets_get()]
        };
    }

    private async step_add(params: Record<string, unknown>, runCommand: (cmd: string) => Promise<ScriptStepExecutionResult>): Promise<ScriptStepExecutionResult> {
        const datasetId: string = String(params.dataset || '').trim();
        if (!datasetId) return { success: false, actions: [], message: 'missing dataset id for add step' };
        return runCommand(`add ${datasetId}`);
    }

    private async step_rename(params: Record<string, unknown>, runCommand: (cmd: string) => Promise<ScriptStepExecutionResult>): Promise<ScriptStepExecutionResult> {
        const projectName: string = String(params.project || '').trim();
        if (!projectName) return { success: false, actions: [], message: 'missing project name for rename step' };
        return runCommand(`rename ${projectName}`);
    }

    private async step_runPython(params: Record<string, unknown>, runCommand: (cmd: string) => Promise<ScriptStepExecutionResult>): Promise<ScriptStepExecutionResult> {
        const scriptName: string = String(params.script || 'train.py').trim() || 'train.py';
        const args: string[] = Array.isArray(params.args) ? (params.args as unknown[]).map(String) : [];
        return runCommand(['python', scriptName, ...args].join(' ').trim());
    }

    private async step_federateTranscompile(runCommand: (cmd: string) => Promise<ScriptStepExecutionResult>): Promise<ScriptStepExecutionResult> {
        const start = await runCommand('federate');
        if (start.success !== true) return start;
        const confirm = await runCommand('federate --yes');
        if (confirm.success !== true) return confirm;
        return {
            success: true,
            actions: [...start.actions, ...confirm.actions],
            summary: confirm.summary || start.summary
        };
    }

    private async step_federatePublishMetadata(params: Record<string, unknown>, runCommand: (cmd: string) => Promise<ScriptStepExecutionResult>): Promise<ScriptStepExecutionResult> {
        const enter = await runCommand('federate --yes');
        if (enter.success !== true) return enter;

        const actions: CalypsoAction[] = [...enter.actions];
        let summary = enter.summary;

        if (params.app_name) {
            const res = await runCommand(`federate --name ${String(params.app_name).trim()}`);
            actions.push(...res.actions);
            if (res.success !== true) return res;
            summary = res.summary || summary;
        }
        if (params.org) {
            const res = await runCommand(`federate --org ${String(params.org).trim()}`);
            actions.push(...res.actions);
            if (res.success !== true) return res;
            summary = res.summary || summary;
        }
        if (params.visibility) {
            const vis = String(params.visibility).trim().toLowerCase();
            const res = await runCommand(vis === 'private' ? 'federate --private' : 'federate --public');
            actions.push(...res.actions);
            if (res.success !== true) return res;
            summary = res.summary || summary;
        }

        return {
            success: true,
            actions,
            summary,
            output: { app_name: params.app_name, org: params.org, visibility: params.visibility }
        };
    }

    private step_selectDataset(step: CalypsoStructuredStep, params: Record<string, unknown>, session: ScriptRuntimeSession): ScriptStepExecutionResult {
        const candidates = Array.isArray(params.from) ? params.from as Dataset[] : [];
        if (candidates.length === 0) return { success: false, actions: [], message: 'no dataset candidates available' };

        const strategy = String(params.strategy || 'ask').toLowerCase();
        let selected: Dataset | null = null;

        if (strategy === 'first' || strategy === 'best_match') selected = candidates[0];
        else if (strategy === 'by_id') {
            const desired = String(params.id || params.dataset || '').trim().toLowerCase();
            selected = candidates.find(ds => ds.id.toLowerCase() === desired) || null;
        } else if (candidates.length === 1) {
            selected = candidates[0];
        } else {
            const key = `${step.id}.selection`;
            const choice = (session.context.answers[key] || '').trim();
            if (!choice) {
                return {
                    success: 'pending', actions: [],
                    pending: {
                        kind: 'selection', key,
                        prompt: `Select dataset for ${step.id} by number or id.`,
                        options: candidates.map((ds, i) => `  ${i + 1}. [${ds.id}] ${ds.name} (${ds.modality})`)
                    }
                };
            }
            const idx = parseInt(choice, 10);
            selected = (!isNaN(idx) && idx >= 1 && idx <= candidates.length)
                ? candidates[idx - 1]
                : candidates.find(ds => ds.id.toLowerCase() === choice.toLowerCase()) || null;
        }

        if (!selected) {
            return {
                success: 'pending', actions: [],
                pending: {
                    kind: 'selection', key: `${step.id}.selection`,
                    prompt: `Invalid selection. Choose dataset for ${step.id}.`,
                    options: candidates.map((ds, i) => `  ${i + 1}. [${ds.id}] ${ds.name}`)
                }
            };
        }

        session.context.answers.selected_dataset_id = selected.id;
        return { success: true, actions: [], summary: `SELECTED DATASET: [${selected.id}] ${selected.name}`, output: selected };
    }

    // ─── Requirement Checking ─────────────────────────────────────────────

    /**
     * Evaluate script requirement keys.
     *
     * @returns First unmet requirement key, or null if all pass.
     */
    private scriptRequirement_unmet(requirements: string[]): string | null {
        for (const requirement of requirements) {
            if (requirement === 'active_project' && !this.storeActions.project_getActive()) {
                return 'active_project';
            }
            if (requirement === 'datasets_selected' && this.storeActions.datasets_getSelected().length === 0) {
                return 'datasets_selected';
            }
        }
        return null;
    }

    // ─── Script Discovery ─────────────────────────────────────────────────

    /**
     * Build an actionable script-not-found message with typo suggestions.
     */
    private scriptNotFound_message(ref: string): string {
        const lines: string[] = [`>> ERROR: SCRIPT NOT FOUND: ${ref}`];
        const suggestions: string[] = this.scriptSuggestions_resolve(ref);

        if (suggestions.length > 0) {
            lines.push(`○ DID YOU MEAN: ${suggestions.map((name: string): string => `[${name}]`).join(', ')} ?`);
            lines.push(`Use: /run [${suggestions[0]}]`);
            return lines.join('\n');
        }

        lines.push('Use /scripts to list available scripts.');
        return lines.join('\n');
    }

    /**
     * Resolve nearest script candidates by normalized edit distance.
     */
    private scriptSuggestions_resolve(ref: string): string[] {
        const query: string = ref.trim().toLowerCase().replace(/\.clpso$/i, '');
        if (!query) return [];

        const ranked: ScriptSuggestionScore[] = [];

        for (const script of scripts_list()) {
            let bestScore: number = Number.POSITIVE_INFINITY;
            const refs: string[] = [script.id, ...script.aliases];

            for (const candidateRaw of refs) {
                const candidate: string = candidateRaw.toLowerCase();
                const distance: number = this.distance_levenshtein(query, candidate);
                const containsBoosted: number =
                    candidate.includes(query) || query.includes(candidate) ? Math.max(0, distance - 1) : distance;
                if (containsBoosted < bestScore) bestScore = containsBoosted;
            }

            ranked.push({ id: script.id, score: bestScore });
        }

        ranked.sort((a, b): number => (a.score - b.score) || a.id.localeCompare(b.id));
        const threshold: number = Math.max(2, Math.floor(query.length * 0.35));

        return ranked
            .filter((entry): boolean => entry.score <= threshold)
            .slice(0, 3)
            .map((entry): string => entry.id);
    }

    /**
     * Levenshtein edit distance.
     */
    private distance_levenshtein(a: string, b: string): number {
        if (a === b) return 0;
        if (!a.length) return b.length;
        if (!b.length) return a.length;

        const prev: number[] = Array.from({ length: b.length + 1 }, (_, i: number): number => i);
        const curr: number[] = new Array<number>(b.length + 1);

        for (let i: number = 1; i <= a.length; i++) {
            curr[0] = i;
            for (let j: number = 1; j <= b.length; j++) {
                const cost: number = a[i - 1] === b[j - 1] ? 0 : 1;
                curr[j] = Math.min(
                    curr[j - 1] + 1,
                    prev[j] + 1,
                    prev[j - 1] + cost
                );
            }
            for (let j: number = 0; j <= b.length; j++) {
                prev[j] = curr[j];
            }
        }

        return prev[b.length];
    }

    // ─── Helpers ──────────────────────────────────────────────────────────

    /**
     * Summarize a command response for per-step script output.
     */
    private scriptStep_summary(message: string): string | null {
        if (!message) return null;

        if (message === '__HARMONIZE_ANIMATE__') {
            return 'COHORT HARMONIZATION COMPLETE';
        }

        const cleanedLines: string[] = message
            .split('\n')
            .map((line: string): string => line.replace(/<[^>]+>/g, '').trim())
            .filter((line: string): boolean => line.length > 0);

        if (cleanedLines.length === 0) return null;
        return cleanedLines[0];
    }

    private response_create(
        message: string,
        actions: CalypsoAction[],
        success: boolean
    ): CalypsoResponse {
        return { 
            message, 
            actions, 
            success, 
            statusCode: success ? CalypsoStatusCode.OK : CalypsoStatusCode.ERROR 
        };
    }
}
