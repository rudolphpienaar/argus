/**
 * @file Process Federation Network Layer
 *
 * Renders and prepares animated SVG links between the hub and site nodes.
 *
 * @module core/stages/process/federation/network
 */

import type { TrustedDomainNode } from '../../../models/types.js';

/**
 * Initialize the network SVG layer for federation distribution animation.
 *
 * @param nodes - Trusted domain node list.
 * @param container - Spoke container element.
 */
export function federationNetwork_initialize(nodes: TrustedDomainNode[], container: HTMLElement): void {
    networkSvg_clear(container);

    const overlay: Element | null = container.closest('.federation-overlay');
    if (!overlay) {
        return;
    }

    const hubIcon: Element | null = overlay.querySelector('.factory-icon');
    if (!hubIcon) {
        console.warn('ARGUS: Factory icon not found in federation overlay.');
        return;
    }

    const svg: SVGSVGElement = networkSvg_create();
    const hubCenter: Point = center_resolve(hubIcon, container);

    nodes.forEach((_node: TrustedDomainNode, index: number): void => {
        const nodeIcon: HTMLElement | null = document.getElementById(`node-icon-${index}`);
        if (!nodeIcon) {
            return;
        }
        const nodeCenter: Point = center_resolve(nodeIcon, container);
        svg.appendChild(line_create(hubCenter, nodeCenter, index));
    });

    container.prepend(svg);
}

interface Point {
    x: number;
    y: number;
}

/**
 * Remove existing network SVG from container.
 */
function networkSvg_clear(container: HTMLElement): void {
    const existingSvg: SVGElement | null = container.querySelector('svg');
    existingSvg?.remove();
}

/**
 * Create base SVG layer element.
 */
function networkSvg_create(): SVGSVGElement {
    const svgNamespace: string = 'http://www.w3.org/2000/svg';
    const svg: SVGSVGElement = document.createElementNS(svgNamespace, 'svg') as SVGSVGElement;
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '0';
    return svg;
}

/**
 * Resolve center point of an element in a container-relative coordinate space.
 */
function center_resolve(element: Element, container: HTMLElement): Point {
    const rect: DOMRect = element.getBoundingClientRect();
    const containerRect: DOMRect = container.getBoundingClientRect();
    return {
        x: rect.left + rect.width / 2 - containerRect.left,
        y: rect.top + rect.height / 2 - containerRect.top,
    };
}

/**
 * Create one hidden SVG line prepared for dash-offset reveal animation.
 */
function line_create(hubCenter: Point, nodeCenter: Point, index: number): SVGLineElement {
    const svgNamespace: string = 'http://www.w3.org/2000/svg';
    const line: SVGLineElement = document.createElementNS(svgNamespace, 'line') as SVGLineElement;

    line.setAttribute('x1', hubCenter.x.toString());
    line.setAttribute('y1', hubCenter.y.toString());
    line.setAttribute('x2', nodeCenter.x.toString());
    line.setAttribute('y2', nodeCenter.y.toString());
    line.setAttribute('stroke', 'var(--orange)');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('id', `fed-line-${index}`);

    const length: number = Math.sqrt(
        Math.pow(nodeCenter.x - hubCenter.x, 2) + Math.pow(nodeCenter.y - hubCenter.y, 2),
    );

    line.style.strokeDasharray = `${length}`;
    line.style.strokeDashoffset = `${length}`;
    line.style.transition = 'stroke-dashoffset 1s ease-out';
    return line;
}
