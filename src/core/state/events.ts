/**
 * @file Event Bus
 *
 * Lightweight, type-safe Event Emitter for the Pub/Sub architecture.
 *
 * @module
 */

import type { AppState, Dataset, Project } from '../models/types.js';
import type { VfsChangeEvent, CwdChangeEvent } from '../../vfs/types.js';

/** All application event types. */
export enum Events {
    STATE_CHANGED = 'STATE_CHANGED',
    STAGE_CHANGED = 'STAGE_CHANGED',
    DATASET_SELECTION_CHANGED = 'DATASET_SELECTION_CHANGED',
    PROJECT_LOADED = 'PROJECT_LOADED',
    VFS_UPDATED = 'VFS_UPDATED',
    VFS_CHANGED = 'VFS_CHANGED',
    CWD_CHANGED = 'CWD_CHANGED'
}

/** Maps each event type to its payload type. */
export interface EventPayloads {
    [Events.STATE_CHANGED]: AppState;
    [Events.STAGE_CHANGED]: AppState['currentStage'];
    [Events.DATASET_SELECTION_CHANGED]: Dataset[];
    [Events.PROJECT_LOADED]: Project | null;
    [Events.VFS_UPDATED]: void;
    [Events.VFS_CHANGED]: VfsChangeEvent;
    [Events.CWD_CHANGED]: CwdChangeEvent;
}

type Callback<T> = (payload: T) => void;

/**
 * Simple typed event emitter for publish/subscribe communication
 * between decoupled application modules.
 */
class EventEmitter {
    private listeners: { [K in Events]?: Callback<EventPayloads[K]>[] } = {};

    /**
     * Subscribes a callback to an event.
     *
     * @param event - The event type.
     * @param callback - The handler to invoke when the event fires.
     */
    public on<K extends Events>(event: K, callback: Callback<EventPayloads[K]>): void {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event]!.push(callback);
    }

    /**
     * Unsubscribes a callback from an event.
     *
     * @param event - The event type.
     * @param callback - The handler to remove.
     */
    public off<K extends Events>(event: K, callback: Callback<EventPayloads[K]>): void {
        const list: Callback<EventPayloads[K]>[] | undefined = this.listeners[event] as Callback<EventPayloads[K]>[] | undefined;
        if (!list) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TS cannot unify mapped-type indexed write
        (this.listeners[event] as Callback<EventPayloads[K]>[]) = list.filter(
            (cb: Callback<EventPayloads[K]>): boolean => cb !== callback
        );
    }

    /**
     * Emits an event to all registered listeners.
     *
     * @param event - The event type.
     * @param payload - The event payload.
     */
    public emit<K extends Events>(event: K, payload: EventPayloads[K]): void {
        if (!this.listeners[event]) return;
        this.listeners[event]!.forEach((callback: Callback<EventPayloads[K]>): void => callback(payload));
    }
}

/** Global Event Bus Instance. */
export const events: EventEmitter = new EventEmitter();
