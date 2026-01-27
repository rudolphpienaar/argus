/**
 * @file Marketplace View Logic
 */

import { store, state, globals } from '../core/state/store.js';
import { events, Events } from '../core/state/events.js';
import { MARKETPLACE_ASSETS, type MarketplaceAsset } from '../core/data/marketplace.js';

/**
 * Initializes the marketplace view.
 */
export function marketplace_initialize(): void {
    // 1. Listen for State Changes (Toggle visibility)
    events.on(Events.STATE_CHANGED, (s: any) => {
        const overlay = document.getElementById('marketplace-overlay');
        if (overlay) {
            overlay.classList.toggle('hidden', !s.marketplaceOpen);
            if (s.marketplaceOpen) {
                marketGrid_render();
            }
        }
    });

    // 2. Initial Render
    marketGrid_render();
}

/**
 * Renders the grid of marketplace assets.
 */
function marketGrid_render(): void {
    const container = document.getElementById('market-grid');
    if (!container) return;

    container.innerHTML = MARKETPLACE_ASSETS.map(asset => {
        const isInstalled = state.installedAssets.includes(asset.id);
        return `
            <div class="market-card ${isInstalled ? 'installed' : ''}" onclick="asset_click('${asset.id}')">
                <div class="header-row">
                    <div class="badge">${asset.type} v${asset.version}</div>
                </div>
                <h4>${asset.name}</h4>
                <p>${asset.description}</p>
                <div class="footer">
                    <div class="meta">
                        <span>BY ${asset.author.toUpperCase()}</span>
                        <span>SIZE: ${asset.size}</span>
                    </div>
                    <button class="install-btn">
                        ${isInstalled ? 'INSTALLED' : 'INSTALL'}
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Handles clicking an asset (Mock Installation).
 */
(window as any).asset_click = (id: string) => {
    const asset = MARKETPLACE_ASSETS.find(a => a.id === id);
    if (!asset) return;

    if (state.installedAssets.includes(id)) {
        globals.terminal.println(`○ INFO: ${asset.name} IS ALREADY INSTALLED.`);
        return;
    }

    globals.terminal.println(`● INITIATING SECURE INSTALL: [${asset.name.toUpperCase()}]`);
    globals.terminal.println(`○ DOWNLOADING PAYLOAD (${asset.size})...`);
    
    // Simulate delay
    setTimeout(() => {
        store.installAsset(id);
        globals.terminal.println(`<span class="success">>> SUCCESS: ${asset.name} INSTALLED TO VFS.</span>`);
        
        // If it was a plugin, remind user how to run it
        if (asset.type === 'plugin') {
            globals.terminal.println(`<span class="dim">   Usage: /usr/local/bin/${asset.name} --help</span>`);
        }
    }, 1200);
};
