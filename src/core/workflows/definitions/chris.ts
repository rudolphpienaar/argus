/**
 * @file ChRIS Plugin Workflow Definition
 *
 * Declarative workflow for ChRIS plugin developers.
 * Simpler than FedML — no harmonization or federation steps.
 *
 * @module
 * @see docs/persona-workflows.adoc
 */

import type { WorkflowDefinition } from '../types.js';

/**
 * ChRIS Plugin Workflow Definition.
 *
 * Stages: gather → code → test → publish
 */
export const CHRIS_WORKFLOW: WorkflowDefinition = {
    name: 'ChRIS Plugin Workflow',
    id: 'chris',
    persona: 'appdev',
    description: `Pipeline for building and deploying ChRIS plugins.
Simpler than FedML — no harmonization or federation steps.`,

    stages: [
        {
            id: 'gather',
            name: 'Test Data Assembly',
            intents: ['SEARCH', 'ADD', 'GATHER'],
            requires: [],
            validation: {
                condition: 'store.selectedDatasets.length > 0',
                error_message: 'No test datasets selected.'
            },
            skip_warning: null
        },
        {
            id: 'code',
            name: 'Plugin Development',
            intents: ['PROCEED', 'CODE'],
            requires: ['gather'],
            validation: {
                condition: "vfs.exists('${project}/src/main.py')",
                error_message: 'Plugin structure not scaffolded.'
            },
            skip_warning: {
                short: 'Plugin structure not scaffolded.',
                reason: `ChRIS plugins require a specific directory structure with
main.py, Dockerfile, and chris_plugin_info.json.

The scaffolding generates:
- src/main.py (argument parsing template)
- src/Dockerfile (ChRIS-compatible base image)
- src/chris_plugin_info.json (plugin metadata)`,
                suggestion: "Run 'proceed chris' to scaffold the plugin.",
                max_warnings: 2
            }
        },
        {
            id: 'test',
            name: 'Local Testing',
            intents: ['TEST', 'PYTHON'],
            requires: ['code'],
            validation: {
                condition: "vfs.exists('${project}/.test_pass')",
                error_message: 'Plugin not tested locally.'
            },
            skip_warning: {
                short: 'Plugin not tested locally.',
                reason: `ChRIS plugins run in isolated containers. Local testing
verifies argument parsing, file I/O, and error handling
before deployment.

Testing catches:
- Missing required arguments
- Incorrect file path handling
- Unhandled exceptions`,
                suggestion: "Run 'python main.py --help' to verify the plugin.",
                max_warnings: 2
            }
        },
        {
            id: 'publish',
            name: 'Plugin Publication',
            intents: ['PUBLISH', 'DEPLOY'],
            requires: ['test'],
            validation: {
                condition: 'true',
                error_message: ''
            },
            skip_warning: null
        }
    ]
};
