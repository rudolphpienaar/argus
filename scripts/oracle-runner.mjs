#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const verbose = process.argv.includes('--verbose');

// Oracle is a deterministic logic/materialization verifier, not a latency benchmark.
// Force plugin fast mode so simulated plugin delays never trip execution watchdogs.
process.env.CALYPSO_FAST = 'true';

/**
 * Strip ANSI escape codes from a string.
 * @param {string} str
 * @returns {string}
 */
function ansi_strip(str) {
    // eslint-disable-next-line no-control-regex
    return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

/**
 * Replace known template variables in step text.
 *
 * @param {string} value
 * @param {{ user: string, persona: string, sessionId: string|null, project: string|null }} vars
 * @returns {string}
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
 *
 * Legacy oracle specs used '/data/' while runtime now materializes to
 * '/output/' (payloads) and '/meta/' (stage artifact envelopes).
 *
 * @param {string} path
 * @returns {string[]}
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
 * @returns {Array<{ file: string, data: any }>}
 */
function scenarios_load() {
    const dir = path.join(ROOT, 'tests', 'oracle');
    const files = readdirSync(dir)
        .filter((name) => name.endsWith('.oracle.json'))
        .sort();

    return files.map((file) => {
        const fullPath = path.join(dir, file);
        const raw = readFileSync(fullPath, 'utf-8');
        return { file, data: JSON.parse(raw) };
    });
}

/**
 * Load compiled runtime modules from dist/js.
 *
 * @returns {Promise<{
 *   CalypsoCore: any,
 *   VirtualFileSystem: any,
 *   Shell: any,
 *   ContentRegistry: any,
 *   ALL_GENERATORS: Array<[string, any]>,
 *   homeDir_scaffold: Function,
 *   store: any
 * }>}
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
 *
 * @param {any} modules
 * @param {string} username
 * @param {string} persona
 * @returns {{ core: any, store: any }}
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
    modules.store.persona_set(persona); // v11.0: Triggers session_start
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

    const core = new modules.CalypsoCore(vfs, shell, storeAdapter, {
        workflowId: persona === 'appdev' ? 'chris' : persona,
        knowledge: {}
    });

    storeAdapter.sessionPath = core.session_getPath();

    return { core, store: modules.store };
}

/**
 * Execute one oracle scenario.
 *
 * @param {any} modules
 * @param {{ file: string, data: any }} scenario
 * @returns {Promise<void>}
 */
async function scenario_run(modules, scenario) {
    const name = scenario.data.name || scenario.file;
    const username = scenario.data.username || 'oracle';
    const persona = scenario.data.persona || 'fedml';
    const steps = Array.isArray(scenario.data.steps) ? scenario.data.steps : [];
    
    const runtime = runtime_create(modules, username, persona);
    const state = runtime.core.store_snapshot();
    
    const vars = { 
        user: username, 
        persona: persona,
        sessionId: state.currentSessionId, 
        project: 'DRAFT' 
    };

    console.log(`\n[ORACLE] ${name}`);

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const label = `[STEP ${i + 1}/${steps.length}]`;

        if (step.send) {
            const command = template_interpolate(step.send, vars);
            console.log(`${label} SEND: ${command}`);
            let response = await runtime.core.command_execute(command);
            let fullMessage = response.message;
            
            // Handle automatic phase jump confirmation
            const strippedMsg = ansi_strip(response.message);
            if (!response.success && /PHASE JUMP/i.test(strippedMsg)) {
                console.log(`${label}   [SYSTEM] Phase jump detected. Sending confirmation...`);
                response = await runtime.core.command_execute('confirm');
                fullMessage += '\n' + response.message;
            }

            // Re-fetch session and project in case of /reset or project initialization
            const state = runtime.core.store_snapshot();
            if (state?.activeProject?.name) {
                vars.project = state.activeProject.name;
            }
            if (state?.currentSessionId) {
                vars.sessionId = state.currentSessionId;
            }

            if (verbose) {
                console.log(`${label} ${command}`);
                console.log(`         success=${response.success}`);
            }

            // Final evaluation based on the last response received
            if (step.expect && response.statusCode !== step.expect) {
                console.log(`         ERROR: Expected statusCode=${step.expect} but got ${response.statusCode}`);
                console.log(`         MESSAGE: ${response.message}`);
                throw new Error(`${label} Expected statusCode=${step.expect} but got ${response.statusCode}`);
            }

            if (typeof step.success === 'boolean') {
                const normalizedSuccess = response.success || response.statusCode === 'CONVERSATIONAL';
                if (normalizedSuccess !== step.success) {
                if (!verbose) {
                    console.log(`${label} ${command}`);
                }
                console.log(`         ERROR: Expected success=${step.success} but got ${response.success}`);
                console.log(`         MESSAGE: ${response.message}`);
                throw new Error(`${label} Expected success=${step.success} but got ${response.success}`);
                }
            }

            // v10.2: Reflexive Side-Effect Verification
            // If the command was a workflow step, check its self-reported materialized files
            if (response.statusCode === 'OK') {
                const pos = runtime.core.workflow_getPosition();
                // Check the stage that just COMPLETED (not the 'current' next stage)
                const completedId = pos.completedStages[pos.completedStages.length - 1];
                if (completedId) {
                    const artifact = runtime.core.merkleEngine_latestFingerprint_get(completedId);
                    if (artifact && artifact.materialized) {
                        // Resolve the physical stage data directory from the Merkle engine.
                        let dataDir = null;
                        try {
                            dataDir = await runtime.core.merkleEngine_dataDir_resolve(completedId);
                        } catch {
                            const artPath = artifact._physical_path || '';
                            const metaDir = artPath.substring(0, artPath.lastIndexOf('/'));
                            dataDir = metaDir.endsWith('/meta')
                                ? `${metaDir.slice(0, -'/meta'.length)}/output`
                                : metaDir;
                        }
                        
                        for (const relPath of artifact.materialized) {
                            const fullPath = `${dataDir}/output/${relPath}`;
                            if (verbose) {
                                console.log(`${label} [REFLEXIVE] verifying side-effect: ${fullPath}`);
                            }
                            if (!runtime.core.vfs_exists(fullPath)) {
                                console.log(`${label} [REFLEXIVE] FAILED: Stage [${completedId}] claimed to materialize [${relPath}] but it is missing at [${fullPath}]`);
                                throw new Error(`${label} Reflexive verification failed for ${completedId}`);
                            }
                        }
                    }
                }
            }

            if (step.materialized) {
                for (const rawPath of step.materialized) {
                    // v10.2: Re-interpolate using updated vars and allow legacy path aliases.
                    const target = template_interpolate(rawPath, vars);
                    const candidatePaths = materializedPath_candidates(target);
                    const resolvedTarget = candidatePaths.find((path) => runtime.core.vfs_exists(path)) || null;
                    if (verbose) {
                        console.log(`${label} checking materialization: ${candidatePaths.join(' | ')}`);
                    }
                    if (!resolvedTarget) {
                        if (!verbose) {
                            console.log(`${label} Expected materialized artifact missing: ${target}`);
                            const snap = await runtime.core.command_execute('/snapshot /');
                            if (snap?.message) {
                                console.log(`\n[VFS SNAPSHOT ON FAILURE]:\n${snap.message}\n`);
                            }
                        }
                        throw new Error(`${label} Expected materialized artifact missing: ${target}`);
                    }

                    // v10.2: Concrete Protocol Assertion
                    if (step.args_concrete) {
                        const rawContent = runtime.core.vfs_read(resolvedTarget);
                        if (!rawContent) {
                            throw new Error(`${label} Could not read materialized artifact: ${resolvedTarget}`);
                        }
                        const content = JSON.parse(rawContent);
                        // The Merkle Engine stores the command/args used to generate the artifact
                        const commandStr = (content.command || '').toLowerCase();
                        const args = Array.isArray(content.args) ? content.args.map(a => String(a).toLowerCase()) : [];
                        
                        const forbidden = ['this', 'it', 'them', 'that', 'those', 'all'];
                        const hasAmbiguity = forbidden.some(p => 
                            commandStr.includes(` ${p}`) || commandStr.endsWith(` ${p}`) || args.includes(p)
                        );

                        if (hasAmbiguity) {
                            console.log(`\n[ARCHITECTURAL DRIFT] Ambiguous arguments leaked to Guest plugin!`);
                            console.log(`         Artifact: ${target}`);
                            console.log(`         Command: "${commandStr}"`);
                            console.log(`         Args: ${JSON.stringify(args)}`);
                            throw new Error(`${label} Architectural Integrity Failure: Ambiguous arguments leaked to plugin.`);
                        }
                    }
                }
            }

            if (step.output_contains) {
                const required = Array.isArray(step.output_contains)
                    ? step.output_contains
                    : [step.output_contains];
                const msg = ansi_strip(String(fullMessage || '')).toLowerCase();
                for (const token of required) {
                    if (!msg.includes(token.toLowerCase())) {
                        console.log(`\n[TOKEN FAILURE] Missing "${token}" in message:\n${msg}\n`);
                        throw new Error(`${label} Missing output token: "${token}"`);
                    }
                }
            }

            if (step.capture_project === true) {
                const state = runtime.core.store_snapshot();
                const projectName = state?.activeProject?.name || null;
                if (projectName) {
                    vars.project = projectName;
                }
            }
        }

        if (step.vfs_exists) {
            const target = template_interpolate(step.vfs_exists, vars);
            const candidatePaths = materializedPath_candidates(target);
            const exists = candidatePaths.some((path) => runtime.core.vfs_exists(path));
            if (!exists) {
                throw new Error(`${label} Expected VFS path missing: ${target}`);
            }
            if (verbose) {
                console.log(`${label} exists ${candidatePaths.join(' | ')}`);
            }
        }

        if (step.vfs_stale) {
            const pos = runtime.core.workflow_getPosition();
            const isStale = pos.staleStages.includes(step.vfs_stale);
            
            if (!isStale) {
                throw new Error(`${label} Expected stage to be STALE but it was not: ${step.vfs_stale}`);
            }
            if (verbose) {
                console.log(`${label} stale ${step.vfs_stale}`);
            }
        }
    }

    console.log(`[PASS] ${name}`);
}

async function main() {
    const scenarios = scenarios_load();
    if (scenarios.length === 0) {
        throw new Error('No oracle scenarios found in tests/oracle');
    }

    const modules = await modules_load();
    for (const scenario of scenarios) {
        await scenario_run(modules, scenario);
    }
    console.log(`\n[ORACLE] ${scenarios.length} scenario(s) passed`);
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n[ORACLE] FAILED: ${message}`);
    process.exit(1);
});
