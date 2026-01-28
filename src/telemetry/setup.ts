/**
 * @file Telemetry Setup
 * Wires up the LCARS Framework Telemetry Service for the ARGUS application.
 */

import { telemetryService } from '../lcars-framework/telemetry/service.js';
import { ProcessGenerator, ProcessInfo } from '../lcars-framework/telemetry/generators/ProcessGenerator.js';
import { NetworkGenerator, NetworkIface } from '../lcars-framework/telemetry/generators/NetworkGenerator.js';
import { LogGenerator } from '../lcars-framework/telemetry/generators/LogGenerator.js';
import { ListRenderer } from '../lcars-framework/telemetry/renderers/ListRenderer.js';
import { LogRenderer } from '../lcars-framework/telemetry/renderers/LogRenderer.js';
import { HTMLRenderer } from '../lcars-framework/telemetry/renderers/HTMLRenderer.js';
import { StationTelemetryGenerator } from '../lcars-framework/telemetry/generators/StationTelemetryGenerator.js';
import { state } from '../core/state/store.js';
import type { AppState } from '../core/models/types.js';

/**
 * Initializes all telemetry registrations for ARGUS.
 */
export function telemetry_setup(): void {
    // 1. Process List (Top Panel)
    telemetryService.register({
        id: 'proc-list',
        targetId: 'tele-proc',
        generator: new ProcessGenerator(),
        renderer: new ListRenderer<ProcessInfo>(
            '  PID USER     %CPU %MEM COMMAND',
            (p) => {
                const cpuClass = parseFloat(p.cpu) > 80 ? 'warn' : 'highlight';
                return `<span class="${cpuClass}">${p.pid.toString().padEnd(5)} ${p.usr.padEnd(8)} ${p.cpu.padStart(4)} ${p.mem.padStart(4)} ${p.cmd}</span>`;
            }
        )
    });

    // 2. Network Stats (Top Panel)
    telemetryService.register({
        id: 'net-stats',
        targetId: 'tele-net',
        generator: new NetworkGenerator(),
        renderer: new ListRenderer<NetworkIface>(
            'IFACE    RX (GB)   TX (GB)   STATUS',
            (n) => `${n.name.padEnd(8)} ${n.rx.padStart(7)}   ${n.tx.padStart(7)}   <span class="${n.statusClass || 'highlight'}">${n.status}</span>`
        )
    });

    // 3. System Logs (Top Panel)
    telemetryService.register({
        id: 'sys-logs',
        targetId: 'tele-log',
        generator: new LogGenerator(),
        renderer: new LogRenderer()
    });

    // 4. SeaGaP Stations
    const STAGES: AppState['currentStage'][] = ['search', 'gather', 'process', 'monitor', 'post'];
    
    STAGES.forEach((stage, index) => {
        telemetryService.register({
            id: `station-${stage}`,
            targetId: `tele-${stage}`,
            generator: new StationTelemetryGenerator(
                getStationProvider(stage),
                () => document.getElementById(`station-${stage}`)?.classList.contains('active') || false
            ),
            renderer: new HTMLRenderer()
        });
    });
}

/**
 * Returns the content provider function for a specific stage.
 * Note: In a fully modular system, these would be separate classes.
 */
function getStationProvider(stage: string) {
    switch (stage) {
        case 'search':
            return (isActive: boolean, t: number, timeStr: string) => {
                if (!isActive) return `<span class="dim">[${timeStr}]</span> <span class="highlight">SCAN COMPLETE</span><br>HITS: 42<br>STATUS: IDLE`;
                const queries = ['chest xray', 'pneumonia', 'covid-19', 'thoracic', 'lung nodule'];
                return `<span class="dim">[${timeStr}]</span> SCAN: <span class="highlight">XRAY</span><br>` +
                       `QUERY: "<span class="warn">${queries[t % queries.length]}</span>"<br>` +
                       `HITS: <span class="highlight">${Math.floor(Math.random() * 50 + 10)}</span><br>` +
                       `LATENCY: ${Math.floor(Math.random() * 50 + 5)}ms`;
            };
        case 'gather':
            return (isActive: boolean, t: number, timeStr: string) => {
                const imgCount = state.selectedDatasets.reduce((sum, d) => sum + d.imageCount, 0);
                if (!isActive) return `<span class="dim">[${timeStr}]</span> <span class="highlight">GATHERED</span><br>IMG: ${imgCount}<br>STATUS: SYNCED`;
                const ops = ['INDEXING', 'HASHING', 'VALIDATING', 'CACHING', 'SYNCING'];
                return `<span class="dim">[${timeStr}]</span> <span class="warn">${ops[t % ops.length]}</span><br>` +
                       `DATASETS: <span class="highlight">${state.selectedDatasets.length}</span><br>` +
                       `IMAGES: ${imgCount.toLocaleString()}<br>` +
                       `COST: <span class="highlight">$${state.costEstimate.total.toFixed(2)}</span>`;
            };
        case 'process':
            return (isActive: boolean, t: number, timeStr: string) => {
                if (!isActive) return `<span class="dim">[${timeStr}]</span> <span class="highlight">COMPILED</span><br>MODEL: ResNet50<br>READY: YES`;
                const tasks = ['COMPILING', 'LINKING', 'VALIDATING', 'OPTIMIZING', 'STAGING'];
                return `<span class="dim">[${timeStr}]</span> <span class="warn">${tasks[t % tasks.length]}</span><br>` +
                       `MODEL: ResNet50<br>` +
                       `PARAMS: <span class="highlight">25.6M</span><br>` +
                       `GPU MEM: ${(Math.random() * 4 + 8).toFixed(1)} GB`;
            };
        case 'monitor':
            return (isActive: boolean, t: number, timeStr: string) => {
                const epoch = state.trainingJob?.currentEpoch ?? 0;
                const loss = state.trainingJob?.loss?.toFixed(4) ?? (2.5 - (t % 100) * 0.02).toFixed(4);
                if (!isActive) return `<span class="dim">[${timeStr}]</span> <span class="highlight">FINISHED</span><br>EPOCH: 50/50<br>LOSS: 0.0231`;
                return `<span class="dim">[${timeStr}]</span> <span class="warn">TRAINING</span><br>` +
                       `EPOCH: <span class="highlight">${Math.floor(epoch)}/50</span><br>` +
                       `LOSS: <span class="warn">${loss}</span><br>` +
                       `THROUGHPUT: ${Math.floor(Math.random() * 100 + 150)} img/s`;
            };
        case 'post':
            return (isActive: boolean, t: number, timeStr: string) => {
                if (!isActive) return `<span class="dim">[${timeStr}]</span> <span class="highlight">PUBLISHED</span><br>VER: 1.0.0`;
                const actions = ['CHECKSUMMING', 'PACKAGING', 'SIGNING', 'REGISTERING', 'PUBLISHING'];
                return `<span class="dim">[${timeStr}]</span> <span class="warn">${actions[t % actions.length]}</span><br>` +
                       `MODEL: ChestXRay-v1<br>` +
                       `SIZE: <span class="highlight">98.2 MB</span><br>` +
                       `ACC: 94.2%  AUC: 0.967`;
            };
        default:
            return () => 'Initializing...';
    }
}