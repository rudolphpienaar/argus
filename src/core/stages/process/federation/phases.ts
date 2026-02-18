/**
 * @file Process Federation Phases
 *
 * Time-based UI phase execution for build, distribution, and handshake.
 *
 * @module core/stages/process/federation/phases
 */

import type { LCARSTerminal } from '../../../../ui/components/Terminal.js';
import type { TrustedDomainNode } from '../../../models/types.js';

/**
 * Run build-phase status stream and progress updates.
 */
export function federationBuild_run(
    terminal: LCARSTerminal | null,
    factoryIcon: Element | null,
    statusText: HTMLElement,
    progressBar: HTMLElement,
): void {
    factoryIcon?.classList.add('building');

    const buildSteps: readonly BuildStep[] = [
        { msg: 'Resolving dependencies...', time: 500 },
        { msg: 'Pulling base image: meridian/python:3.11-cuda11.8...', time: 1200 },
        { msg: 'Compiling model architecture (ResNet50)...', time: 2000 },
        { msg: 'Wrapping application logic...', time: 2800 },
        { msg: 'Generating cryptographic signatures...', time: 3500 },
        { msg: 'Building MERIDIAN container: chest-xray-v1:latest...', time: 4200 },
        { msg: 'Pushing to internal registry...', time: 5000 },
        { msg: 'BUILD COMPLETE. Digest: sha256:7f8a...', time: 5500 },
    ];

    buildSteps.forEach((step: BuildStep): void => {
        window.setTimeout((): void => {
            terminal?.println(`> ${step.msg}`);
            const progress: number = (step.time / 6000) * 50;
            progressBar.style.width = `${progress}%`;
            statusText.textContent = `FACTORY: ${step.msg.toUpperCase()}`;
        }, step.time);
    });
}

/**
 * Run distribution phase animations and terminal receipts.
 */
export function federationDistribution_run(
    terminal: LCARSTerminal | null,
    factoryIcon: Element | null,
    nodes: TrustedDomainNode[],
    statusText: HTMLElement,
): void {
    window.setTimeout((): void => {
        factoryIcon?.classList.remove('building');
        statusText.textContent = 'DISPATCHING PAYLOADS TO TRUSTED DOMAINS...';
        terminal?.println('\u25CF INITIATING SECURE DISTRIBUTION WAVE...');

        nodes.forEach((node: TrustedDomainNode, index: number): void => {
            window.setTimeout((): void => {
                const line: HTMLElement | null = document.getElementById(`fed-line-${index}`);
                if (line) {
                    line.style.strokeDashoffset = '0';
                }
            }, index * 300);

            window.setTimeout((): void => {
                const nodeIcon: HTMLElement | null = document.getElementById(`node-icon-${index}`);
                if (!nodeIcon) {
                    return;
                }
                nodeIcon.classList.add('received');
                terminal?.println(`\u25CB [${node.name}] >> PAYLOAD RECEIVED. VERIFIED.`);
            }, 1000 + (index * 300));
        });
    }, 6000);
}

/**
 * Schedule handshake completion and invoke completion callback.
 */
export function federationHandshake_schedule(options: HandshakeOptions): void {
    const handshakeDelay: number = 6000 + (options.nodes.length * 600) + 1000;

    window.setTimeout((): void => {
        options.statusText.textContent = 'ALL NODES READY. STARTING FEDERATED SESSION.';
        options.progressBar.style.width = '100%';
        options.terminal?.println('\u25CF NETWORK SYNCHRONIZED. HANDING OFF TO MONITOR.');

        window.setTimeout((): void => {
            options.overlay.classList.add('hidden');
            options.onComplete();
        }, 2000);
    }, handshakeDelay);
}

interface BuildStep {
    msg: string;
    time: number;
}

/**
 * Handshake scheduling dependencies.
 */
export interface HandshakeOptions {
    terminal: LCARSTerminal | null;
    nodes: TrustedDomainNode[];
    overlay: HTMLElement;
    statusText: HTMLElement;
    progressBar: HTMLElement;
    onComplete: () => void;
}
