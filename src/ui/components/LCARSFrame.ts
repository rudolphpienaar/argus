/**
 * @file LCARS Frame Procedural Generator
 * @description Creates LCARS UI frames with configurable panels, colors, and layouts.
 *
 * LCARS frames consist of:
 * - An elbow (curved corner piece)
 * - A top bar (horizontal header)
 * - A sidebar (vertical stack of panels)
 * - A content area (open on right/bottom edges)
 *
 * Colors are defined by HSL hue, with automatic shade variations.
 */

// ============================================================
// TYPES
// ============================================================

export interface LCARSPanelConfig {
    id: string;
    label: string;
    shade?: 1 | 2 | 3 | 4;  // 1=lightest, 4=darkest
}

export interface LCARSFrameConfig {
    /** Base hue (0-360): 200=blue, 30=orange, 140=green */
    hue: number;
    /** Sidebar panels configuration */
    panels: LCARSPanelConfig[];
    /** Optional: Top bar content (HTML string or element) */
    topBarContent?: string | HTMLElement;
    /** Optional: Main content (HTML string or element) */
    content?: string | HTMLElement;
    /** Optional: Frame position affects corner radii */
    position?: 'left' | 'right';
    /** Optional: Custom CSS class for the frame */
    className?: string;
    /** Optional: Elbow size in pixels */
    elbowSize?: number;
    /** Optional: Panel gap in pixels */
    gap?: number;
}

export interface LCARSFrameElements {
    frame: HTMLElement;
    elbow: HTMLElement;
    topBar: HTMLElement;
    sidebar: HTMLElement;
    panels: HTMLElement[];
    content: HTMLElement;
}

// ============================================================
// LCARS FRAME GENERATOR
// ============================================================

/**
 * Creates a complete LCARS frame with elbow, top bar, sidebar, and content area.
 *
 * @example
 * const frame = lcarsFrame_create({
 *     hue: 200,  // blue
 *     panels: [
 *         { id: 'overview', label: 'OVERVIEW', shade: 1 },
 *         { id: 'specs', label: 'SPECS', shade: 2 },
 *         { id: 'usage', label: 'USAGE', shade: 3 },
 *     ],
 *     topBarContent: '<h1>Asset Name</h1>',
 *     content: '<p>Main content here...</p>'
 * });
 * document.body.appendChild(frame.frame);
 */
export function lcarsFrame_create(config: LCARSFrameConfig): LCARSFrameElements {
    const {
        hue,
        panels,
        topBarContent = '',
        content = '',
        position = 'left',
        className = '',
        elbowSize = 30,
        gap = 3
    } = config;

    // Create main frame container
    const frame = document.createElement('div');
    frame.className = `lcars-frame ${className}`.trim();
    frame.style.setProperty('--lcars-hue', String(hue));
    frame.style.setProperty('--lcars-elbow-size', `${elbowSize}px`);
    frame.style.setProperty('--lcars-gap', `${gap}px`);

    // Create elbow (curved corner piece)
    const elbow = document.createElement('div');
    elbow.className = 'lcars-elbow';

    // Create top bar
    const topBar = document.createElement('div');
    topBar.className = 'lcars-top-bar';
    if (typeof topBarContent === 'string') {
        topBar.innerHTML = topBarContent;
    } else if (topBarContent instanceof HTMLElement) {
        topBar.appendChild(topBarContent);
    }

    // Create sidebar with panels
    const sidebar = document.createElement('div');
    sidebar.className = 'lcars-sidebar';

    const panelElements: HTMLElement[] = [];
    panels.forEach((panelConfig, index) => {
        const panel = lcarsPanel_create(panelConfig, index, panels.length);
        panelElements.push(panel);
        sidebar.appendChild(panel);
    });

    // Create content area
    const contentArea = document.createElement('div');
    contentArea.className = 'lcars-content';
    if (typeof content === 'string') {
        contentArea.innerHTML = content;
    } else if (content instanceof HTMLElement) {
        contentArea.appendChild(content);
    }

    // Assemble frame
    frame.appendChild(elbow);
    frame.appendChild(topBar);
    frame.appendChild(sidebar);
    frame.appendChild(contentArea);

    return {
        frame,
        elbow,
        topBar,
        sidebar,
        panels: panelElements,
        content: contentArea
    };
}

/**
 * Creates a single LCARS panel element.
 */
function lcarsPanel_create(
    config: LCARSPanelConfig,
    index: number,
    totalPanels: number
): HTMLElement {
    const panel = document.createElement('a');
    panel.className = 'lcars-panel';
    panel.href = `#${config.id}`;
    panel.textContent = config.label;
    panel.dataset.panelId = config.id;

    // Set shade (cycle through 1-4 if not specified)
    const shade = config.shade ?? ((index % 4) + 1);
    panel.dataset.shade = String(shade);

    // First panel gets top-left corner
    if (index === 0) {
        panel.classList.add('lcars-corner-tl');
    }

    // Last panel gets bottom-left corner
    if (index === totalPanels - 1) {
        panel.classList.add('lcars-corner-bl');
    }

    return panel;
}

// ============================================================
// LCARS TOP BAR GENERATOR
// ============================================================

export interface LCARSTopBarConfig {
    hue: number;
    segments: LCARSTopBarSegment[];
    gap?: number;
}

export interface LCARSTopBarSegment {
    content: string | HTMLElement;
    flex?: number;  // flex-grow value
    shade?: 1 | 2 | 3 | 4;
    className?: string;
}

/**
 * Creates a segmented LCARS top bar.
 */
export function lcarsTopBar_create(config: LCARSTopBarConfig): HTMLElement {
    const { hue, segments, gap = 3 } = config;

    const bar = document.createElement('div');
    bar.className = 'lcars-top-bar-segmented';
    bar.style.setProperty('--lcars-hue', String(hue));
    bar.style.setProperty('--lcars-gap', `${gap}px`);

    segments.forEach((segConfig, index) => {
        const segment = document.createElement('div');
        segment.className = `lcars-bar-segment ${segConfig.className || ''}`.trim();
        segment.dataset.shade = String(segConfig.shade ?? ((index % 4) + 1));

        if (segConfig.flex !== undefined) {
            segment.style.flex = String(segConfig.flex);
        }

        if (typeof segConfig.content === 'string') {
            segment.innerHTML = segConfig.content;
        } else {
            segment.appendChild(segConfig.content);
        }

        bar.appendChild(segment);
    });

    return bar;
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Sets the active panel in an LCARS sidebar.
 */
export function lcarsSidebar_setActive(sidebar: HTMLElement, panelId: string): void {
    sidebar.querySelectorAll<HTMLElement>('.lcars-panel').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.panelId === panelId);
    });
}

/**
 * Updates the hue of an existing LCARS frame.
 */
export function lcarsFrame_setHue(frame: HTMLElement, hue: number): void {
    frame.style.setProperty('--lcars-hue', String(hue));
}

/**
 * Predefined hue values for common LCARS color schemes.
 */
export const LCARS_HUES = {
    BLUE: 200,
    SKY: 200,
    ORANGE: 30,
    GREEN: 140,
    FDA: 140,
    PURPLE: 270,
    NEBULA: 280,
    RED: 0,
    MARS: 0,
    GOLD: 45,
} as const;

// ============================================================
// WINDOW EXPORTS
// ============================================================

// Expose to window for HTML onclick handlers
(window as any).lcarsFrame_create = lcarsFrame_create;
(window as any).lcarsTopBar_create = lcarsTopBar_create;
(window as any).lcarsSidebar_setActive = lcarsSidebar_setActive;
(window as any).lcarsFrame_setHue = lcarsFrame_setHue;
(window as any).LCARS_HUES = LCARS_HUES;
