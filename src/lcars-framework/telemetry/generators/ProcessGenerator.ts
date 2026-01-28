/**
 * @file Process List Generator
 * Simulates a Unix-like top/htop process list.
 */

import { TelemetryGenerator } from '../types.js';

export interface ProcessInfo {
    pid: number;
    usr: string;
    cpu: string;
    mem: string;
    cmd: string;
}

export class ProcessGenerator implements TelemetryGenerator<ProcessInfo[]> {
    private baseProcs: ProcessInfo[] = [
        { pid: 1492, usr: 'root', cpu: '0.0', mem: '1.2', cmd: 'kube-apiserver' },
        { pid: 1503, usr: 'root', cpu: '0.0', mem: '4.5', cmd: 'etcd' },
        { pid: 8821, usr: 'atlas', cpu: '0.0', mem: '12.4', cmd: 'python3 train.py' },
        { pid: 2201, usr: 'root', cpu: '0.0', mem: '0.8', cmd: 'containerd' },
        { pid: 3392, usr: 'atlas', cpu: '0.0', mem: '0.4', cmd: 'argus-agent' }
    ];

    generate(): ProcessInfo[] {
        return this.baseProcs.map(p => ({
            ...p,
            cpu: (Math.random() * (p.cmd === 'python3 train.py' ? 95 : 20)).toFixed(1)
        })).sort((a, b) => parseFloat(b.cpu) - parseFloat(a.cpu));
    }
}
