/**
 * @file Network Stats Generator
 * Simulates interface traffic.
 */

import { TelemetryGenerator } from '../types.js';

export interface NetworkIface {
    name: string;
    rx: string;
    tx: string;
    status: string;
    statusClass?: string;
}

export class NetworkGenerator implements TelemetryGenerator<NetworkIface[]> {
    generate(cycle: number): NetworkIface[] {
        const eth0_rx = (42 + cycle * 0.1 + Math.random()).toFixed(2);
        const eth0_tx = (12 + cycle * 0.05 + Math.random()).toFixed(2);
        const tun0_rx = (8 + Math.random() * 2).toFixed(2);

        return [
            { name: 'eth0', rx: eth0_rx, tx: eth0_tx, status: 'UP 1000Mb', statusClass: 'highlight' },
            { name: 'tun0', rx: tun0_rx, tx: '0008.12', status: 'UP VPN', statusClass: 'highlight' },
            { name: 'docker0', rx: '0042.11', tx: '0041.88', status: 'UP', statusClass: 'dim' }
        ];
    }
}
