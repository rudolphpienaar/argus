#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const verbose = process.argv.includes('--verbose');

/**
 * Replace known template variables in step text.
 *
 * @param {string} value
 * @param {{ user: string, project: string|null, session: string|null }} vars
 * @returns {string}
 */
function interpolate(value, vars) {
    return value
        .replaceAll('${user}', vars.user)
        .replaceAll('${project}', vars.project || '')
        .replaceAll('${session}', vars.session || '');
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
 *   store: any,
 *   globals: any
 * }>}
 */
async function modules_load() {
    const distRoot = path.join(ROOT, 'dist', 'js');
    const mod = async (rel) => import(pathToFileURL(path.join(distRoot, rel)).href);

    const [
        calypsoMod,
        vfsMod,
        shellMod,
        registryMod,
        templatesMod,
        providerMod,
        storeMod
    ] = await Promise.all([
        mod('lcarslm/CalypsoCore.js'),
        mod('vfs/VirtualFileSystem.js'),
        mod('vfs/Shell.js'),
        mod('vfs/content/ContentRegistry.js'),
        mod('vfs/content/templates/index.js'),
        mod('vfs/providers/ProjectProvider.js'),
        mod('core/state/store.js')
    ]);

    return {
        CalypsoCore: calypsoMod.CalypsoCore,
        VirtualFileSystem: vfsMod.VirtualFileSystem,
        Shell: shellMod.Shell,
        ContentRegistry: registryMod.ContentRegistry,
        ALL_GENERATORS: templatesMod.ALL_GENERATORS,
        homeDir_scaffold: providerMod.homeDir_scaffold,
        store: storeMod.store,
        globals: storeMod.globals
    };
}

/**
 * Build a fresh in-process CalypsoCore runtime for one scenario.
 *
 * @param {any} modules
 * @param {string} username
 * @returns {{ core: any, store: any }}
 */
function runtime_create(modules, username) {
    const vfs = new modules.VirtualFileSystem(username);
    modules.globals.vcs = vfs;

    const registry = new modules.ContentRegistry();
    registry.generators_registerAll(modules.ALL_GENERATORS);
    registry.vfs_connect(vfs);

    const shell = new modules.Shell(vfs, username);
    modules.globals.shell = shell;
    modules.homeDir_scaffold(vfs, username);

    shell.env_set('USER', username);
    shell.env_set('HOME', `/home/${username}`);
    shell.env_set('STAGE', 'search');
    shell.env_set('PERSONA', 'fedml');
    shell.env_set('PS1', '$USER@CALYPSO:[$PWD]> ');

    modules.store.selection_clear();
    modules.store.project_unload();
    modules.store.stage_set('search');

    const storeAdapter = {
        state_get() {
            return {
                currentStage: modules.store.state.currentStage,
                selectedDatasets: [...modules.store.state.selectedDatasets],
                activeProject: modules.store.state.activeProject,
                marketplaceOpen: modules.store.state.marketplaceOpen,
                installedAssets: [...modules.store.state.installedAssets]
            };
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
        datasets_getSelected() {
            return modules.store.state.selectedDatasets;
        },
        project_getActive() {
            return modules.store.state.activeProject;
        },
        stage_set(stage) {
            modules.store.stage_set(stage);
        }
    };

    const core = new modules.CalypsoCore(vfs, shell, storeAdapter, {
        simulationMode: true
    });

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
    const steps = Array.isArray(scenario.data.steps) ? scenario.data.steps : [];
    const vars = { user: username, project: null, session: null };
    const runtime = runtime_create(modules, username);
    vars.session = runtime.core.session_getPath();

    console.log(`\n[ORACLE] ${name}`);

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const label = `[STEP ${i + 1}/${steps.length}]`;

        if (step.send) {
            const command = interpolate(step.send, vars);
            const response = await runtime.core.command_execute(command);
            if (verbose) {
                console.log(`${label} ${command}`);
                console.log(`         success=${response.success}`);
            }

            if (typeof step.success === 'boolean' && response.success !== step.success) {
                throw new Error(`${label} Expected success=${step.success} but got ${response.success}`);
            }

            if (step.output_contains) {
                const required = Array.isArray(step.output_contains)
                    ? step.output_contains
                    : [step.output_contains];
                for (const token of required) {
                    if (!String(response.message || '').includes(token)) {
                        throw new Error(`${label} Missing output token: "${token}"`);
                    }
                }
            }

            if (step.capture_project === true) {
                const state = runtime.core.store_snapshot();
                const projectName = state?.activeProject?.name || null;
                if (!projectName) {
                    throw new Error(`${label} capture_project requested but no active project found`);
                }
                vars.project = projectName;
            }
        }

        if (step.vfs_exists) {
            const target = interpolate(step.vfs_exists, vars);
            const exists = runtime.core.vfs_exists(target);
            if (!exists) {
                throw new Error(`${label} Expected VFS path missing: ${target}`);
            }
            if (verbose) {
                console.log(`${label} exists ${target}`);
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

