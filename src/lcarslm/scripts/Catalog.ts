/**
 * @file Built-in Calypso script catalog.
 *
 * These scripts are deterministic command bundles that can execute in both
 * embedded ARGUS and headless CLI/server modes.
 *
 * @module
 */

/** Metadata + step sequence for a built-in script. */
export interface CalypsoStructuredStep {
    id: string;
    action: string;
    params: Record<string, unknown>;
    outputs?: {
        alias?: string;
    };
}

export interface CalypsoStructuredScript {
    script: string;
    version: number;
    description?: string;
    defaults?: Record<string, string>;
    steps: CalypsoStructuredStep[];
}

export interface CalypsoScript {
    /** Stable script identifier used by `/run <id>` */
    id: string;
    /** One-line summary shown in `/scripts` */
    description: string;
    /** Optional aliases (e.g., legacy script names) */
    aliases: string[];
    /** Prerequisite keys checked before execution */
    requires: string[];
    /** Suggested target stage */
    target: 'gather' | 'harmonize' | 'code' | 'train' | 'federate';
    /** Deterministic command sequence */
    steps: string[];
    /** Structured script plan used by interactive runtime. */
    structured?: CalypsoStructuredScript;
}

const BUILTIN_SCRIPTS: ReadonlyArray<CalypsoScript> = [
    {
        id: 'harmonize',
        description: 'Generic harmonize path: search -> add -> rename -> harmonize',
        aliases: ['harmonize-fast', 'harmony'],
        requires: [],
        target: 'harmonize',
        steps: [
            'search histology',
            'add ds-006',
            'rename histo-exp1',
            'harmonize'
        ],
        structured: {
            script: 'harmonize',
            version: 1,
            description: 'Search -> select -> add -> rename -> harmonize.',
            defaults: {
                project_name: 'histo-exp1'
            },
            steps: [
                {
                    id: 's1_search',
                    action: 'search',
                    params: {
                        query: 'histology'
                    },
                    outputs: {
                        alias: 'search_results'
                    }
                },
                {
                    id: 's2_select_dataset',
                    action: 'select_dataset',
                    params: {
                        from: '${search_results}',
                        strategy: 'by_id',
                        id: 'ds-006'
                    },
                    outputs: {
                        alias: 'selected_dataset'
                    }
                },
                {
                    id: 's3_add',
                    action: 'add',
                    params: {
                        dataset: '${selected_dataset.id}'
                    }
                },
                {
                    id: 's4_rename',
                    action: 'rename',
                    params: {
                        project: '${answers.project_name ?? defaults.project_name}'
                    }
                },
                {
                    id: 's5_harmonize',
                    action: 'harmonize',
                    params: {}
                }
            ]
        }
    },
    {
        id: 'hist-harmonize',
        description: 'Histology fast path: search -> add -> rename -> harmonize',
        aliases: ['hist_harmonize'],
        requires: [],
        target: 'harmonize',
        steps: [
            'search histology',
            'add ds-006',
            'rename histo-exp1',
            'harmonize'
        ],
        structured: {
            script: 'hist-harmonize',
            version: 1,
            description: 'Histology fast path to harmonized cohort state.',
            defaults: {
                project_name: 'histo-exp1'
            },
            steps: [
                {
                    id: 's1_search',
                    action: 'search',
                    params: {
                        query: 'histology'
                    },
                    outputs: {
                        alias: 'search_results'
                    }
                },
                {
                    id: 's2_select_dataset',
                    action: 'select_dataset',
                    params: {
                        from: '${search_results}',
                        strategy: 'by_id',
                        id: 'ds-006'
                    },
                    outputs: {
                        alias: 'selected_dataset'
                    }
                },
                {
                    id: 's3_add',
                    action: 'add',
                    params: {
                        dataset: '${selected_dataset.id}'
                    }
                },
                {
                    id: 's4_rename',
                    action: 'rename',
                    params: {
                        project: '${defaults.project_name}'
                    }
                },
                {
                    id: 's5_harmonize',
                    action: 'harmonize',
                    params: {}
                }
            ]
        }
    },
    {
        id: 'fedml-quickstart',
        description: 'Histology fast path through local training',
        aliases: ['quickstart', 'fedml_quickstart'],
        requires: [],
        target: 'train',
        steps: [
            'search histology',
            'add ds-006',
            'rename histo-exp1',
            'harmonize',
            'proceed',
            'python train.py'
        ],
        structured: {
            script: 'fedml-quickstart',
            version: 1,
            description: 'Harmonize plus scaffold and local train.',
            defaults: {
                project_name: 'histo-exp1'
            },
            steps: [
                {
                    id: 's1_search',
                    action: 'search',
                    params: {
                        query: 'histology'
                    },
                    outputs: {
                        alias: 'search_results'
                    }
                },
                {
                    id: 's2_select_dataset',
                    action: 'select_dataset',
                    params: {
                        from: '${search_results}',
                        strategy: 'by_id',
                        id: 'ds-006'
                    },
                    outputs: {
                        alias: 'selected_dataset'
                    }
                },
                {
                    id: 's3_add',
                    action: 'add',
                    params: {
                        dataset: '${selected_dataset.id}'
                    }
                },
                {
                    id: 's4_rename',
                    action: 'rename',
                    params: {
                        project: '${answers.project_name ?? defaults.project_name}'
                    }
                },
                {
                    id: 's5_harmonize',
                    action: 'harmonize',
                    params: {}
                },
                {
                    id: 's6_proceed',
                    action: 'proceed',
                    params: {}
                },
                {
                    id: 's7_local_train',
                    action: 'run_python',
                    params: {
                        script: 'train.py'
                    }
                }
            ]
        }
    },
    {
        id: 'fedml-fullrun',
        description: 'Histology fast path through federated dispatch',
        aliases: ['fullrun', 'fedml_fullrun'],
        requires: [],
        target: 'federate',
        steps: [
            'search histology',
            'add ds-006',
            'rename histo-exp1',
            'harmonize',
            'proceed',
            'python train.py',
            'federate',
            'federate --yes',
            'federate --yes',
            'federate --yes',
            'federate --yes'
        ],
        structured: {
            script: 'fedml-fullrun',
            version: 1,
            description: 'From search through dispatch/compute with publish prompts.',
            defaults: {
                project_name: 'histo-exp1'
            },
            steps: [
                {
                    id: 's1_search',
                    action: 'search',
                    params: {
                        query: 'histology'
                    },
                    outputs: {
                        alias: 'search_results'
                    }
                },
                {
                    id: 's2_select_dataset',
                    action: 'select_dataset',
                    params: {
                        from: '${search_results}',
                        strategy: 'by_id',
                        id: 'ds-006'
                    },
                    outputs: {
                        alias: 'selected_dataset'
                    }
                },
                {
                    id: 's3_add',
                    action: 'add',
                    params: {
                        dataset: '${selected_dataset.id}'
                    }
                },
                {
                    id: 's4_rename',
                    action: 'rename',
                    params: {
                        project: '${answers.project_name ?? defaults.project_name}'
                    }
                },
                {
                    id: 's5_harmonize',
                    action: 'harmonize',
                    params: {}
                },
                {
                    id: 's6_proceed',
                    action: 'proceed',
                    params: {}
                },
                {
                    id: 's7_local_train',
                    action: 'run_python',
                    params: {
                        script: 'train.py'
                    }
                },
                {
                    id: 's8_federate_transcompile',
                    action: 'federate.transcompile',
                    params: {}
                },
                {
                    id: 's9_federate_containerize',
                    action: 'federate.containerize',
                    params: {}
                },
                {
                    id: 's10_publish_metadata',
                    action: 'federate.publish_metadata',
                    params: {
                        app_name: '?',
                        org: '?',
                        visibility: 'public'
                    },
                    outputs: {
                        alias: 'publish_meta'
                    }
                },
                {
                    id: 's11_marketplace_publish',
                    action: 'federate.publish',
                    params: {}
                },
                {
                    id: 's12_dispatch_compute',
                    action: 'federate.dispatch_compute',
                    params: {}
                }
            ]
        }
    }
];

/**
 * Get all built-in scripts.
 *
 * @returns Script catalog entries.
 */
export function scripts_list(): ReadonlyArray<CalypsoScript> {
    return BUILTIN_SCRIPTS;
}

/**
 * Resolve a script reference by ID or alias.
 *
 * @param ref - User-provided reference.
 * @returns Script definition or null if not found.
 */
export function script_find(ref: string): CalypsoScript | null {
    const normalized: string = scriptRef_normalize(ref);
    if (!normalized) return null;

    for (const script of BUILTIN_SCRIPTS) {
        if (script.id === normalized) return script;
        if (script.aliases.some((alias: string): boolean => alias === normalized)) return script;
    }

    return null;
}

/**
 * Normalize a user script reference.
 *
 * @param ref - Raw script reference.
 * @returns Normalized lowercase reference.
 */
function scriptRef_normalize(ref: string): string {
    return ref
        .trim()
        .toLowerCase()
        .replace(/\.clpso$/i, '');
}
