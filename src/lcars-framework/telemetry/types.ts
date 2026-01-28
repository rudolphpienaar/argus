/**
 * @file Telemetry Types
 * Defines the contracts for the reusable telemetry system.
 */

/**
 * A Generator is responsible for producing data for a telemetry display.
 * It is pure logic and does not touch the DOM.
 */
export interface TelemetryGenerator<T> {
    /**
     * Produces the next set of data based on a tick cycle.
     */
    generate(cycle: number, context?: any): T;
}

/**
 * A Renderer is responsible for taking data and updating a UI element.
 */
export interface TelemetryRenderer<T> {
    /**
     * Renders the provided data into the target element.
     */
    render(data: T, element: HTMLElement): void;
}

/**
 * A registered telemetry entry in the service.
 */
export interface TelemetryRegistryEntry {
    id: string;
    generator: TelemetryGenerator<any>;
    renderer: TelemetryRenderer<any>;
    targetId: string;
}
