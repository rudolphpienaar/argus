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

// Terminal handle command moved to argus.ts locally to fix scope issues.

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

export function populate_ide(): void {
    // 1. Render File Tree from VFS
    const processTree = document.getElementById('process-file-tree');
    const cwdNode = globals.vfs.getCwdNode(); 
    
    if (processTree && cwdNode) {
        const buildHtml = (n: any): string => {
            const typeClass = n.type;
            if (n.children && n.children.length > 0) {
                return `<li class="${typeClass}">${n.name}<ul>${n.children.map(buildHtml).join('')}</ul></li>`;
            }
            // Use ide_openFile for file clicks in Process stage
            return `<li class="${typeClass}" onclick="ide_openFile('${n.name}', '${n.type}')">${n.name}</li>`;
        };
        processTree.innerHTML = `<ul>${buildHtml(cwdNode)}</ul>`;
    } else if (processTree) {
        processTree.innerHTML = '<span class="dim">No filesystem mounted.</span>';
    }

    // 2. Populate Code Editor (Default)
    ide_openFile('train.py', 'file');
}

/**
 * Loads file content into the IDE code editor.
 * Exposed to window for onclick access.
 */
export function ide_openFile(filename: string, type: string): void {
    const codeEl = document.getElementById('process-code-content');
    if (!codeEl) return;

    if (filename === 'train.py') {
        codeEl.innerHTML = `
<span class="comment"># ARGUS Federated Training Script</span>
<span class="comment"># Target: ResNet50 on Distributed Cohorts</span>

<span class="keyword">import</span> torch
<span class="keyword">import</span> meridian.federated <span class="keyword">as</span> fl
<span class="keyword">from</span> atlas.models <span class="keyword">import</span> ResNet50

<span class="keyword">def</span> <span class="function">train</span>(cohort_id):
    <span class="comment"># Initialize local node context</span>
    node = fl.Node(cohort_id)
    
    <span class="comment"># Load Data (Secure Mount)</span>
    dataset = node.load_dataset(<span class="string">"/data/cohort/training"</span>)
    
    <span class="comment"># Define Model</span>
    model = ResNet50(pretrained=<span class="keyword">True</span>)
    
    <span class="comment"># Federated Loop</span>
    <span class="keyword">for</span> round <span class="keyword">in</span> <span class="function">range</span>(<span class="number">50</span>):
        weights = model.train(dataset)
        fl.aggregate(weights)
        
    <span class="keyword">return</span> model.save()
`;
    } else if (filename === 'README.md') {
        codeEl.innerHTML = `
<span class="comment"># Project Manifest</span>

This project contains a federated learning cohort definition.

**Topology:** Star Network
**Aggregation:** FedAvg
**Privacy:** Differential Privacy (epsilon=3.0)

<span class="keyword">## Data Sources</span>
- Boston Children's Hospital
- Mass General Hospital
`;
    } else if (type === 'image') {
        codeEl.innerHTML = `<div style="display:flex; justify-content:center; align-items:center; height:100%; color:var(--honey);">[IMAGE PREVIEW NOT AVAILABLE IN CODE EDITOR]</div>`;
    } else {
        codeEl.innerHTML = `<div style="padding:1rem; color:var(--font-color);">[Binary or Unknown File Type]</div>`;
    }
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
    const consoleEl = document.getElementById('intelligence-console');
    if (consoleEl && !consoleEl.classList.contains('open')) {
        globals.terminal.println('● EXTENDING CONSOLE FOR BUILD OUTPUT...');
        consoleEl.classList.add('open');
    }

    // Dynamic Layout Adjustment: Push animation below terminal
    if (consoleEl) {
        // Wait for transition or force read
        setTimeout(() => {
            const terminalHeight = consoleEl.offsetHeight;
            const container = overlay.querySelector('.fed-container') as HTMLElement;
            if (container) {
                // Add a buffer of 20px
                container.style.marginTop = `${terminalHeight + 20}px`;
            }
        }, 50); // Small delay to allow 'open' class to expand height
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