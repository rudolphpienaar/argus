/**
 * @file Process Federation Observer
 * 
 * Passive telemetry listener for federation simulation events.
 * Updates the LCARS overlay DOM based on plugin-emitted telemetry.
 * 
 * @module core/stages/process/federation/phases
 */

import { events, Events } from '../../../state/events.js';
import type { TelemetryEvent } from '../../../../lcarslm/types.js';
import type { FederationElements } from './elements.js';

/**
 * Orchestrator for reflecting federation telemetry onto the UI.
 */
export class FederationObserver {
    private unsubscribe: (() => void) | null = null;

    constructor(
        private readonly elements: FederationElements,
        private readonly onComplete: () => void
    ) {}

    /**
     * Start observing telemetry events.
     */
    public start(): void {
        this.unsubscribe = events.on(Events.TELEMETRY_EMITTED, (event: TelemetryEvent) => {
            this.telemetry_handle(event);
        });
    }

    /**
     * Stop observing telemetry.
     */
    public stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
    }

    /**
     * Dispatch telemetry events to UI update methods.
     */
    private telemetry_handle(event: TelemetryEvent): void {
        switch (event.type) {
            case 'status':
                this.status_update(event.message);
                break;
            case 'progress':
                this.progress_update(event.percent);
                break;
            case 'phase_start':
                this.phase_handle(event.name);
                break;
        }
    }

    /**
     * Update the status text in the factory panel.
     */
    private status_update(message: string): void {
        if (message.startsWith('FACTORY:')) {
            this.elements.factoryIcon?.classList.add('building');
        }
        this.elements.statusText.textContent = message.toUpperCase();
    }

    /**
     * Update the LCARS progress bar width.
     */
    private progress_update(percent: number): void {
        this.elements.progressBar.style.width = `${percent}%`;
    }

    /**
     * Handle phase-specific UI triggers (e.g. node received).
     */
    private phase_handle(phaseId: string): void {
        // v10.4: Handle per-node received animations
        if (phaseId.startsWith('fed_node_received:')) {
            this.elements.factoryIcon?.classList.remove('building');
            const index = parseInt(phaseId.split(':')[1], 10);
            this.node_markReceived(index);
        }

        // Final completion trigger from plugin
        if (phaseId === 'federation_complete') {
            this.complete();
        }
    }

    /**
     * Trigger node-received animations on the map.
     */
    private node_markReceived(index: number): void {
        const line: HTMLElement | null = document.getElementById(`fed-line-${index}`);
        if (line) {
            line.style.strokeDashoffset = '0';
        }

        const nodeIcon: HTMLElement | null = document.getElementById(`node-icon-${index}`);
        if (nodeIcon) {
            nodeIcon.classList.add('received');
        }
    }

    /**
     * Cleanup and trigger completion callback.
     */
    private complete(): void {
        this.stop();
        window.setTimeout((): void => {
            this.elements.overlay.classList.add('hidden');
            this.onComplete();
        }, 2000);
    }
}

/**
 * Handshake scheduling dependencies (retained for backward compatibility if needed).
 */
export interface HandshakeOptions {
    onComplete: () => void;
}
