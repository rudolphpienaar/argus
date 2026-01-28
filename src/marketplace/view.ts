/**
 * @file Marketplace View Logic
 * @description Handles marketplace UI rendering, filtering, sorting, and search functionality.
 */

import { store, state, globals } from '../core/state/store.js';
import { events, Events } from '../core/state/events.js';
import { MARKETPLACE_ASSETS, type MarketplaceAsset } from '../core/data/marketplace.js';

let currentFilter: string = 'all';
let currentSearch: string = '';
let currentSort: string = 'stars-desc';

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

    // 3. Expose functions to window
    (window as any).market_filter = market_filter;
    (window as any).market_search = market_search;
    (window as any).market_sort = market_sort;
    (window as any).assetDetail_open = assetDetail_open;
    (window as any).assetDetail_close = assetDetail_close;
    (window as any).assetDetail_install = assetDetail_install;
}

/**
 * Filters the marketplace grid by asset type.
 * @param type - The asset type to filter by ('all', 'plugin', 'dataset', 'model', 'annotation', 'installed')
 */
export function market_filter(type: string): void {
    currentFilter = type;

    // Update active state of pills
    document.querySelectorAll('.filter-pill').forEach(btn => {
        const text = btn.textContent?.toLowerCase() || '';
        const isMatch = (type === 'all' && text === 'all') ||
                        (type === 'plugin' && text === 'plugins') ||
                        (type === 'dataset' && text === 'datasets') ||
                        (type === 'model' && text === 'models') ||
                        (type === 'annotation' && text === 'annotations') ||
                        (type === 'fda' && text === 'fda') ||
                        (type === 'installed' && text === 'installed');

        btn.classList.toggle('active', isMatch);
    });

    marketGrid_render();
}

/**
 * Searches the marketplace by query string.
 * @param query - The search query to filter assets by name, description, or author
 */
export function market_search(query: string): void {
    currentSearch = query.toLowerCase().trim();
    marketGrid_render();
}

/**
 * Sorts the marketplace grid.
 * @param sortBy - The sort order ('stars-desc', 'stars-asc', 'name-asc', 'name-desc', 'size-desc', 'size-asc')
 */
export function market_sort(sortBy: string): void {
    currentSort = sortBy;
    marketGrid_render();
}

/**
 * Parses a size string (e.g., "150 MB") to a numeric value for sorting.
 * @param size - The size string to parse
 * @returns The numeric size value
 */
function parseSize(size: string): number {
    const match = size.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
}

/**
 * Sorts an array of marketplace assets.
 * @param assets - The assets to sort
 * @param sortBy - The sort order
 * @returns The sorted array
 */
function marketAssets_sort(assets: MarketplaceAsset[], sortBy: string): MarketplaceAsset[] {
    const sorted = [...assets];
    switch (sortBy) {
        case 'stars-desc':
            return sorted.sort((a, b) => b.stars - a.stars);
        case 'stars-asc':
            return sorted.sort((a, b) => a.stars - b.stars);
        case 'name-asc':
            return sorted.sort((a, b) => a.name.localeCompare(b.name));
        case 'name-desc':
            return sorted.sort((a, b) => b.name.localeCompare(a.name));
        case 'size-desc':
            return sorted.sort((a, b) => parseSize(b.size) - parseSize(a.size));
        case 'size-asc':
            return sorted.sort((a, b) => parseSize(a.size) - parseSize(b.size));
        default:
            return sorted;
    }
}

/**
 * Renders the grid of marketplace assets.
 */
function marketGrid_render(): void {
    const container = document.getElementById('market-grid');
    if (!container) return;

    // 1. Filter by type (including 'installed')
    let filtered = MARKETPLACE_ASSETS.filter(a => {
        if (currentFilter === 'all') return true;
        if (currentFilter === 'installed') return state.installedAssets.includes(a.id);
        return a.type === currentFilter;
    });

    // 2. Filter by search query
    if (currentSearch) {
        filtered = filtered.filter(a =>
            a.name.toLowerCase().includes(currentSearch) ||
            a.description.toLowerCase().includes(currentSearch) ||
            a.author.toLowerCase().includes(currentSearch)
        );
    }

    // 3. Sort
    filtered = marketAssets_sort(filtered, currentSort);

    // 4. Render cards with 5-zone layout: header, title, desc, meta, action
    container.innerHTML = filtered.map(asset => {
        const isInstalled = state.installedAssets.includes(asset.id);
        const isFda = asset.type === 'fda';
        const cardClasses = `market-card${isInstalled ? ' installed' : ''}${isFda ? ' fda' : ''}`;
        return `
            <div class="${cardClasses}" data-id="${asset.id}" onclick="assetDetail_open('${asset.id}')">
                <div class="card-header">
                    <div class="badge">${asset.type.toUpperCase()} v${asset.version}</div>
                    <div class="stars-badge">\u2605 ${asset.stars.toLocaleString()}</div>
                </div>
                <div class="card-title">${asset.name}</div>
                <div class="card-desc">${asset.description}</div>
                <div class="card-meta">
                    <span>BY ${asset.author.toUpperCase()}</span>
                    <span>SIZE: ${asset.size}</span>
                </div>
                <div class="card-action">
                    <button class="install-btn" onclick="event.stopPropagation(); asset_install('${asset.id}', this)">
                        <span class="btn-progress"></span>
                        <span class="btn-text">${isInstalled ? 'INSTALLED' : 'INSTALL'}</span>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    // 5. Update result count
    const countEl = document.getElementById('market-count');
    if (countEl) countEl.textContent = `${filtered.length} ASSETS`;
}

/**
 * Handles installing an asset via the INSTALL button.
 * Shows a filling progress bar animation inside the pill button.
 */
(window as any).asset_install = (id: string, btnElement: HTMLButtonElement) => {
    const asset = MARKETPLACE_ASSETS.find(a => a.id === id);
    if (!asset) return;

    if (state.installedAssets.includes(id)) {
        globals.terminal.println(`\u25CB INFO: ${asset.name} IS ALREADY INSTALLED.`);
        return;
    }

    // Prevent double-clicks
    if (btnElement.classList.contains('installing')) return;

    // Start progress animation
    btnElement.classList.add('installing');
    const textEl = btnElement.querySelector('.btn-text');
    if (textEl) textEl.textContent = 'INSTALLING...';

    globals.terminal.println(`\u25CF INITIATING SECURE INSTALL: [${asset.name.toUpperCase()}]`);
    globals.terminal.println(`\u25CB DOWNLOADING PAYLOAD (${asset.size})...`);

    // Simulate installation with progress (1.5s)
    setTimeout(() => {
        store.installAsset(id);

        // Update button state
        btnElement.classList.remove('installing');
        btnElement.classList.add('installed');
        if (textEl) textEl.textContent = 'INSTALLED';

        globals.terminal.println(`<span class="success">>> SUCCESS: ${asset.name} INSTALLED TO VFS.</span>`);

        // If it was a plugin, remind user how to run it
        if (asset.type === 'plugin') {
            globals.terminal.println(`<span class="dim">   Usage: /usr/local/bin/${asset.name} --help</span>`);
        }

        // Update the card class
        const card = btnElement.closest('.market-card');
        if (card) card.classList.add('installed');

        // Update result count if on installed filter
        const countEl = document.getElementById('market-count');
        if (countEl) {
            const currentCount = parseInt(countEl.textContent || '0');
            // Count stays same, just update if needed
        }
    }, 1500);
};

// ============================================================
// ASSET DETAIL OVERLAY
// ============================================================

let currentDetailAssetId: string | null = null;

/**
 * Opens the asset detail overlay for the given asset ID.
 */
export function assetDetail_open(id: string): void {
    const asset = MARKETPLACE_ASSETS.find(a => a.id === id);
    if (!asset) return;

    currentDetailAssetId = id;

    const overlay = document.getElementById('asset-detail-overlay');
    const panel = overlay?.querySelector('.detail-panel');
    const lcarsFrame = document.getElementById('detail-lcars-frame');
    if (!overlay || !panel || !lcarsFrame) return;

    // Set LCARS hue based on asset type (200=blue, 140=green for FDA)
    const hue = asset.type === 'fda' ? 140 : 200;
    lcarsFrame.style.setProperty('--lcars-hue', String(hue));

    // Set Module Color for floating buttons
    const moduleColor = asset.type === 'fda' ? 'hsl(140, 80%, 50%)' : 'var(--sky)';
    const commandCol = overlay.querySelector('.detail-command-column') as HTMLElement;
    if (commandCol) commandCol.style.setProperty('--module-color', moduleColor);

    // Populate header
    const nameEl = document.getElementById('detail-name');
    const typeBadge = document.getElementById('detail-type-badge');
    const versionEl = document.getElementById('detail-version');
    const starsEl = document.getElementById('detail-stars');
    const authorEl = document.getElementById('detail-author');

    if (nameEl) nameEl.textContent = asset.name;
    if (typeBadge) typeBadge.textContent = asset.type.toUpperCase();
    if (versionEl) versionEl.textContent = asset.version;
    if (starsEl) starsEl.textContent = `\u2605 ${asset.stars.toLocaleString()}`;
    if (authorEl) authorEl.textContent = `BY ${asset.author.toUpperCase()}`;

    // Update install button state
    const installBtn = document.getElementById('detail-install-btn');
    const btnText = installBtn?.querySelector('.btn-text');

    if (installBtn && btnText) {
        const isInstalled = state.installedAssets.includes(id);
        installBtn.classList.toggle('installed', isInstalled);
        btnText.textContent = isInstalled ? 'INSTALLED' : 'INSTALL';
    }

    // Populate description
    const descEl = document.getElementById('detail-description');
    if (descEl) descEl.textContent = asset.description;

    // Populate specifications
    const specType = document.getElementById('detail-spec-type');
    const specVersion = document.getElementById('detail-spec-version');
    const specSize = document.getElementById('detail-spec-size');
    const specLicense = document.getElementById('detail-spec-license');
    const specUpdated = document.getElementById('detail-spec-updated');
    const specDownloads = document.getElementById('detail-spec-downloads');

    if (specType) specType.textContent = asset.type.toUpperCase();
    if (specVersion) specVersion.textContent = asset.version;
    if (specSize) specSize.textContent = asset.size;
    if (specLicense) specLicense.textContent = asset.license;
    if (specUpdated) specUpdated.textContent = asset.updated;
    if (specDownloads) specDownloads.textContent = asset.downloads.toLocaleString();

    // Populate usage
    const usageEl = document.getElementById('detail-usage');
    if (usageEl) {
        usageEl.innerHTML = asset.usage.map(cmd => `<code>$ ${cmd}</code>`).join('');
    }

    // Populate dependencies
    const depsEl = document.getElementById('detail-dependencies');
    if (depsEl) {
        depsEl.innerHTML = asset.dependencies.map(dep => `<li>${dep}</li>`).join('');
    }

    // Populate changelog
    const changelogEl = document.getElementById('detail-changelog');
    if (changelogEl) {
        changelogEl.innerHTML = asset.changelog.map(entry => `
            <div class="changelog-entry">
                <span class="cl-version">${entry.version}</span>
                <span class="cl-date">${entry.date}</span>
                <span class="cl-notes">${entry.notes}</span>
            </div>
        `).join('');
    }

    // Populate related assets
    const relatedEl = document.getElementById('detail-related');
    if (relatedEl) {
        const relatedAssets = asset.related
            .map(rid => MARKETPLACE_ASSETS.find(a => a.id === rid))
            .filter(Boolean) as typeof MARKETPLACE_ASSETS;

        relatedEl.innerHTML = relatedAssets.map(ra => `
            <div class="related-card" onclick="event.stopPropagation(); assetDetail_open('${ra.id}')">
                <div class="related-name">${ra.name}</div>
                <div class="related-type">${ra.type}</div>
            </div>
        `).join('');
    }

    // Show overlay
    overlay.classList.remove('hidden');
}

/**
 * Closes the asset detail overlay.
 */
export function assetDetail_close(): void {
    const overlay = document.getElementById('asset-detail-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
    }
    currentDetailAssetId = null;
}

/**
 * Handles install from the detail overlay.
 */
export function assetDetail_install(): void {
    if (!currentDetailAssetId) return;

    const asset = MARKETPLACE_ASSETS.find(a => a.id === currentDetailAssetId);
    if (!asset) return;

    if (state.installedAssets.includes(currentDetailAssetId)) {
        globals.terminal.println(`\u25CB INFO: ${asset.name} IS ALREADY INSTALLED.`);
        return;
    }

    const installBtn = document.getElementById('detail-install-btn');
    if (!installBtn) return;

    // Prevent double-clicks
    if (installBtn.classList.contains('installing')) return;

    // Start progress animation
    installBtn.classList.add('installing');
    const textEl = installBtn.querySelector('.btn-text');

    if (textEl) textEl.textContent = 'INSTALLING...';

    globals.terminal.println(`\u25CF INITIATING SECURE INSTALL: [${asset.name.toUpperCase()}]`);
    globals.terminal.println(`\u25CB DOWNLOADING PAYLOAD (${asset.size})...`);

    setTimeout(() => {
        store.installAsset(currentDetailAssetId!);

        // Update button state
        installBtn.classList.remove('installing');
        installBtn.classList.add('installed');
        if (textEl) textEl.textContent = 'INSTALLED';

        globals.terminal.println(`<span class="success">>> SUCCESS: ${asset.name} INSTALLED TO VFS.</span>`);

        if (asset.type === 'plugin') {
            globals.terminal.println(`<span class="dim">   Usage: /usr/local/bin/${asset.name} --help</span>`);
        }

        // Also update the card in the grid
        const card = document.querySelector(`.market-card[data-id="${currentDetailAssetId}"]`);
        if (card) {
            card.classList.add('installed');
            const cardBtn = card.querySelector('.install-btn');
            const cardBtnText = cardBtn?.querySelector('.btn-text');
            if (cardBtn) cardBtn.classList.add('installed');
            if (cardBtnText) cardBtnText.textContent = 'INSTALLED';
        }
    }, 1500);
}
