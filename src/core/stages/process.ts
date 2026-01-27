/**
 * @file Process Stage Logic
 * 
 * Manages the developer terminal interactions and environment.
 * 
 * @module
 */

import { state, globals } from '../state/store.js';
import { catalog_search, dataset_toggle, workspace_render, lcarslm_simulate } from './search.js';
import { stage_next, stage_advanceTo, stageButton_setEnabled } from '../logic/navigation.js';
import { filesystem_build, costs_calculate } from './gather.js';
import type { QueryResponse } from '../../lcarslm/types.js';
import type { Dataset } from '../models/types.js';
import { MOCK_NODES } from '../data/nodes.js';
import { DATASETS } from '../data/datasets.js';

/**
 * Handles unrecognized terminal commands by routing them to the AI core.
 */
export async function terminal_handleCommand(cmd: string, args: string[]): Promise<void> {
    if (!globals.terminal) return;

    // DEBUG: Check Engine State
    // console.log('DEBUG: terminal_handleCommand called', cmd, args);
    // console.log('DEBUG: globals.lcarsEngine is', globals.lcarsEngine);

    // Terminal-Driven Workflow Commands
    if (cmd === 'search') {
        const query = args.join(' ');
        globals.terminal.println(`○ SEARCHING CATALOG FOR: "${query}"...`);
        stage_advanceTo('search');
        // We need to inject the query into the search box and trigger search
        const searchInput = document.getElementById('search-query') as HTMLInputElement;
        if (searchInput) {
            searchInput.value = query;
            await catalog_search(query);
        }
        return;
    }

    if (cmd === 'add') {
        const targetId = args[0];
        const dataset = DATASETS.find(ds => ds.id === targetId || ds.name.toLowerCase().includes(targetId.toLowerCase()));
        if (dataset) {
            dataset_toggle(dataset.id);
        } else {
            globals.terminal.println(`<span class="error">>> ERROR: DATASET "${targetId}" NOT FOUND.</span>`);
        }
        return;
    }

    if (cmd === 'review' || cmd === 'gather') {
        globals.terminal.println(`● INITIATING COHORT REVIEW...`);
        stage_advanceTo('gather');
        return;
    }

    if (cmd === 'mount') {
        globals.terminal.println(`● MOUNTING VIRTUAL FILESYSTEM...`);
        filesystem_build();
        costs_calculate();
        stage_advanceTo('process');
        globals.terminal.println(`<span class="success">>> MOUNT COMPLETE. FILESYSTEM READY.</span>`);
        return;
    }

    if (cmd === 'simulate') {
        globals.terminal.println(`● ACTIVATING SIMULATION PROTOCOLS...`);
        lcarslm_simulate();
        return;
    }

    // Local Command Handling (Prioritize over AI)
    if (cmd === 'cd' || cmd === 'ls') {
        return handleProjectNavigation(cmd, args);
    }

    const query = [cmd, ...args].join(' ');
    
    // AI / Natural Language Processing
    console.log('DEBUG: Checking globals.lcarsEngine:', globals.lcarsEngine);
    if (globals.lcarsEngine) {
        globals.terminal.println('○ CONTACTING AI CORE... PROCESSING...');
        // ...
    } else {
        // DEBUG: Why is it offline?
        console.warn('DEBUG: AI CORE OFFLINE. globals.lcarsEngine is null/undefined.');
        globals.terminal.println(`<span class="warn">>> COMMAND NOT RECOGNIZED. AI CORE OFFLINE.</span>`);
        globals.terminal.println(`<span class="dim">>> SYSTEM UNINITIALIZED. PLEASE AUTHENTICATE OR TYPE "simulate".</span>`);
    }
}

async function handleProjectNavigation(cmd: string, args: string[]): Promise<void> {
    // This logic needs to be moved from argus.ts.
    // I will implement it fully in the next step to ensure clean imports.
}

export function terminal_toggle(): void {
    const consoleEl: HTMLElement | null = document.getElementById('intelligence-console');
    if (consoleEl) {
        const isOpen: boolean = consoleEl.classList.contains('open');
        if (isOpen) {
            consoleEl.classList.remove('open');
            consoleEl.style.height = '';
        } else {
            consoleEl.classList.add('open');
            if (!consoleEl.style.height) {
                consoleEl.style.height = '600px';
            }
        }
    }
}

export function terminal_initializeDraggable(): void {
    const strip: HTMLElement | null = document.getElementById('access-strip');
    const consoleEl: HTMLElement | null = document.getElementById('intelligence-console');
    
    if (!strip || !consoleEl) return;

    let isDragging: boolean = false;
    let startY: number = 0;
    let startHeight: number = 0;

    strip.addEventListener('mousedown', (e: MouseEvent) => {
        isDragging = true;
        startY = e.clientY;
        startHeight = consoleEl.offsetHeight;
        strip.classList.add('active');
        document.body.style.cursor = 'ns-resize';
        if (!consoleEl.classList.contains('open')) {
            consoleEl.classList.add('open');
        }
    });

    window.addEventListener('mousemove', (e: MouseEvent) => {
        if (!isDragging) return;
        const deltaY: number = e.clientY - startY;
        const newHeight: number = Math.max(0, Math.min(window.innerHeight - 400, startHeight + deltaY));
        consoleEl.style.height = `${newHeight}px`;
        consoleEl.style.transition = 'none';
        
        if (newHeight > 50) {
            consoleEl.classList.add('open');
        } else {
            consoleEl.classList.remove('open');
        }
    });

    window.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        strip.classList.remove('active');
        document.body.style.cursor = 'default';
        consoleEl.style.transition = '';
    });
}

/**
 * Launches federated training.
 */
export function training_launch(): void {
    // If already running, ignore
    if (state.trainingJob && state.trainingJob.status === 'running') return;

    // Start the Federation Sequence instead of jumping straight to Monitor
    federation_sequence();
}

/**
 * Orchestrates the "Federalization" sequence:
 * Factory Build -> Containerization -> Distribution -> Handshake
 */
async function federation_sequence(): Promise<void> {
    const overlay = document.getElementById('federation-overlay');
    const factoryIcon = document.querySelector('.factory-icon');
    const spokesContainer = document.getElementById('fed-spokes');
    const statusText = document.getElementById('fed-status-text');
    const progressBar = document.getElementById('fed-progress-bar');

    if (!overlay || !spokesContainer || !statusText || !progressBar) return;

    // 1. Initialize Overlay
    overlay.classList.remove('hidden');
    spokesContainer.innerHTML = ''; // Clear previous
    progressBar.style.width = '0%';
    statusText.textContent = 'INITIALIZING ATLAS FACTORY...';
    
    // Ensure Terminal is visible for build logs
    if (!document.getElementById('intelligence-console')?.classList.contains('open')) {
        globals.terminal.println('● EXTENDING CONSOLE FOR BUILD OUTPUT...');
        document.getElementById('intelligence-console')?.classList.add('open');
    }

    // 2. Render Nodes (Spokes)
    const centerX = spokesContainer.offsetWidth / 2;
    const centerY = spokesContainer.offsetHeight / 2;
    
    // Use MOCK_NODES but filter out the hub if present
    const nodes = MOCK_NODES.filter(n => n.name !== 'MOC-HUB'); 
    
    nodes.forEach((node, i) => {
        const nodeDiv = document.createElement('div');
        nodeDiv.className = `fed-node-container node-pos-${i}`;
        nodeDiv.innerHTML = `<div class="fed-node-icon" id="node-icon-${i}">${node.name.split('-')[0]}</div>`;
        spokesContainer.appendChild(nodeDiv);

        // Draw Line (Calculated roughly for the animation visual)
        // Note: Exact line drawing in CSS grid is tricky, simplified here for prototype
        // We will just animate the packet from center to the node's position class
    });

    // 3. PHASE 1: BUILD (Simulated Logs)
    if (factoryIcon) factoryIcon.classList.add('building');
    
    const buildSteps = [
        { msg: 'Resolving dependencies...', time: 500 },
        { msg: 'Pulling base image: meridian/python:3.11-cuda11.8...', time: 1200 },
        { msg: 'Compiling model architecture (ResNet50)...', time: 2000 },
        { msg: 'Wrapping application logic...', time: 2800 },
        { msg: 'Generating cryptographic signatures...', time: 3500 },
        { msg: 'Building MERIDIAN container: chest-xray-v1:latest...', time: 4200 },
        { msg: 'Pushing to internal registry...', time: 5000 },
        { msg: 'BUILD COMPLETE. Digest: sha256:7f8a...', time: 5500 }
    ];

    for (const step of buildSteps) {
        setTimeout(() => {
            globals.terminal.println(`> ${step.msg}`);
            const progress = (step.time / 6000) * 50; // First 50% is build
            progressBar.style.width = `${progress}%`;
            statusText.textContent = `FACTORY: ${step.msg.toUpperCase()}`;
        }, step.time);
    }

    // 4. PHASE 2: DISTRIBUTION (Animation)
    setTimeout(() => {
        if (factoryIcon) factoryIcon.classList.remove('building');
        statusText.textContent = 'DISPATCHING PAYLOADS TO TRUSTED DOMAINS...';
        globals.terminal.println('● INITIATING SECURE DISTRIBUTION WAVE...');
        
        nodes.forEach((node, i) => {
            // Create packet
            const packet = document.createElement('div');
            packet.className = 'fed-packet';
            
            // Calculate vector from center to node
            // Since we use classes for positions, we simulate the travel by
            // appending the packet to the node container and animating it 'from' center?
            // Easier: Just use a centralized packet that moves to the node's offset.
            // For this prototype, we'll iterate through nodes and flash them 'Received'
            
            setTimeout(() => {
                const nodeIcon = document.getElementById(`node-icon-${i}`);
                if (nodeIcon) {
                    nodeIcon.classList.add('received');
                    globals.terminal.println(`○ [${node.name}] >> PAYLOAD RECEIVED. VERIFIED.`);
                }
            }, 1000 + (i * 600)); // Staggered arrival
        });

    }, 6000);

    // 5. PHASE 3: HANDSHAKE & TRANSITION
    setTimeout(() => {
        statusText.textContent = 'ALL NODES READY. STARTING FEDERATED SESSION.';
        progressBar.style.width = '100%';
        globals.terminal.println('● NETWORK SYNCHRONIZED. HANDING OFF TO MONITOR.');
        
        setTimeout(() => {
            overlay.classList.add('hidden');
            
            // Initialize training job
            state.trainingJob = {
                id: `job-${Date.now()}`,
                status: 'running',
                currentEpoch: 0,
                totalEpochs: 50,
                loss: 2.5,
                accuracy: 0,
                auc: 0,
                runningCost: 0,
                budgetLimit: 500,
                startTime: new Date(),
                nodes: JSON.parse(JSON.stringify(MOCK_NODES)),
                lossHistory: []
            };

            stageButton_setEnabled('monitor', true);
            stage_advanceTo('monitor');
        }, 2000);

    }, 6000 + (nodes.length * 600) + 1000);
}