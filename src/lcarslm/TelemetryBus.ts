/**
 * @file Telemetry Bus
 *
 * Central event bus for live UI updates emitted by plugins.
 * Captured by the Calypso Host and broadcast over WebSockets.
 *
 * @module lcarslm/TelemetryBus
 */

import type { TelemetryEvent, PluginTelemetry, StepAnimationConfig } from './types.js';

export type TelemetryObserver = (event: TelemetryEvent) => void;

/**
 * Manages the emission and observation of live telemetry events.
 */
export class TelemetryBus {
    private observers: Set<TelemetryObserver> = new Set();

    /**
     * Subscribe to telemetry events.
     * 
     * @param observer - Callback function for new events.
     * @returns Unsubscribe function.
     */
    subscribe(observer: TelemetryObserver): () => void {
        this.observers.add(observer);
        return () => this.observers.delete(observer);
    }

    /**
     * Emit a telemetry event to all subscribers.
     * 
     * @param event - The telemetry event to broadcast.
     */
    emit(event: TelemetryEvent): void {
        for (const observer of this.observers) {
            try {
                observer(event);
            } catch (e) {
                console.error('Telemetry observer failed:', e);
            }
        }
    }

    /**
     * Create a scoped PluginTelemetry interface for a guest plugin.
     */
    context_create(): PluginTelemetry {
        return {
            log: (message: string) => this.emit({ type: 'log', message }),
            progress: (label: string, percent: number) => this.emit({ type: 'progress', label, percent }),
            frame_open: (title: string, subtitle?: string) => this.emit({ type: 'frame_open', title, subtitle }),
            frame_close: (summary?: string[]) => this.emit({ type: 'frame_close', summary }),
            phase_start: (name: string) => this.emit({ type: 'phase_start', name }),
            status: (message: string) => this.emit({ type: 'status', message })
        };
    }
}
