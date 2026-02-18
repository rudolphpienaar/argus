/**
 * @file Process Federation Overlay Elements
 *
 * Resolves and initializes overlay DOM elements for the Process-stage
 * federation launch sequence.
 *
 * @module core/stages/process/federation/elements
 */

import { store } from '../../../state/store.js';
import type { LCARSTerminal } from '../../../../ui/components/Terminal.js';
import type { TrustedDomainNode } from '../../../models/types.js';
import { federationNetwork_initialize } from './network.js';

/**
 * DOM references required by the federation overlay sequence.
 */
export interface FederationElements {
    overlay: HTMLElement;
    spokesContainer: HTMLElement;
    statusText: HTMLElement;
    progressBar: HTMLElement;
    factoryIcon: Element | null;
}

/**
 * Resolve required federation overlay elements.
 *
 * @returns Element bundle or null when overlay is unavailable.
 */
export function federationElements_resolve(): FederationElements | null {
    const overlay: HTMLElement | null = document.getElementById('federation-overlay');
    const spokesContainer: HTMLElement | null = document.getElementById('fed-spokes');
    const statusText: HTMLElement | null = document.getElementById('fed-status-text');
    const progressBar: HTMLElement | null = document.getElementById('fed-progress-bar');
    const factoryIcon: Element | null = document.querySelector('.factory-icon');

    if (!overlay || !spokesContainer || !statusText || !progressBar) {
        return null;
    }

    return {
        overlay,
        spokesContainer,
        statusText,
        progressBar,
        factoryIcon,
    };
}

/**
 * Reset and display the federation overlay for a new sequence run.
 */
export function federationOverlay_initialize(elements: FederationElements, terminal: LCARSTerminal | null): void {
    elements.overlay.classList.remove('hidden');
    elements.spokesContainer.innerHTML = '';
    elements.progressBar.style.width = '0%';
    elements.statusText.textContent = 'INITIALIZING ATLAS FACTORY...';

    if (store.globals.frameSlot && !store.globals.frameSlot.state_isOpen()) {
        terminal?.println('\u25CF EXTENDING CONSOLE FOR BUILD OUTPUT...');
        store.globals.frameSlot.frame_open();
    }

    overlayMargin_sync(elements.overlay);
}

/**
 * Render node spokes and schedule network-line initialization.
 */
export function federationNodes_render(nodes: TrustedDomainNode[], spokesContainer: HTMLElement): void {
    nodes.forEach((node: TrustedDomainNode, index: number): void => {
        const nodeElement: HTMLDivElement = document.createElement('div');
        nodeElement.className = `fed-node-container node-pos-${index}`;
        nodeElement.innerHTML = `<div class="fed-node-icon" id="node-icon-${index}">${node.name.split('-')[0]}</div>`;
        spokesContainer.appendChild(nodeElement);
    });

    window.setTimeout((): void => {
        federationNetwork_initialize(nodes, spokesContainer);
    }, 500);
}

/**
 * Sync overlay content margin below the visible terminal drawer.
 */
function overlayMargin_sync(overlay: HTMLElement): void {
    const consoleEl: HTMLElement | null = document.getElementById('intelligence-console');
    if (!consoleEl) {
        return;
    }

    window.setTimeout((): void => {
        const terminalHeight: number = consoleEl.offsetHeight;
        const container: HTMLElement | null = overlay.querySelector('.fed-container') as HTMLElement | null;
        if (container) {
            container.style.marginTop = `${terminalHeight + 20}px`;
        }
    }, 50);
}
