/**
 * @file Asset Card Component
 *
 * Reusable LCARS-style card component for displaying assets, projects,
 * and datasets in a grid layout. Used by Marketplace and Search/Landing stages.
 *
 * @module
 */

export interface AssetCardOptions {
    id: string;
    type: string; // e.g., 'plugin', 'dataset', 'project', 'model'
    title: string;
    description: string;
    metaLeft: string; // e.g., "BY AUTHOR"
    metaRight: string; // e.g., "SIZE: 150MB"
    badgeText: string; // e.g., "PLUGIN v1.0"
    badgeRightText?: string; // e.g., "★ 500" (Optional)
    isInstalled?: boolean; // Applies 'installed' styling class
    onClick: string; // Global function call string e.g. "assetDetail_open('id')"
    actionButton?: {
        label: string; // Initial label e.g. "INSTALL"
        activeLabel?: string; // Label when active e.g. "INSTALLED"
        onClick: string; // Global function call string
        isActive?: boolean; // Toggles active state class
    };
}

/**
 * Renders an LCARS asset card HTML string.
 *
 * @param opts - Configuration options for the card.
 * @returns HTML string for the card.
 */
export function render_assetCard(opts: AssetCardOptions): string {
    const isFda: boolean = opts.type === 'fda';
    const cardClasses: string = `market-card${opts.isInstalled ? ' installed' : ''}${isFda ? ' fda' : ''}`;
    
    let actionHtml = '';
    if (opts.actionButton) {
        const label = opts.actionButton.isActive ? (opts.actionButton.activeLabel || opts.actionButton.label) : opts.actionButton.label;
        const btnClass = opts.actionButton.isActive ? 'install-btn installed' : 'install-btn';
        
        actionHtml = `
            <div class="card-action">
                <button class="${btnClass}" onclick="event.stopPropagation(); ${opts.actionButton.onClick}">
                    <span class="btn-progress"></span>
                    <span class="btn-text">${label}</span>
                </button>
            </div>
        `;
    }

    return `
        <div class="${cardClasses}" data-id="${opts.id}" onclick="${opts.onClick}">
            <div class="card-header">
                <div class="badge">${opts.badgeText}</div>
                ${opts.badgeRightText ? `<div class="stars-badge">${opts.badgeRightText}</div>` : ''}
            </div>
            <div class="card-title">${opts.title}</div>
            <div class="card-desc">${opts.description}</div>
            <div class="card-meta">
                <span>${opts.metaLeft}</span>
                <span>${opts.metaRight}</span>
            </div>
            ${actionHtml}
        </div>
    `;
}
