/**
 * @file Template Index — Registers All Content Generators
 *
 * Barrel module that collects all template generators and provides
 * a single array for bulk registration with a ContentRegistry.
 *
 * @module
 */

import type { ContentGenerator } from '../../types.js';
import { trainGenerator } from './train.js';
import { readmeGenerator } from './readme.js';
import { configGenerator } from './config.js';
import { requirementsGenerator } from './requirements.js';
import { manifestGenerator } from './manifest.js';
import { catalogDatasetsGenerator, catalogModelsGenerator } from './catalog.js';
import { nodeRegistryGenerator } from './nodeRegistry.js';
import { argusConfigGenerator } from './argusConfig.js';
import {
    pluginExecutableGenerator,
    datasetManifestGenerator,
    modelReadmeGenerator,
    annotationManifestGenerator,
    workflowManifestGenerator,
    cohortManifestGenerator
} from './assetManifest.js';
import {
    dataImageGenerator,
    dataMaskGenerator,
    dataMetadataGenerator,
    dataAnnotationsGenerator,
    dataLabelsGenerator
} from './dataContent.js';
import { chrisAppGenerator } from './chrisapp/chrisApp.js';
import { fedmlAppGenerator } from './chrisapp/fedmlApp.js';
import { chrisSetupGenerator } from './chrisapp/chrisSetup.js';
import { chrisDockerfileGenerator } from './chrisapp/chrisDockerfile.js';
import { chrisRequirementsGenerator } from './chrisapp/chrisRequirements.js';
import { chrisReadmeGenerator } from './chrisapp/chrisReadme.js';

/**
 * All registered content generators as [key, generator] tuples.
 * Keys must match the `contentGenerator` field on FileNode instances.
 */
export const ALL_GENERATORS: Array<[string, ContentGenerator]> = [
    // Project templates
    ['train', trainGenerator],
    ['readme', readmeGenerator],
    ['config', configGenerator],
    ['requirements', requirementsGenerator],
    ['manifest', manifestGenerator],

    // ChRIS App templates
    ['chris-app-py', chrisAppGenerator],
    ['fedml-app-py', fedmlAppGenerator],
    ['chris-setup-py', chrisSetupGenerator],
    ['chris-dockerfile', chrisDockerfileGenerator],
    ['chris-requirements', chrisRequirementsGenerator],
    ['chris-readme', chrisReadmeGenerator],

    // System catalogs
    ['catalog-datasets', catalogDatasetsGenerator],
    ['catalog-models', catalogModelsGenerator],
    ['node-registry', nodeRegistryGenerator],

    // Configuration
    ['argus-config', argusConfigGenerator],

    // Marketplace asset manifests
    ['plugin-executable', pluginExecutableGenerator],
    ['dataset-manifest', datasetManifestGenerator],
    ['model-readme', modelReadmeGenerator],
    ['annotation-manifest', annotationManifestGenerator],
    ['workflow-manifest', workflowManifestGenerator],
    ['cohort-manifest', cohortManifestGenerator],

    // Data content (cohort tree files)
    ['data-image', dataImageGenerator],
    ['data-mask', dataMaskGenerator],
    ['data-metadata', dataMetadataGenerator],
    ['data-annotations', dataAnnotationsGenerator],
    ['data-labels', dataLabelsGenerator]
];
