/**
 * @file Telemetry Logic
 *
 * Handles system telemetry simulation and cascade updates.
 *
 * @module
 */

import { state } from '../state/store.js';
import { events, Events } from '../state/events.js';
import type { AppState, Dataset } from '../models/types.js';

const STAGE_ORDER: readonly string[] = ['search', 'gather', 'process', 'monitor', 'post'] as const;

// ============================================================================ 
// Data Cascade Functions
// ============================================================================ 

/**
 * Updates the data cascade display with current metrics or system telemetry.
 * Triggered automatically by STATE_CHANGED events.
 */
function cascade_update(): void {
    const datasetsEl: HTMLElement | null = document.getElementById('cascade-datasets');
    const imagesEl: HTMLElement | null = document.getElementById('cascade-images');
    const costEl: HTMLElement | null = document.getElementById('cascade-cost');
    const statusEl: HTMLElement | null = document.getElementById('cascade-status');

    const label1: HTMLElement | null = document.getElementById('cascade-label-1');
    const label2: HTMLElement | null = document.getElementById('cascade-label-2');
    const label3: HTMLElement | null = document.getElementById('cascade-label-3');
    const label4: HTMLElement | null = document.getElementById('cascade-label-4');
    const label5: HTMLElement | null = document.getElementById('cascade-label-5');
    const label6: HTMLElement | null = document.getElementById('cascade-label-6');

    if (state.currentStage === 'login' || state.currentStage === 'role-selection') {
        // Telemetry Mode
        if (label1) label1.textContent = 'NODES';
        if (label2) label2.textContent = 'JOBS';
        if (label3) label3.textContent = 'TRAFFIC';
        if (label4) label4.textContent = 'ACCESS';
        if (label5) label5.textContent = 'GPU';
        if (label6) label6.textContent = 'MEM';
    } else {
        // Workflow Mode
        if (label1) label1.textContent = 'DATASETS';
        if (label2) label2.textContent = 'IMAGES';
        if (label3) label3.textContent = 'COST';
        if (label4) label4.textContent = 'STATUS';

        const totalImages: number = state.selectedDatasets.reduce((sum: number, ds: Dataset) => sum + ds.imageCount, 0);
        const totalCost: number = state.costEstimate.total;

        if (datasetsEl) datasetsEl.textContent = state.selectedDatasets.length.toString();
        if (imagesEl) imagesEl.textContent = totalImages.toLocaleString();
        if (costEl) costEl.textContent = `$${totalCost.toFixed(0)}`;

        if (statusEl) {
            const statusMap: Record<AppState['currentStage'], string> = {
                login: 'LOCKED',
                'role-selection': 'AWAITING ROLE',
                search: 'SEARCHING',
                gather: 'GATHERING',
                process: 'PROCESSING',
                monitor: 'TRAINING',
                post: 'COMPLETE'
            };
            statusEl.textContent = statusMap[state.currentStage] || 'READY';
        }
    }
}

// Subscribe to state changes
events.on(Events.STATE_CHANGED, () => {
    cascade_update();
});

export { cascade_update }; // Keep export for legacy/init compatibility for now

let telemetryCycle: number = 0;

/**
 * Updates real-time system telemetry numbers (btop effect).
 */
export function telemetry_update(): void {
    if (state.currentStage !== 'login' && state.currentStage !== 'role-selection') return;

    telemetryCycle++;

    // Update Process List (Simulated `top`)
    const procEl: HTMLElement | null = document.getElementById('tele-proc');
    if (procEl) {
        const procs: Array<{ pid: number; usr: string; cpu: string; mem: string; cmd: string }> = [
            { pid: 1492, usr: 'root', cpu: (Math.random() * 80).toFixed(1), mem: '1.2', cmd: 'kube-apiserver' },
            { pid: 1503, usr: 'root', cpu: (Math.random() * 40).toFixed(1), mem: '4.5', cmd: 'etcd' },
            { pid: 8821, usr: 'atlas', cpu: (Math.random() * 95).toFixed(1), mem: '12.4', cmd: 'python3 train.py' },
            { pid: 2201, usr: 'root', cpu: (Math.random() * 10).toFixed(1), mem: '0.8', cmd: 'containerd' },
            { pid: 3392, usr: 'atlas', cpu: (Math.random() * 5).toFixed(1), mem: '0.4', cmd: 'argus-agent' }
        ];
        
        // Sort by CPU
        procs.sort((a, b) => parseFloat(b.cpu) - parseFloat(a.cpu));
        
        let html: string = '<span class="dim">  PID USER     %CPU %MEM COMMAND</span>\n';
        procs.forEach(p => {
            const cpuClass: string = parseFloat(p.cpu) > 80 ? 'warn' : 'highlight';
            html += `<span class="${cpuClass}">${p.pid.toString().padEnd(5)} ${p.usr.padEnd(8)} ${p.cpu.padStart(4)} ${p.mem.padStart(4)} ${p.cmd}</span>\n`;
        });
        procEl.innerHTML = html;
    }

    // Update Network (Simulated `ifconfig` / activity)
    const netEl: HTMLElement | null = document.getElementById('tele-net');
    if (netEl) {
        const eth0_rx: string = (42 + telemetryCycle * 0.1 + Math.random()).toFixed(2);
        const eth0_tx: string = (12 + telemetryCycle * 0.05 + Math.random()).toFixed(2);
        const tun0_rx: string = (8 + Math.random() * 2).toFixed(2);
        
        let html: string = '<span class="dim">IFACE    RX (GB)   TX (GB)   STATUS</span>\n';
        html += `eth0     ${eth0_rx.padStart(7)}   ${eth0_tx.padStart(7)}   <span class="highlight">UP 1000Mb</span>\n`;
        html += `tun0     ${tun0_rx.padStart(7)}   0008.12   <span class="highlight">UP VPN</span>\n`;
        html += `docker0  0042.11   0041.88   <span class="dim">UP</span>\n`;
        netEl.innerHTML = html;
    }

    // Update Logs (Scrolling text)
    const logEl: HTMLElement | null = document.getElementById('tele-log');
    if (logEl) {
        const events: string[] = [
            '[KERN] Tainted: P           O      5.15.0-1031-aws #35~20.04.1',
            '[AUTH] pam_unix(sshd:session): session opened for user atlas',
            '[K8S ] Pod/default/trainer-x86-04 scheduled on node-04',
            '[NET ] eth0: promiscuous mode enabled',
            '[WARN] GPU-0: Temperature 82C, fan speed 100%',
            '[INFO] ATLAS Federation Link: Heartbeat received from MGH',
            '[INFO] ATLAS Federation Link: Heartbeat received from BCH',
            '[AUDIT] User access granted: dev-001 from 10.0.4.2'
        ];
        
        // Pick a random event occasionally
        if (Math.random() > 0.7) {
            const time: string = new Date().toISOString().split('T')[1].slice(0,8);
            const event: string = events[Math.floor(Math.random() * events.length)];
            const line: string = `${time} ${event}`;
            
            // Append and scroll
            const lines: string[] = (logEl.innerText + '\n' + line).split('\n').slice(-5); // Keep last 5 lines
            logEl.innerText = lines.join('\n');
        }
    }
}