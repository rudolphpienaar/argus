#!/usr/bin/env node

/**
 * @file Oracle Runner v12.0
 * 
 * The reflexive verification engine for ARGUS.
 * Supports offline deterministic logic checks and live AI drift measurement.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const verbose = process.argv.includes('--verbose');
const online  = process.argv.includes('--online');
const legacy  = process.argv.includes('--legacy');

// Resolve CNS Mode from CLI flags
let mode = 'strict';
if (process.argv.includes('--mode')) {
    const idx = process.argv.indexOf('--mode');
    if (idx + 1 < process.argv.length) {
        mode = process.argv[idx + 1];
    }
}

// Oracle is a deterministic logic/materialization verifier, not a latency benchmark.
// Force plugin fast mode so simulated plugin delays never trip execution watchdogs.
process.env.CALYPSO_FAST = 'true';

/**
 * Strip ANSI escape codes from a string.
 */
function ansi_strip(str) {
    // eslint-disable-next-line no-control-regex
    return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

/**
 * Replace known template variables in step text.
 */
function template_interpolate(value, vars) {
    const sessionRoot = `/home/${vars.user}/projects/${vars.persona}/${vars.sessionId}`;
    const provenanceRoot = `${sessionRoot}/provenance`;

    return value
        .replaceAll('${user}', vars.user)
        .replaceAll('${persona}', vars.persona)
        .replaceAll('${project}', sessionRoot)
        .replaceAll('${session}', provenanceRoot);
}

/**
 * Resolve candidate materialization paths for backward compatibility.
 */
function materializedPath_candidates(path) {
    const candidates = [path];
    if (path.includes('/data/')) {
        candidates.push(path.replace('/data/', '/output/'));
        candidates.push(path.replace('/data/', '/meta/'));
    }
    return Array.from(new Set(candidates));
}

/**
 * Load oracle scenario files.
 *
 * Recursively discovers all *.oracle.json files under tests/oracle/.
 * - Directories named 'legacy'  are skipped unless --legacy is passed.
 * - Directories named 'online'  are skipped unless --online is passed.
 *
 * The returned `file` field is relative to tests/oracle/ so scenario
 * names remain unambiguous across subdirectory trees.
 */
function scenarios_load() {
    const root = path.join(ROOT, 'tests', 'oracle');

    function walk(dir) {
        let results = [];
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'legacy' && !legacy) continue;
                if (entry.name === 'online' && !online) continue;
                results = results.concat(walk(fullPath));
            } else if (entry.isFile() && entry.name.endsWith('.oracle.json')) {
                results.push(fullPath);
            }
        }
        return results;
    }

    return walk(root).sort().map((fullPath) => {
        const raw = readFileSync(fullPath, 'utf-8');
        return { file: path.relative(root, fullPath), data: JSON.parse(raw) };
    });
}

/**
 * Load compiled runtime modules from dist/js.
 */
async function modules_load() {
    const distRoot = path.join(ROOT, 'dist', 'js');
    const mod = async (rel) => {
        const url = pathToFileURL(path.join(distRoot, rel)).href;
        return import(url);
    };

    const [
        calypsoMod,
        vfsMod,
        shellMod,
        registryMod,
        templatesMod,
        providerMod,
        storeMod,
        datasetsMod
    ] = await Promise.all([
        mod('lcarslm/CalypsoCore.js'),
        mod('vfs/VirtualFileSystem.js'),
        mod('vfs/Shell.js'),
        mod('vfs/content/ContentRegistry.js'),
        mod('vfs/content/templates/index.js'),
        mod('vfs/providers/ProjectProvider.js'),
        mod('core/state/store.js'),
        mod('core/data/datasets.js')
    ]);

    return {
        CalypsoCore: calypsoMod.CalypsoCore,
        VirtualFileSystem: vfsMod.VirtualFileSystem,
        Shell: shellMod.Shell,
        ContentRegistry: registryMod.ContentRegistry,
        ALL_GENERATORS: templatesMod.ALL_GENERATORS,
        homeDir_scaffold: providerMod.homeDir_scaffold,
        store: storeMod.store,
        DATASETS: datasetsMod.DATASETS
    };
}

/**
 * Build a fresh in-process CalypsoCore runtime for one scenario.
 */
function runtime_create(modules, username, persona = 'fedml') {
    const vfs = new modules.VirtualFileSystem(username);
    modules.store.globalVcs_set(vfs);

    const registry = new modules.ContentRegistry();
    registry.generators_registerAll(modules.ALL_GENERATORS);
    registry.vfs_connect(vfs);

    const shell = new modules.Shell(vfs, username);
    modules.store.globalShell_set(shell);
    modules.homeDir_scaffold(vfs, username);

    shell.env_set('USER', username);
    shell.env_set('HOME', `/home/${username}`);
    shell.env_set('STAGE', 'search');
    shell.env_set('PERSONA', persona);
    shell.env_set('PS1', '$USER@CALYPSO:[$PWD]> ');

    modules.store.selection_clear();
    modules.store.project_unload();
    modules.store.persona_set(persona);
    modules.store.stage_set('search');

    const storeAdapter = {
        sessionPath: null,
        state_get() {
            return {
                currentPersona: modules.store.state.currentPersona,
                currentSessionId: modules.store.state.currentSessionId,
                currentStage: modules.store.state.currentStage,
                selectedDatasets: [...modules.store.state.selectedDatasets],
                activeProject: modules.store.state.activeProject,
                marketplaceOpen: modules.store.state.marketplaceOpen,
                installedAssets: [...modules.store.state.installedAssets],
                lastIntent: modules.store.state.lastIntent
            };
        },
        state_set(newState) {
            modules.store.state_patch(newState);
        },
        reset() {
            modules.store.selection_clear();
            modules.store.project_unload();
            modules.store.stage_set('search');
        },
        dataset_select(dataset) {
            modules.store.dataset_select(dataset);
        },
        dataset_deselect(id) {
            modules.store.dataset_deselect(id);
        },
        dataset_getById(id) {
            return modules.store.state.selectedDatasets.find(ds => ds.id === id) || 
                   modules.DATASETS?.find(ds => ds.id === id);
        },
        datasets_getSelected() {
            return modules.store.state.selectedDatasets;
        },
        project_getActive() {
            return modules.store.state.activeProject;
        },
        project_getActiveFull() {
            return modules.store.state.activeProject;
        },
        project_setActive(project) {
            modules.store.project_load(project);
        },
        stage_set(stage) {
            modules.store.stage_set(stage);
        },
        session_getPath() {
            return this.sessionPath;
        },
        session_setPath(path) {
            this.sessionPath = path;
        },
        sessionId_get() {
            return modules.store.sessionId_get();
        },
        session_start() {
            modules.store.session_start();
        },
        lastMentioned_set(datasets) {
            modules.store.lastMentioned_set(datasets);
        },
        lastMentioned_get() {
            return modules.store.lastMentioned_get();
        }
    };

    // v12.0: Inject AI credentials if online mode requested
    let llmConfig = undefined;
    if (online) {
        let apiKey = process.env.ARGUS_API_KEY;
        const keyFile = path.join(ROOT, 'gemini.key');
        
        // Auto-load from gemini.key if available
        if (!apiKey && existsSync(keyFile)) {
            apiKey = readFileSync(keyFile, 'utf-8').trim();
        }

        const provider = process.env.ARGUS_PROVIDER || 'gemini';
        const model = process.env.ARGUS_MODEL || (provider === 'openai' ? 'gpt-4o' : 'gemini-flash-latest');
        
        if (!apiKey) {
            console.warn('>> WARNING: --online requested but ARGUS_API_KEY or gemini.key missing. Running OFFLINE.');
        } else {
            llmConfig = { apiKey, provider, model };
        }
    }

    const core = new modules.CalypsoCore(vfs, shell, storeAdapter, {
        workflowId: persona === 'appdev' ? 'chris' : persona,
        llmConfig,
        mode, // v12.0: CNS mode (strict, experimental, null_hypothesis)
        knowledge: {}
    });

    storeAdapter.sessionPath = core.session_getPath();

    return { core, store: modules.store };
}

/**
 * Execute one oracle scenario.
 */
async function scenario_run(modules, scenario) {
    const name = scenario.data.name || scenario.file;
    const username = scenario.data.username || 'oracle';
    const persona = scenario.data.persona || 'fedml';
    const steps = Array.isArray(scenario.data.steps) ? scenario.data.steps : [];
    
    const runtime = runtime_create(modules, username, persona);
    
    // v12.0: Explicitly await boot sequence
    await runtime.core.boot();
    await runtime.core.workflow_set(persona === 'appdev' ? 'chris' : persona);

    const state = runtime.core.store_snapshot();
    const vars = { 
        user: username, 
        persona: persona,
        sessionId: state.currentSessionId, 
        project: 'DRAFT' 
    };

    console.log(`\n[ORACLE] ${name} (Mode: ${mode.toUpperCase()})`);

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const label = `[STEP ${i + 1}/${steps.length}]`;

        if (step.send) {
            const command = template_interpolate(step.send, vars);
            console.log(`${label} SEND: ${command}`);
            
            // v12.0: Strictly await execution and measure latency
            const startTime = performance.now();
            const response = await runtime.core.command_execute(command);
            const endTime = performance.now();
            const latency = Math.round(endTime - startTime);

            let activeResponse = response;
            let fullMessage = response.message;
            
            if (verbose || latency > 500) {
                const speed = latency > 2000 ? '🔴 SLOW' : (latency > 500 ? '🟡 LAG' : '🟢 FAST');
                console.log(`         LATENCY: ${latency}ms [${speed}]`);
            }
            
            // Handle automatic phase jump confirmation
            const strippedMsg = ansi_strip(activeResponse.message);
            if (!activeResponse.success && /PHASE JUMP/i.test(strippedMsg)) {
                console.log(`${label}   [SYSTEM] Phase jump detected. Sending confirmation...`);
                activeResponse = await runtime.core.command_execute('confirm');
                fullMessage += '\n' + activeResponse.message;
            }

            // Re-fetch session and project
            const currentState = runtime.core.store_snapshot();
            if (currentState?.activeProject?.name) vars.project = currentState.activeProject.name;
            if (currentState?.currentSessionId) vars.sessionId = currentState.currentSessionId;

            if (verbose) {
                console.log(`${label} Response: ${activeResponse.statusCode}`);
                if (activeResponse.message) {
                    console.log(`         MESSAGE: ${activeResponse.message}`);
                }
            }

            // v12.0: Interpretation Path Assertion
            if (typeof step.expect_model_resolved === 'boolean') {
                const intent = activeResponse.state?.intent;
                if (intent && intent.isModelResolved !== step.expect_model_resolved) {
                    console.log(`         ERROR: Interpretation path mismatch!`);
                    console.log(`         Expected isModelResolved=${step.expect_model_resolved} but got ${intent.isModelResolved}`);
                    throw new Error(`${label} Architectural Integrity Failure: Probabilistic drift detected in deterministic path.`);
                }
            }

            // Standard assertions
            if (step.expect && activeResponse.statusCode !== step.expect) {
                console.log(`         ERROR: Expected statusCode=${step.expect} but got ${activeResponse.statusCode}`);
                console.log(`         MESSAGE: ${activeResponse.message}`);
                
                if (activeResponse.statusCode === 'BLOCKED_MISSING') {
                    const snap = runtime.core.vfs_snapshot('/', true);
                    console.log(`         VFS SNAPSHOT:\n${JSON.stringify(snap, null, 2)}`);
                }
                
                throw new Error(`${label} Expected statusCode=${step.expect} but got ${activeResponse.statusCode}`);
            }

            if (typeof step.success === 'boolean') {
                const normalizedSuccess = activeResponse.success || activeResponse.statusCode === 'CONVERSATIONAL';
                if (normalizedSuccess !== step.success) {
                    console.log(`         ERROR: Expected success=${step.success} but got ${activeResponse.success}`);
                    throw new Error(`${label} Expected success=${step.success} but got ${activeResponse.success}`);
                }
            }

            // Reflexive verification
            if (activeResponse.statusCode === 'OK') {
                const pos = runtime.core.workflow_getPosition();
                const completedId = pos.completedStages[pos.completedStages.length - 1];
                if (completedId) {
                    const artifact = runtime.core.merkleEngine_latestFingerprint_get(completedId);
                    if (artifact && artifact.materialized) {
                        const dataDir = await runtime.core.merkleEngine_dataDir_resolve(completedId);
                        for (const relPath of artifact.materialized) {
                            const fullPath = `${dataDir}/output/${relPath}`;
                            const rootPath = `${dataDir}/${relPath}`;
                            const metaPath = `${dataDir}/meta/${relPath}`;
                            
                            if (!runtime.core.vfs_exists(fullPath) && 
                                !runtime.core.vfs_exists(rootPath) && 
                                !runtime.core.vfs_exists(metaPath)) {
                                throw new Error(`${label} Reflexive verification failed: ${relPath} missing (tried ${fullPath}, ${rootPath}, and ${metaPath}).`);
                            }
                        }
                    }
                }
            }

            if (step.materialized) {
                for (const rawPath of step.materialized) {
                    const target = template_interpolate(rawPath, vars);
                    const candidatePaths = materializedPath_candidates(target);
                    const resolvedTarget = candidatePaths.find((path) => runtime.core.vfs_exists(path)) || null;
                    if (!resolvedTarget) {
                        throw new Error(`${label} Materialized artifact missing: ${target}`);
                    }
                }
            }

            if (step.output_contains) {
                const required = Array.isArray(step.output_contains) ? step.output_contains : [step.output_contains];
                const msg = ansi_strip(String(fullMessage || '')).toLowerCase();
                for (const token of required) {
                    if (!msg.includes(token.toLowerCase())) {
                        throw new Error(`${label} Missing output token: "${token}"`);
                    }
                }
            }
        }

        if (step.vfs_exists) {
            const target = template_interpolate(step.vfs_exists, vars);
            if (!materializedPath_candidates(target).some((path) => runtime.core.vfs_exists(path))) {
                throw new Error(`${label} VFS path missing: ${target}`);
            }
        }
    }

    console.log(`[PASS] ${name}`);
}

async function main() {
    const scenarios = scenarios_load();
    if (scenarios.length === 0) {
        throw new Error('No oracle scenarios found.');
    }

    const modules = await modules_load();
    console.log(`\n[ORACLE v12.0] INITIALIZING INTEGRITY WALK`);
    console.log(`○ Mode: ${mode.toUpperCase()}`);
    console.log(`○ Online: ${online ? 'ENABLED' : 'DISABLED'}`);

    for (const scenario of scenarios) {
        // v12.0: Strictly sequential execution to prevent telemetry bleeding
        await scenario_run(modules, scenario);
    }
    console.log(`\n[ORACLE] ${scenarios.length} scenario(s) passed`);
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n[ORACLE] FAILED: ${message}`);
    process.exit(1);
});
