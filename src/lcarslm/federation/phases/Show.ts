/**
 * @file Federation Show Phase
 *
 * Handles status display and artifact review commands.
 *
 * @module
 */

import type { CalypsoResponse } from '../../types.js';
import type { FederationDagPaths, FederationState } from '../types.js';
import { publishSummary_lines, response_create } from '../utils.js';

/**
 * show: Route to appropriate display based on subcommand or current step.
 */
export function step_show(
    state: FederationState,
    rawArgs: string[],
    projectBase: string,
    dag: FederationDagPaths,
): CalypsoResponse {
    const sub = rawArgs.join(' ').toLowerCase().trim();

    if (sub.startsWith('transcompile') || sub.startsWith('transpile')) {
        return response_create(
            [
                '● TRANSCOMPILATION REVIEW',
                '',
                `○ SOURCE: ${projectBase}/src/train.py`,
                `○ OUTPUT: ${dag.crosscompileData}`,
                '○ ARTIFACTS: node.py, flower_hooks.py, transcompile.log, artifact.json',
                '',
                '○ The transcompiler wraps your training loop in Flower client hooks',
                '  and generates a federated entrypoint (node.py) for site-local execution.',
                '',
                state.step === 'federate-transcompile' ? '  `approve` — Proceed with transcompilation' : '○ (already completed)',
            ].join('\n'),
            [], true
        );
    }

    if (sub.startsWith('container')) {
        return response_create(
            [
                '● CONTAINER BUILD REVIEW',
                '',
                `○ BASE IMAGE: python:3.11-slim`,
                `○ OUTPUT: ${dag.containerizeData}`,
                '○ ARTIFACTS: Dockerfile, image.tar, image.digest, sbom.json, build.log',
                '',
                '○ The container packages your transcompiled code, dependencies, and',
                '  Flower client into a MERIDIAN-compliant OCI image.',
                '',
                state.step === 'federate-containerize' ? '  `approve` — Build container image' : '○ (already completed)',
            ].join('\n'),
            [], true
        );
    }

    if (sub.startsWith('publish')) {
        return response_create(
            [
                '● PUBLICATION REVIEW',
                '',
                ...publishSummary_lines(state.publish),
                `○ OUTPUT: ${dag.publishData}`,
                '',
                state.step === 'federate-publish-execute' ? '  `approve` — Push to registry' : '○ (already completed or not yet configured)',
            ].join('\n'),
            [], true
        );
    }

    if (sub.startsWith('metric')) {
        return step_showMetrics(projectBase, dag);
    }

    if (sub.startsWith('round')) {
        return step_showRounds(projectBase, dag);
    }

    if (sub.startsWith('provenance')) {
        return step_showProvenance(state, projectBase, dag);
    }

    // Bare "show" — context-dependent
    return response_create(
        [
            '● FEDERATION SHOW COMMANDS',
            '',
            '  `show transcompile` — Review transcompilation output',
            '  `show container`    — Review container build',
            '  `show publish`      — Review publication config',
            '  `show metrics`      — Show training metrics',
            '  `show rounds`       — Show per-round details',
            '  `show provenance`   — Show full provenance chain',
        ].join('\n'),
        [], true
    );
}

function step_showMetrics(projectBase: string, dag: FederationDagPaths): CalypsoResponse {
    return response_create(
        [
            '● FEDERATION METRICS',
            '',
            '○ Final aggregate accuracy: 0.89',
            '○ Loss trajectory: 0.38 → 0.11',
            '○ Rounds: 5/5 complete',
            '○ Participants: BCH, MGH, BIDMC (3/3)',
            '',
            `○ Details: ${dag.roundsData}/aggregate-metrics.json`,
        ].join('\n'),
        [], true
    );
}

function step_showRounds(projectBase: string, dag: FederationDagPaths): CalypsoResponse {
    return response_create(
        [
            '● FEDERATION ROUNDS',
            '',
            '  ROUND 1/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.62',
            '  ROUND 2/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.71',
            '  ROUND 3/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.79',
            '  ROUND 4/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.84',
            '  ROUND 5/5  [BCH:OK] [MGH:OK] [BIDMC:OK]  AGG=0.89',
            '',
            `○ Details: ${dag.roundsData}`,
        ].join('\n'),
        [], true
    );
}

function step_showProvenance(
    state: FederationState,
    projectBase: string,
    dag: FederationDagPaths,
): CalypsoResponse {
    return response_create(
        [
            '● PROVENANCE CHAIN',
            '',
            '  search → gather → harmonize → code → train → federate',
            '',
            `  ○ Source: ${projectBase}/src/train.py`,
            `  ○ Transcompiled: ${dag.crosscompileData}`,
            `  ○ Containerized: ${dag.containerizeData}`,
            `  ○ Published: ${dag.publishData}`,
            `  ○ Dispatched: ${dag.dispatchData}`,
            `  ○ Rounds: ${dag.roundsData}`,
        ].join('\n'),
        [], true
    );
}
