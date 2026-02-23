/**
 * @file Process Federation Launch Orchestration
 *
 * Gatekeeping and orchestration entrypoint for Process-stage federation launch.
 *
 * @module core/stages/process/federation/launch
 */

import { store } from '../../../state/store.js';
import { stage_advanceTo } from '../../../logic/navigation.js';
import { MOCK_NODES } from '../../../data/nodes.js';
import { workspace_teardown } from '../../gather.js';
import type { TrustedDomainNode, TrainingJob } from '../../../models/types.js';
import type { LCARSTerminal } from '../../../../ui/components/Terminal.js';
import {
    federationElements_resolve,
    federationOverlay_initialize,
    federationNodes_render,
    type FederationElements,
} from './elements.js';
import { FederationObserver } from './phases.js';

/**
 * Launch federated training from Process stage.
 */
export function training_launch(): void {
    if (trainingRunning_isActive()) {
        return;
    }

    federationSequence_run();
}

/**
 * Check whether a training job is already running.
 */
function trainingRunning_isActive(): boolean {
    return Boolean(store.state.trainingJob && store.state.trainingJob.status === 'running');
}

/**
 * Execute the full federation launch sequence.
 */
function federationSequence_run(): void {
    const elements: FederationElements | null = federationElements_resolve();
    if (!elements) {
        return;
    }

    const terminal: LCARSTerminal | null = store.globals.terminal;
    const nodes: TrustedDomainNode[] = federationNodes_resolve();

    federationOverlay_initialize(elements, terminal);
    federationNodes_render(nodes, elements.spokesContainer);

    // v10.4: The UI is now a passive observer. It listens for telemetry
    // emitted by the federation-simulator plugin and updates the DOM.
    const observer = new FederationObserver(elements, federationCompletion_finalize);
    observer.start();
}

/**
 * Resolve federation participant nodes excluding aggregator hub.
 */
function federationNodes_resolve(): TrustedDomainNode[] {
    return MOCK_NODES.filter((node: TrustedDomainNode): boolean => node.name !== 'MOC-HUB');
}

/**
 * Finalize federation launch and transition to Monitor stage.
 */
function federationCompletion_finalize(): void {
    workspace_teardown();
    store.trainingJob_set(trainingJob_create());
    stage_advanceTo('monitor');
}

/**
 * Build a fresh running training job model for Monitor stage.
 */
function trainingJob_create(): TrainingJob {
    return {
        id: `job-${Date.now()}`,
        status: 'running',
        currentEpoch: 0,
        totalEpochs: 50,
        loss: 2.5,
        accuracy: 0,
        auc: 0,
        runningCost: 0,
        budgetLimit: 500,
        startTime: new Date(),
        nodes: trainingNodes_clone(),
        lossHistory: [],
    };
}

/**
 * Clone mock node records for mutable job runtime store.state.
 */
function trainingNodes_clone(): TrustedDomainNode[] {
    return MOCK_NODES.map((node: TrustedDomainNode): TrustedDomainNode => ({
        ...node,
    }));
}
