/**
 * @file Marketplace View Logic
 *
 * Handles marketplace UI rendering, filtering, sorting, and search functionality.
 *
 * @module
 */

import { store, state, globals } from '../core/state/store.js';
import { events, Events } from '../core/state/events.js';
import { MARKETPLACE_ASSETS, type MarketplaceAsset } from '../core/data/marketplace.js';
import type { AppState } from '../core/models/types.js';
import { render_assetCard, type AssetCardOptions } from '../ui/components/AssetCard.js';

// ============================================================================
// Window Interface Extension
// ============================================================================

declare global {
    interface Window {
        market_filter: typeof market_filter;
        market_search: typeof market_search;
        market_sort: typeof market_sort;
        assetDetail_open: typeof assetDetail_open;
        assetDetail_close: typeof assetDetail_close;
        assetDetail_install: typeof assetDetail_install;
        asset_install: (id: string, btnElement: HTMLButtonElement) => void;
    }
}

// ============================================================================
// Module State
// ============================================================================

let currentFilter: string = 'all';
let currentSearch: string = '';
let currentSort: string = 'stars-desc';
let currentDetailAssetId: string | null = null;


// ============================================================================
// Initialization
// ============================================================================

/**
 * Initializes the marketplace view.
 * Registers state-change listeners, performs initial render,
 * and exposes marketplace functions to the global window scope.
 */
export function marketplace_initialize(): void {
    events.on(Events.STATE_CHANGED, (s: AppState): void => {
        const overlay: HTMLElement | null = document.getElementById('marketplace-overlay');
        if (overlay) {
            if (s.marketplaceOpen) {
                overlay.classList.remove('hidden', 'closing');
                marketGrid_render();
            } else {
                if (!overlay.classList.contains('hidden')) {
                    overlay.classList.add('closing');
                    overlay.addEventListener('animationend', (): void => {
                        overlay.classList.add('hidden');
                        overlay.classList.remove('closing');
                    }, { once: true });
                }
            }
        }
    });

    marketGrid_render();

    window.market_filter = market_filter;
    window.market_search = market_search;
    window.market_sort = market_sort;
    window.assetDetail_open = assetDetail_open;
    window.assetDetail_close = assetDetail_close;
    window.assetDetail_install = assetDetail_install;
}

// ============================================================================
// Filtering / Sorting / Search
// ============================================================================

/**
 * Filters the marketplace grid by asset type.
 *
 * @param type - The asset type to filter by ('all', 'plugin', 'dataset', 'model', 'annotation', 'installed').
 */
export function market_filter(type: string): void {
    currentFilter = type;

    document.querySelectorAll('.filter-pill').forEach((btn: Element): void => {
        const text: string = btn.textContent?.toLowerCase() || '';
        const isMatch: boolean = (type === 'all' && text === 'all') ||
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
 *
 * @param query - The search query to filter assets by name, description, or author.
 */
export function market_search(query: string): void {
    currentSearch = query.toLowerCase().trim();
    marketGrid_render();
}

/**
 * Sorts the marketplace grid.
 *
 * @param sortBy - The sort order ('stars-desc', 'stars-asc', 'name-asc', 'name-desc', 'size-desc', 'size-asc').
 */
export function market_sort(sortBy: string): void {
    currentSort = sortBy;
    marketGrid_render();
}

/**
 * Parses a size string (e.g., "150 MB") to a numeric value for sorting.
 *
 * @param size - The size string to parse.
 * @returns The numeric size value.
 */
function size_parse(size: string): number {
    const match: RegExpMatchArray | null = size.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
}

/**
 * Sorts an array of marketplace assets by the given criterion.
 *
 * @param assets - The assets to sort.
 * @param sortBy - The sort order key.
 * @returns A new sorted array.
 */
function marketAssets_sort(assets: MarketplaceAsset[], sortBy: string): MarketplaceAsset[] {
    const sorted: MarketplaceAsset[] = [...assets];
    switch (sortBy) {
        case 'stars-desc':
            return sorted.sort((a: MarketplaceAsset, b: MarketplaceAsset): number => b.stars - a.stars);
        case 'stars-asc':
            return sorted.sort((a: MarketplaceAsset, b: MarketplaceAsset): number => a.stars - b.stars);
        case 'name-asc':
            return sorted.sort((a: MarketplaceAsset, b: MarketplaceAsset): number => a.name.localeCompare(b.name));
        case 'name-desc':
            return sorted.sort((a: MarketplaceAsset, b: MarketplaceAsset): number => b.name.localeCompare(a.name));
        case 'size-desc':
            return sorted.sort((a: MarketplaceAsset, b: MarketplaceAsset): number => size_parse(b.size) - size_parse(a.size));
        case 'size-asc':
            return sorted.sort((a: MarketplaceAsset, b: MarketplaceAsset): number => size_parse(a.size) - size_parse(b.size));
        default:
            return sorted;
    }
}

// ============================================================================
// Grid Rendering
// ============================================================================

/**
 * Renders the marketplace grid of asset cards.
 * Applies current filter, search, and sort state before rendering.
 */
function marketGrid_render(): void {
    const container: HTMLElement | null = document.getElementById('market-grid');
    if (!container) return;

    let filtered: MarketplaceAsset[] = MARKETPLACE_ASSETS.filter((a: MarketplaceAsset): boolean => {
        if (currentFilter === 'all') return true;
        if (currentFilter === 'installed') return state.installedAssets.includes(a.id);
        return a.type === currentFilter;
    });

    if (currentSearch) {
        filtered = filtered.filter((a: MarketplaceAsset): boolean =>
            a.name.toLowerCase().includes(currentSearch) ||
            a.description.toLowerCase().includes(currentSearch) ||
            a.author.toLowerCase().includes(currentSearch)
        );
    }

    filtered = marketAssets_sort(filtered, currentSort);

    container.innerHTML = filtered.map((asset: MarketplaceAsset): string => {
        const isInstalled: boolean = state.installedAssets.includes(asset.id);
        
        const opts: AssetCardOptions = {
            id: asset.id,
            type: asset.type,
            title: asset.name,
            description: asset.description,
            metaLeft: `BY ${asset.author.toUpperCase()}`,
            metaRight: `SIZE: ${asset.size}`,
            badgeText: `${asset.type.toUpperCase()} v${asset.version}`,
            badgeRightText: `\u2605 ${asset.stars.toLocaleString()}`,
            isInstalled: isInstalled,
            onClick: `assetDetail_open('${asset.id}')`,
            actionButton: {
                label: 'INSTALL',
                activeLabel: 'INSTALLED',
                onClick: `asset_install('${asset.id}', this)`,
                isActive: isInstalled
            }
        };
        
        return render_assetCard(opts);
    }).join('');

    const countEl: HTMLElement | null = document.getElementById('market-count');
    if (countEl) countEl.textContent = `${filtered.length} ASSETS`;
}

// ============================================================================
// Grid Install Handler
// ============================================================================

/**
 * Handles installing an asset via the grid INSTALL button.
 * Shows a filling progress bar animation inside the pill button.
 *
 * @param id - The marketplace asset ID.
 * @param btnElement - The button element that was clicked.
 */
window.asset_install = (id: string, btnElement: HTMLButtonElement): void => {
    const asset: MarketplaceAsset | undefined = MARKETPLACE_ASSETS.find((a: MarketplaceAsset): boolean => a.id === id);
    if (!asset) return;

    if (state.installedAssets.includes(id)) {
        globals.terminal?.println(`\u25CB INFO: ${asset.name} IS ALREADY INSTALLED.`);
        return;
    }

    if (btnElement.classList.contains('installing')) return;

    btnElement.classList.add('installing');
    const textEl: Element | null = btnElement.querySelector('.btn-text');
    if (textEl) textEl.textContent = 'INSTALLING...';

    globals.terminal?.println(`\u25CF INITIATING SECURE INSTALL: [${asset.name.toUpperCase()}]`);
    globals.terminal?.println(`\u25CB DOWNLOADING PAYLOAD (${asset.size})...`);

    setTimeout((): void => {
        store.asset_install(id);

        btnElement.classList.remove('installing');
        btnElement.classList.add('installed');
        if (textEl) textEl.textContent = 'INSTALLED';

        globals.terminal?.println(`<span class="success">>> SUCCESS: ${asset.name} INSTALLED TO VFS.</span>`);

        if (asset.type === 'plugin') {
            globals.terminal?.println(`<span class="dim">   Usage: /usr/local/bin/${asset.name} --help</span>`);
        }

        const card: Element | null = btnElement.closest('.market-card');
        if (card) card.classList.add('installed');
    }, 1500);
};

// ============================================================================
// Asset Detail Overlay
// ============================================================================

/**
 * Opens the asset detail overlay for the given asset ID.
 * Restores the original marketplace DOM, then populates all detail
 * sections: header, specs, usage, dependencies, changelog, and
 * related assets. Slides in from the right per visual language spec.
 *
 * @param id - The marketplace asset ID.
 */
export function assetDetail_open(id: string): void {
    const asset: MarketplaceAsset | undefined = MARKETPLACE_ASSETS.find((a: MarketplaceAsset): boolean => a.id === id);
    if (!asset) return;

    currentDetailAssetId = id;

    const overlay: HTMLElement | null = document.getElementById('asset-detail-overlay');
    const panel: Element | null | undefined = overlay?.querySelector('.detail-panel');
    const lcarsFrame: HTMLElement | null = document.getElementById('detail-lcars-frame');
    if (!overlay || !panel || !lcarsFrame) return;

    // Set mode to marketplace — CSS hides slot containers, shows originals
    overlay.dataset.mode = 'marketplace';

    detailHeader_populate(asset, id, overlay, lcarsFrame);
    detailSpecs_populate(asset);
    detailContent_populate(asset);

    overlay.classList.remove('hidden', 'closing');
}

/**
 * Populates the detail overlay header: LCARS hue, module color,
 * name, type badge, version, stars, author, and install button.
 *
 * @param asset - The marketplace asset.
 * @param id - The asset ID.
 * @param overlay - The overlay root element.
 * @param lcarsFrame - The LCARS frame element.
 */
function detailHeader_populate(
    asset: MarketplaceAsset,
    id: string,
    overlay: HTMLElement,
    lcarsFrame: HTMLElement
): void {
    const hue: number = asset.type === 'fda' ? 140 : 200;
    lcarsFrame.style.setProperty('--lcars-hue', String(hue));

    const moduleColor: string = asset.type === 'fda' ? 'hsl(140, 80%, 50%)' : 'var(--sky)';
    const commandCol: HTMLElement | null = overlay.querySelector('.detail-command-column') as HTMLElement;
    if (commandCol) commandCol.style.setProperty('--module-color', moduleColor);

    const nameEl: HTMLElement | null = document.getElementById('detail-name');
    const typeBadge: HTMLElement | null = document.getElementById('detail-type-badge');
    const versionEl: HTMLElement | null = document.getElementById('detail-version');
    const starsEl: HTMLElement | null = document.getElementById('detail-stars');
    const authorEl: HTMLElement | null = document.getElementById('detail-author');

    if (nameEl) nameEl.textContent = asset.name;
    if (typeBadge) typeBadge.textContent = asset.type.toUpperCase();
    if (versionEl) versionEl.textContent = asset.version;
    if (starsEl) starsEl.textContent = `\u2605 ${asset.stars.toLocaleString()}`;
    if (authorEl) authorEl.textContent = `BY ${asset.author.toUpperCase()}`;

    const installBtn: HTMLElement | null = document.getElementById('detail-install-btn');
    const btnText: Element | null | undefined = installBtn?.querySelector('.btn-text');

    if (installBtn && btnText) {
        const isInstalled: boolean = state.installedAssets.includes(id);
        installBtn.classList.toggle('installed', isInstalled);
        btnText.textContent = isInstalled ? 'INSTALLED' : 'INSTALL';
    }
}

/**
 * Populates the detail overlay specification fields.
 *
 * @param asset - The marketplace asset.
 */
function detailSpecs_populate(asset: MarketplaceAsset): void {
    const specType: HTMLElement | null = document.getElementById('detail-spec-type');
    const specVersion: HTMLElement | null = document.getElementById('detail-spec-version');
    const specSize: HTMLElement | null = document.getElementById('detail-spec-size');
    const specLicense: HTMLElement | null = document.getElementById('detail-spec-license');
    const specUpdated: HTMLElement | null = document.getElementById('detail-spec-updated');
    const specDownloads: HTMLElement | null = document.getElementById('detail-spec-downloads');

    if (specType) specType.textContent = asset.type.toUpperCase();
    if (specVersion) specVersion.textContent = asset.version;
    if (specSize) specSize.textContent = asset.size;
    if (specLicense) specLicense.textContent = asset.license;
    if (specUpdated) specUpdated.textContent = asset.updated;
    if (specDownloads) specDownloads.textContent = asset.downloads.toLocaleString();
}

/**
 * Populates the detail overlay content sections: description,
 * usage, dependencies, changelog, and related assets.
 *
 * @param asset - The marketplace asset.
 */
function detailContent_populate(asset: MarketplaceAsset): void {
    const descEl: HTMLElement | null = document.getElementById('detail-description');
    if (descEl) descEl.textContent = asset.description;

    const usageEl: HTMLElement | null = document.getElementById('detail-usage');
    if (usageEl) {
        usageEl.innerHTML = asset.usage.map((cmd: string): string => `<code>$ ${cmd}</code>`).join('');
    }

    const depsEl: HTMLElement | null = document.getElementById('detail-dependencies');
    if (depsEl) {
        depsEl.innerHTML = asset.dependencies.map((dep: string): string => `<li>${dep}</li>`).join('');
    }

    const changelogEl: HTMLElement | null = document.getElementById('detail-changelog');
    if (changelogEl) {
        changelogEl.innerHTML = asset.changelog.map((entry: { version: string; date: string; notes: string }): string => `
            <div class="changelog-entry">
                <span class="cl-version">${entry.version}</span>
                <span class="cl-date">${entry.date}</span>
                <span class="cl-notes">${entry.notes}</span>
            </div>
        `).join('');
    }

    const relatedEl: HTMLElement | null = document.getElementById('detail-related');
    if (relatedEl) {
        const relatedAssets: MarketplaceAsset[] = asset.related
            .map((rid: string): MarketplaceAsset | undefined => MARKETPLACE_ASSETS.find((a: MarketplaceAsset): boolean => a.id === rid))
            .filter((a: MarketplaceAsset | undefined): a is MarketplaceAsset => a !== undefined);

        relatedEl.innerHTML = relatedAssets.map((ra: MarketplaceAsset): string => `
            <div class="related-card" onclick="event.stopPropagation(); assetDetail_open('${ra.id}')">
                <div class="related-name">${ra.name}</div>
                <div class="related-type">${ra.type}</div>
            </div>
        `).join('');
    }
}

/**
 * Closes the asset detail overlay with a slide-out animation.
 */
export function assetDetail_close(): void {
    const overlay: HTMLElement | null = document.getElementById('asset-detail-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return;

    // Don't dismiss via background click when in workspace mode
    if (overlay.dataset.workspace === 'true') return;

    overlay.classList.add('closing');
    overlay.addEventListener('animationend', (): void => {
        overlay.classList.add('hidden');
        overlay.classList.remove('closing');
    }, { once: true });

    currentDetailAssetId = null;
}

/**
 * Handles install from the detail overlay.
 * Triggers install animation and updates both the detail button
 * and the corresponding grid card.
 */
export function assetDetail_install(): void {
    if (!currentDetailAssetId) return;

    const asset: MarketplaceAsset | undefined = MARKETPLACE_ASSETS.find((a: MarketplaceAsset): boolean => a.id === currentDetailAssetId);
    if (!asset) return;

    if (state.installedAssets.includes(currentDetailAssetId)) {
        globals.terminal?.println(`\u25CB INFO: ${asset.name} IS ALREADY INSTALLED.`);
        return;
    }

    const installBtn: HTMLElement | null = document.getElementById('detail-install-btn');
    if (!installBtn) return;

    if (installBtn.classList.contains('installing')) return;

    installBtn.classList.add('installing');
    const textEl: Element | null = installBtn.querySelector('.btn-text');

    if (textEl) textEl.textContent = 'INSTALLING...';

    globals.terminal?.println(`\u25CF INITIATING SECURE INSTALL: [${asset.name.toUpperCase()}]`);
    globals.terminal?.println(`\u25CB DOWNLOADING PAYLOAD (${asset.size})...`);

    setTimeout((): void => {
        store.asset_install(currentDetailAssetId!);

        installBtn.classList.remove('installing');
        installBtn.classList.add('installed');
        if (textEl) textEl.textContent = 'INSTALLED';

        globals.terminal?.println(`<span class="success">>> SUCCESS: ${asset.name} INSTALLED TO VFS.</span>`);

        if (asset.type === 'plugin') {
            globals.terminal?.println(`<span class="dim">   Usage: /usr/local/bin/${asset.name} --help</span>`);
        }

        const card: Element | null = document.querySelector(`.market-card[data-id="${currentDetailAssetId}"]`);
        if (card) {
            card.classList.add('installed');
            const cardBtn: Element | null = card.querySelector('.install-btn');
            const cardBtnText: Element | null | undefined = cardBtn?.querySelector('.btn-text');
            if (cardBtn) cardBtn.classList.add('installed');
            if (cardBtnText) cardBtnText.textContent = 'INSTALLED';
        }
    }, 1500);
}
