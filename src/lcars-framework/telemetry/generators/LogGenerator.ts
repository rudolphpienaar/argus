/**
 * @file Log Stream Generator
 * Simulates a scrolling system log.
 */

import { TelemetryGenerator } from '../types.js';

export class LogGenerator implements TelemetryGenerator<string[]> {
    private history: string[] = [];
    private maxLines: number = 5;
    private events: string[] = [
        '[KERN] Tainted: P           O      5.15.0-1031-aws #35~20.04.1',
        '[AUTH] pam_unix(sshd:session): session opened for user atlas',
        '[K8S ] Pod/default/trainer-x86-04 scheduled on node-04',
        '[NET ] eth0: promiscuous mode enabled',
        '[WARN] GPU-0: Temperature 82C, fan speed 100%',
        '[INFO] ATLAS Federation Link: Heartbeat received from MGH',
        '[INFO] ATLAS Federation Link: Heartbeat received from BCH',
        '[AUDIT] User access granted: dev-001 from 10.0.4.2'
    ];

    generate(): string[] {
        if (Math.random() > 0.7 || this.history.length === 0) {
            const time = new Date().toISOString().split('T')[1].slice(0, 8);
            const event = this.events[Math.floor(Math.random() * this.events.length)];
            this.history.push(`${time} ${event}`);
            if (this.history.length > this.maxLines) {
                this.history.shift();
            }
        }
        return [...this.history];
    }
}
