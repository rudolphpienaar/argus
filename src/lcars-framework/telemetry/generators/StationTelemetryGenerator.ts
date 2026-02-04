/**
 * @file Station Telemetry Generator (Generic)
 * A generator that uses a callback to produce station-specific content.
 */

import { TelemetryGenerator } from '../types.js';

export type StationContentProvider = (isActive: boolean, cycle: number, timeStr: string, context?: unknown) => string;

export class StationTelemetryGenerator implements TelemetryGenerator<string> {
    constructor(
        private provider: StationContentProvider,
        private isActiveProvider: () => boolean
    ) {}

    generate(cycle: number, context?: unknown): string {
        const offset: number = (context !== null && typeof context === 'object' && 'offset' in context && typeof (context as { offset?: number }).offset === 'number') ? (context as { offset: number }).offset : 0;
        const t: number = cycle + offset;
        const timeStr = String(t % 10000).padStart(4, '0');
        const isActive = this.isActiveProvider();
        
        return this.provider(isActive, t, timeStr, context);
    }
}
