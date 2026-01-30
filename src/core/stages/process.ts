/**
 * @file Process Stage Logic
 *
 * Manages the developer terminal interactions, IDE environment,
 * and federated training launch sequence.
 *
 * @module
 */

import { state, globals, store } from '../state/store.js';
import { stage_advanceTo } from '../logic/navigation.js';
import { MOCK_NODES } from '../data/nodes.js';
import { syntax_highlight } from '../../ui/syntaxHighlight.js';
import type { TrustedDomainNode } from '../models/types.js';
import type { FileNode as VfsFileNode } from '../../vfs/types.js';
import type { LCARSTerminal } from '../../ui/components/Terminal.js';

// ============================================================================
// Terminal Controls
// ============================================================================

/**
 * Toggles the Intelligence Console via the Frame Slot orchestrator.
 * Delegates to FrameSlot for the two-phase open/close animation.
 */
export function terminal_toggle(): void {
    if (globals.frameSlot) {
        globals.frameSlot.frame_toggle();
    }
}

// ============================================================================
// IDE / File Tree
// ============================================================================

/**
 * Populates the Process stage IDE: renders the VFS file tree
 * in the sidebar and opens the default file in the code editor.
 */
export function populate_ide(): void {
    const processTree: HTMLElement | null = document.getElementById('process-file-tree');
    const cwdNode: VfsFileNode | null = globals.vcs.node_stat(globals.vcs.cwd_get());

    if (processTree && cwdNode) {
        const nodeHtml_build = (n: VfsFileNode): string => {
            const typeClass: string = n.type;
            if (n.children && n.children.length > 0) {
                // Folder with toggle capability
                return `
                    <li class="${typeClass} open">
                        <span onclick="this.parentElement.classList.toggle('open')">${n.name}</span>
                        <ul>${n.children.map(nodeHtml_build).join('')}</ul>
                    </li>`;
            }
            // File
            return `<li class="${typeClass}" onclick="ide_openFile('${n.name}', '${n.type}')">${n.name}</li>`;
        };
        processTree.innerHTML = `<ul class="interactive-tree">${nodeHtml_build(cwdNode)}</ul>`;
    } else if (processTree) {
        processTree.innerHTML = '<span class="dim">No filesystem mounted.</span>';
    }

    ide_openFile('train.py', 'file');
}

/**
 * Loads file content into the IDE code editor.
 * Reads content from the VCS (triggering lazy generation if needed).
 * Falls back to type-based placeholders for binary/image files.
 *
 * @param filename - The file name to open.
 * @param type - The file type ('file', 'folder', 'image').
 */
export function ide_openFile(filename: string, type: string): void {
    const codeEl: HTMLElement | null = document.getElementById('process-code-content');
    if (!codeEl) return;

    if (type === 'image') {
        codeEl.innerHTML = `<div style="display:flex; justify-content:center; align-items:center; height:100%; color:var(--honey);">[IMAGE PREVIEW NOT AVAILABLE IN CODE EDITOR]</div>`;
        return;
    }

    const cwdPath: string = globals.vcs.cwd_get();
    const filePath: string = `${cwdPath}/${filename}`;
    try {
        const content: string | null = globals.vcs.node_read(filePath);
        if (content !== null) {
            const highlighted: string = syntax_highlight(content, filename);
            codeEl.innerHTML = `<pre>${highlighted}</pre>`;
            return;
        }
    } catch (_e: unknown) {
        // File not found in VCS — fall through to placeholder
    }

    codeEl.innerHTML = `<div style="padding:1rem; color:var(--font-color);">[Binary or Unknown File Type]</div>`;
}

// ============================================================================
// Federated Training Launch
// ============================================================================

/**
 * Launches federated training.
 * Ignored if a training job is already running.
 */
export function training_launch(): void {
    if (state.trainingJob && state.trainingJob.status === 'running') return;
    federation_sequence();
}

/**
 * Orchestrates the full "Federalization" sequence:
 * Factory Build -> Containerization -> Distribution -> Handshake.
 * Delegates each phase to a dedicated sub-function.
 */
async function federation_sequence(): Promise<void> {
    const t: LCARSTerminal | null = globals.terminal;
    const overlay: HTMLElement | null = document.getElementById('federation-overlay');
    const factoryIcon: Element | null = document.querySelector('.factory-icon');
    const spokesContainer: HTMLElement | null = document.getElementById('fed-spokes');
    const statusText: HTMLElement | null = document.getElementById('fed-status-text');
    const progressBar: HTMLElement | null = document.getElementById('fed-progress-bar');

    if (!overlay || !spokesContainer || !statusText || !progressBar) return;

    federationOverlay_initialize(overlay, spokesContainer, statusText, progressBar, t);

    const nodes: TrustedDomainNode[] = MOCK_NODES.filter((n: TrustedDomainNode): boolean => n.name !== 'MOC-HUB');

    federationNodes_render(nodes, spokesContainer);
    federationBuild_run(t, factoryIcon, statusText, progressBar);
    federationDistribution_run(t, factoryIcon, nodes, statusText, progressBar);
    federationHandshake_run(t, nodes, overlay, statusText, progressBar);
}

/**
 * Initializes the federation overlay: clears previous state,
 * opens the terminal console, and adjusts layout.
 *
 * @param overlay - The federation overlay element.
 * @param spokesContainer - The container for node spoke elements.
 * @param statusText - The status text element.
 * @param progressBar - The progress bar element.
 * @param t - The terminal instance (may be null).
 */
function federationOverlay_initialize(
    overlay: HTMLElement,
    spokesContainer: HTMLElement,
    statusText: HTMLElement,
    progressBar: HTMLElement,
    t: LCARSTerminal | null
): void {
    overlay.classList.remove('hidden');
    spokesContainer.innerHTML = '';
    progressBar.style.width = '0%';
    statusText.textContent = 'INITIALIZING ATLAS FACTORY...';

    const consoleEl: HTMLElement | null = document.getElementById('intelligence-console');
    if (globals.frameSlot && !globals.frameSlot.state_isOpen()) {
        if (t) t.println('\u25CF EXTENDING CONSOLE FOR BUILD OUTPUT...');
        globals.frameSlot.frame_open();
    }

    if (consoleEl) {
        setTimeout((): void => {
            const terminalHeight: number = consoleEl.offsetHeight;
            const container: HTMLElement | null = overlay.querySelector('.fed-container') as HTMLElement;
            if (container) {
                container.style.marginTop = `${terminalHeight + 20}px`;
            }
        }, 50);
    }
}

/**
 * Renders the node spoke icons into the federation overlay.
 *
 * @param nodes - The trusted domain nodes to render.
 * @param spokesContainer - The container element for spokes.
 */
function federationNodes_render(nodes: TrustedDomainNode[], spokesContainer: HTMLElement): void {
    nodes.forEach((node: TrustedDomainNode, i: number): void => {
        const nodeDiv: HTMLDivElement = document.createElement('div');
        nodeDiv.className = `fed-node-container node-pos-${i}`;
        nodeDiv.innerHTML = `<div class="fed-node-icon" id="node-icon-${i}">${node.name.split('-')[0]}</div>`;
        spokesContainer.appendChild(nodeDiv);
    });

    // Initialize the SVG network layer after the container transition finishes (300ms + buffer)
    setTimeout(() => federationNetwork_init(nodes, spokesContainer), 500);
}

/**
 * Initializes the SVG network layer connecting the hub to all nodes.
 * Creates an invisible line for each connection, ready to be animated.
 *
 * @param nodes - The trusted domain nodes.
 * @param container - The container element (fed-spokes).
 */
function federationNetwork_init(nodes: TrustedDomainNode[], container: HTMLElement): void {
    // Clean up any existing SVG
    const existingSvg = container.querySelector('svg');
    if (existingSvg) existingSvg.remove();

    // Find the overlay to scope our search for the factory icon
    const overlay = container.closest('.federation-overlay');
    if (!overlay) return;

    // Find the hub (factory icon) center within this specific overlay
    const hubIcon = overlay.querySelector('.factory-icon');
    if (!hubIcon) {
        console.warn('ARGUS: Factory icon not found in federation overlay.');
        return;
    }

    const svgNamespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.position = "absolute";
    svg.style.top = "0";
    svg.style.left = "0";
    svg.style.pointerEvents = "none";
    svg.style.zIndex = "0"; // Behind nodes

    // We need coordinates relative to the container
    const getCenter = (el: Element): { x: number, y: number } => {
        const rect = el.getBoundingClientRect();
        const contRect = container.getBoundingClientRect();
        return {
            x: rect.left + rect.width / 2 - contRect.left,
            y: rect.top + rect.height / 2 - contRect.top
        };
    };

    const hubCenter = getCenter(hubIcon);

    nodes.forEach((_node, i) => {
        const nodeIcon = document.getElementById(`node-icon-${i}`);
        if (!nodeIcon) return;

        const nodeCenter = getCenter(nodeIcon);
        const line = document.createElementNS(svgNamespace, "line");

        line.setAttribute("x1", hubCenter.x.toString());
        line.setAttribute("y1", hubCenter.y.toString());
        line.setAttribute("x2", nodeCenter.x.toString());
        line.setAttribute("y2", nodeCenter.y.toString());
        line.setAttribute("stroke", "var(--orange)"); // Use LCARS orange
        line.setAttribute("stroke-width", "2");
        line.setAttribute("id", `fed-line-${i}`);

        // Prepare for animation: length of the line
        const length = Math.sqrt(
            Math.pow(nodeCenter.x - hubCenter.x, 2) +
            Math.pow(nodeCenter.y - hubCenter.y, 2)
        );

        line.style.strokeDasharray = `${length}`;
        line.style.strokeDashoffset = `${length}`; // Hidden initially
        line.style.transition = "stroke-dashoffset 1s ease-out";

        svg.appendChild(line);
    });

    container.prepend(svg);
}

/**
 * Runs PHASE 1: Build. Simulates factory build logs with staggered
 * timeouts and progress bar updates (0–50%).
 *
 * @param t - The terminal instance (may be null).
 * @param factoryIcon - The factory icon element.
 * @param statusText - The status text element.
 * @param progressBar - The progress bar element.
 */
function federationBuild_run(
    t: LCARSTerminal | null,
    factoryIcon: Element | null,
    statusText: HTMLElement,
    progressBar: HTMLElement
): void {
    if (factoryIcon) factoryIcon.classList.add('building');

    const buildSteps: readonly { readonly msg: string; readonly time: number }[] = [
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
        setTimeout((): void => {
            if (t) t.println(`> ${step.msg}`);
            const progress: number = (step.time / 6000) * 50;
            progressBar.style.width = `${progress}%`;
            statusText.textContent = `FACTORY: ${step.msg.toUpperCase()}`;
        }, step.time);
    }
}

/**
 * Runs PHASE 2: Distribution. Dispatches payloads to trusted domain
 * nodes with staggered arrival animations.
 *
 * @param t - The terminal instance (may be null).
 * @param factoryIcon - The factory icon element.
 * @param nodes - The trusted domain nodes.
 * @param statusText - The status text element.
 * @param _progressBar - The progress bar element (unused in this phase).
 */
function federationDistribution_run(
    t: LCARSTerminal | null,
    factoryIcon: Element | null,
    nodes: TrustedDomainNode[],
    statusText: HTMLElement,
    _progressBar: HTMLElement
): void {
    setTimeout((): void => {
        if (factoryIcon) factoryIcon.classList.remove('building');
        statusText.textContent = 'DISPATCHING PAYLOADS TO TRUSTED DOMAINS...';
        if (t) t.println('\u25CF INITIATING SECURE DISTRIBUTION WAVE...');

        nodes.forEach((node: TrustedDomainNode, i: number): void => {
            // Animate Line (Distribution)
            setTimeout((): void => {
                const line = document.getElementById(`fed-line-${i}`);
                if (line) {
                    line.style.strokeDashoffset = '0'; // Draw to end
                }
            }, i * 300); // Stagger line starts slightly

            // Animate Node (Receipt) - triggered after line finishes roughly
            setTimeout((): void => {
                const nodeIcon: HTMLElement | null = document.getElementById(`node-icon-${i}`);
                if (nodeIcon) {
                    nodeIcon.classList.add('received');
                    if (t) t.println(`\u25CB [${node.name}] >> PAYLOAD RECEIVED. VERIFIED.`);
                }
            }, 1000 + (i * 300));
        });
    }, 6000);
}

/**
 * Runs PHASE 3: Handshake. Finalizes the federation, creates the
 * training job, and transitions to the Monitor stage.
 *
 * @param t - The terminal instance (may be null).
 * @param nodes - The trusted domain nodes.
 * @param overlay - The federation overlay element.
 * @param statusText - The status text element.
 * @param progressBar - The progress bar element.
 */
function federationHandshake_run(
    t: LCARSTerminal | null,
    nodes: TrustedDomainNode[],
    overlay: HTMLElement,
    statusText: HTMLElement,
    progressBar: HTMLElement
): void {
    setTimeout((): void => {
        statusText.textContent = 'ALL NODES READY. STARTING FEDERATED SESSION.';
        progressBar.style.width = '100%';
        if (t) t.println('\u25CF NETWORK SYNCHRONIZED. HANDING OFF TO MONITOR.');

        setTimeout((): void => {
            overlay.classList.add('hidden');
            store.trainingJob_set({
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
                nodes: JSON.parse(JSON.stringify(MOCK_NODES)) as TrustedDomainNode[],
                lossHistory: []
            });
            stage_advanceTo('monitor');
        }, 2000);
    }, 6000 + (nodes.length * 600) + 1000);
}
