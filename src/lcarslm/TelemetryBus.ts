/**
 * @file Telemetry Bus
 *
 * Central event bus for live UI updates emitted by plugins.
 * Captured by the Calypso Host and broadcast over WebSockets.
 *
 * Typed facade over Node.js EventEmitter. The custom Set<Observer>
 * has been replaced with the battle-tested EventEmitter registry,
 * giving us once(), removeAllListeners(), and listenerCount() for free.
 *
 * @module lcarslm/TelemetryBus
 */

import { EventEmitter } from 'events';
import type { TelemetryEvent, PluginTelemetry } from './types.js';

export type TelemetryObserver = (event: TelemetryEvent) => void;

/** Internal event channel. Single constant avoids string literals at call sites. */
const CHANNEL = 'telemetry' as const;

/**
 * Manages the emission and observation of live telemetry events.
 * Backed by Node's EventEmitter — delegates listener registry and dispatch mechanics.
 */
export class TelemetryBus {
    private readonly emitter: EventEmitter;

    constructor() {
        this.emitter = new EventEmitter();
        // Match the original Set's unlimited capacity — suppress the default 10-listener warning.
        this.emitter.setMaxListeners(0);
    }

    /**
     * Subscribe to telemetry events.
     *
     * @param observer - Callback function for new events.
     * @returns Unsubscribe function.
     */
    subscribe(observer: TelemetryObserver): () => void {
        this.emitter.on(CHANNEL, observer);
        return () => this.emitter.off(CHANNEL, observer);
    }

    /**
     * Emit a telemetry event to all subscribers.
     *
     * @param event - The telemetry event to broadcast.
     */
    emit(event: TelemetryEvent): void {
        this.emitter.emit(CHANNEL, event);
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
