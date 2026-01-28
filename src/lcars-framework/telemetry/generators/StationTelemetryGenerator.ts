/**
 * @file Station Telemetry Generator (Generic)
 * A generator that uses a callback to produce station-specific content.
 */

import { TelemetryGenerator } from '../types.js';

export type StationContentProvider = (isActive: boolean, cycle: number, timeStr: string, context?: any) => string;

export class StationTelemetryGenerator implements TelemetryGenerator<string> {
    constructor(
        private provider: StationContentProvider,
        private isActiveProvider: () => boolean
    ) {}

    generate(cycle: number, context?: any): string {
        const t = cycle + (context?.offset || 0);
        const timeStr = String(t % 10000).padStart(4, '0');
        const isActive = this.isActiveProvider();
        
        return this.provider(isActive, t, timeStr, context);
    }
}
