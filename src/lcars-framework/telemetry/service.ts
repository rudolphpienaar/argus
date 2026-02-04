/**
 * @file Telemetry Service
 * Orchestrates generators and renderers to update the UI.
 */

import { TelemetryRegistryEntry } from './types.js';

export class TelemetryService {
    private entries: TelemetryRegistryEntry[] = [];
    private intervalId: number | null = null;
    private tickCount: number = 0;
    private intervalMs: number = 800;

    /**
     * Registers a new telemetry component.
     */
    register(entry: TelemetryRegistryEntry): void {
        this.entries.push(entry);
    }

    /**
     * Starts the global update loop.
     */
    start(intervalMs?: number): void {
        if (this.intervalId) return;
        if (intervalMs) this.intervalMs = intervalMs;
        
        this.intervalId = window.setInterval(() => this.tick(), this.intervalMs);
    }

    /**
     * Stops the update loop.
     */
    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    /**
     * Single update cycle.
     */
    private tick(): void {
        this.tickCount++;
        
        for (const entry of this.entries) {
            const target = document.getElementById(entry.targetId);
            if (!target) continue;

            try {
                const data = entry.generator.generate(this.tickCount);
                entry.renderer.render(data, target);
            } catch (err: unknown) {
                console.error(`Telemetry error in entry [${entry.id}]:`, err);
            }
        }
    }

    /**
     * Manually triggers a specific entry (useful for static updates).
     */
    updateEntry(id: string, context?: unknown): void {
        const entry = this.entries.find(e => e.id === id);
        if (!entry) return;

        const target = document.getElementById(entry.targetId);
        if (!target) return;

        const data = entry.generator.generate(this.tickCount, context);
        entry.renderer.render(data, target);
    }
}

// Export a singleton instance
export const telemetryService = new TelemetryService();
