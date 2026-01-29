/**
 * @file Event Bus
 * 
 * Lightweight, type-safe Event Emitter for the Pub/Sub architecture.
 * 
 * @module
 */

import type { AppState, Dataset, Project } from '../models/types.js';
import type { VfsChangeEvent, CwdChangeEvent } from '../../vfs/types.js';

// Event Types
export enum Events {
    STATE_CHANGED = 'STATE_CHANGED',
    STAGE_CHANGED = 'STAGE_CHANGED',
    DATASET_SELECTION_CHANGED = 'DATASET_SELECTION_CHANGED',
    PROJECT_LOADED = 'PROJECT_LOADED',
    VFS_UPDATED = 'VFS_UPDATED',
    VFS_CHANGED = 'VFS_CHANGED',
    CWD_CHANGED = 'CWD_CHANGED'
}

// Payload Definitions
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

class EventEmitter {
    private listeners: { [K in Events]?: Callback<EventPayloads[K]>[] } = {};

    public on<K extends Events>(event: K, callback: Callback<EventPayloads[K]>): void {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event]!.push(callback);
    }

    public off<K extends Events>(event: K, callback: Callback<EventPayloads[K]>): void {
        if (!this.listeners[event]) return;
        this.listeners[event] = (this.listeners[event] as Callback<EventPayloads[K]>[]).filter(cb => cb !== callback) as any;
    }

    public emit<K extends Events>(event: K, payload: EventPayloads[K]): void {
        if (!this.listeners[event]) return;
        this.listeners[event]!.forEach(callback => callback(payload));
    }
}

// Global Event Bus Instance
export const events = new EventEmitter();
