/**
 * @file FedML Workflow Definition
 *
 * Declarative workflow for federated machine learning developers.
 * Defines the SeaGaP-MP pipeline from dataset discovery through federation dispatch.
 *
 * @module
 * @see docs/persona-workflows.adoc
 */

import type { WorkflowDefinition } from '../types.js';

/**
 * Federated ML Workflow Definition.
 *
 * Stages: gather → harmonize → code → train → federate
 */
export const FEDML_WORKFLOW: WorkflowDefinition = {
    name: 'Federated ML Workflow',
    id: 'fedml',
    persona: 'fedml',
    description: `Full SeaGaP-MP pipeline for federated learning on medical imaging.
Guides the user from dataset discovery through federation dispatch.`,

    stages: [
        {
            id: 'gather',
            name: 'Cohort Assembly',
            intents: ['SEARCH', 'ADD', 'GATHER'],
            requires: [],
            validation: {
                condition: 'store.selectedDatasets.length > 0',
                error_message: 'No datasets in cohort.'
            },
            skip_warning: null
        },
        {
            id: 'harmonize',
            name: 'Data Harmonization',
            intents: ['HARMONIZE'],
            requires: ['gather'],
            validation: {
                condition: "vfs.exists('${project}/input/.harmonized')",
                error_message: 'Cohort not harmonized.'
            },
            skip_warning: {
                short: 'Cohort not harmonized.',
                reason: `Federated learning requires consistent data formats across sites.
Without harmonization, your model may fail on heterogeneous inputs
(different resolutions, naming conventions, or label schemas).

Harmonization applies:
- Image resampling to consistent resolution
- Filename normalization
- Label schema alignment
- Metadata standardization`,
                suggestion: "Run 'harmonize' to standardize your cohort.",
                max_warnings: 2
            }
        },
        {
            id: 'code',
            name: 'Code Development',
            intents: ['PROCEED', 'CODE'],
            requires: ['harmonize'],
            validation: {
                condition: "vfs.exists('${project}/src/train.py')",
                error_message: 'No training code scaffolded.'
            },
            skip_warning: {
                short: 'Project structure not scaffolded.',
                reason: `The FedML workflow requires a train.py with Flower client hooks
and a properly configured Dockerfile for containerization.

Scaffolding generates:
- src/train.py (with Flower client wrapper)
- src/Dockerfile (MERIDIAN-compatible)
- src/manifest.json (ChRIS plugin metadata)`,
                suggestion: "Run 'proceed' or 'code' to generate the project structure.",
                max_warnings: 2
            }
        },
        {
            id: 'train',
            name: 'Local Validation',
            intents: ['TRAIN', 'PYTHON'],
            requires: ['code'],
            validation: {
                condition: "vfs.exists('${project}/.local_pass')",
                error_message: 'Local training not validated.'
            },
            skip_warning: {
                short: 'Local training not validated.',
                reason: `Federation distributes your code to remote sites where debugging
is difficult or impossible. Running locally first catches:
- Import errors and missing dependencies
- Data loading issues
- Model architecture problems
- Memory and resource constraints

A successful local run creates a .local_pass marker.`,
                suggestion: "Run 'python train.py' to validate locally.",
                max_warnings: 2
            }
        },
        {
            id: 'federate',
            name: 'Federation Dispatch',
            intents: ['FEDERATE'],
            requires: ['train'],
            validation: {
                condition: 'true',
                error_message: ''
            },
            skip_warning: null
        }
    ]
};
