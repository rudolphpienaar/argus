/**
 * @file Workflow Tracker Component
 * 
 * Procedurally generates a sequence of "stations" (e.g., SeaGaP) with
 * connectors and telemetry placeholders.
 */

export interface WorkflowStation {
    id: string;
    label: string;
    hasTelemetry?: boolean;
}

export interface WorkflowOptions {
    elementId: string;
    stations: WorkflowStation[];
    onStationClick?: (stationId: string) => void;
}

export class WorkflowTracker {
    private container: HTMLElement;

    constructor(options: WorkflowOptions) {
        const { elementId, stations, onStationClick } = options;
        
        const el = document.getElementById(elementId);
        if (!el) throw new Error(`Workflow container ${elementId} not found`);
        this.container = el;

        this.render(stations, onStationClick);
    }

    private render(stations: WorkflowStation[], onClick?: (id: string) => void): void {
        const wrapper = document.createElement('div');
        wrapper.className = 'seagap-stations';

        stations.forEach((station, index) => {
            // Create station element
            const stationEl = document.createElement('div');
            stationEl.className = 'station';
            stationEl.id = `station-${station.id}`;
            
            if (onClick) {
                stationEl.style.cursor = 'pointer';
                stationEl.addEventListener('click', () => onClick(station.id));
            }

            stationEl.innerHTML = `
                <div class="station-header">
                    <div class="station-circle"></div>
                    <div class="station-label">${station.label}</div>
                </div>
                ${station.hasTelemetry ? `
                    <div class="station-telemetry" id="tele-${station.id}">
                        <div class="tele-content monospace"></div>
                    </div>
                ` : ''}
            `;

            wrapper.appendChild(stationEl);

            // Add connector line if not the last station
            if (index < stations.length - 1) {
                const line = document.createElement('div');
                line.className = 'station-line';
                wrapper.appendChild(line);
            }
        });

        this.container.innerHTML = '';
        this.container.appendChild(wrapper);
    }

    /**
     * Updates the visual state of a station.
     */
    public setStationState(stationId: string, state: 'active' | 'visited' | 'idle'): void {
        const el = document.getElementById(`station-${stationId}`);
        if (!el) return;

        el.classList.remove('active', 'visited');
        if (state !== 'idle') {
            el.classList.add(state);
        }
    }
}
