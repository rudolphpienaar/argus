import { describe, it, expect } from 'vitest';
import {
    controlPlaneIntent_resolve,
    type ControlScriptDescriptor,
    type ControlPlaneIntent
} from './ControlPlaneRouter.js';

const SCRIPTS: ReadonlyArray<ControlScriptDescriptor> = [
    { id: 'hist-harmonize', aliases: ['harmonize-fast', 'hist_harmonize'] },
    { id: 'hist-train', aliases: ['hist', 'train-hist'] },
    { id: 'hist-review', aliases: ['hist'] }
];

describe('ControlPlaneRouter', () => {
    it('routes power-script list requests to scripts_list', () => {
        const intent: ControlPlaneIntent = controlPlaneIntent_resolve(
            'OK, do you have power scripts?',
            SCRIPTS
        );

        expect(intent).toEqual({ plane: 'control', action: 'scripts_list' });
    });

    it('routes NL run request with script id to script_run', () => {
        const intent: ControlPlaneIntent = controlPlaneIntent_resolve(
            'Can you run the hist-harmonize for me?',
            SCRIPTS
        );

        expect(intent).toEqual({
            plane: 'control',
            action: 'script_run',
            scriptRef: 'hist-harmonize',
            dryRun: false
        });
    });

    it('detects dry-run intent from lexical cues', () => {
        const intent: ControlPlaneIntent = controlPlaneIntent_resolve(
            'please run hist-harmonize dry preview',
            SCRIPTS
        );

        expect(intent).toEqual({
            plane: 'control',
            action: 'script_run',
            scriptRef: 'hist-harmonize',
            dryRun: true
        });
    });

    it('routes detail queries with script id to script_show', () => {
        const intent: ControlPlaneIntent = controlPlaneIntent_resolve(
            'show me details about hist-harmonize script',
            SCRIPTS
        );

        expect(intent).toEqual({
            plane: 'control',
            action: 'script_show',
            scriptRef: 'hist-harmonize'
        });
    });

    it('returns ambiguous run intent when multiple scripts match', () => {
        const intent: ControlPlaneIntent = controlPlaneIntent_resolve(
            'run hist',
            SCRIPTS
        );

        expect(intent).toEqual({
            plane: 'control',
            action: 'script_run_ambiguous',
            candidates: ['hist-review', 'hist-train'],
            dryRun: false
        });
    });

    it('falls through to conversation for non-script requests', () => {
        const intent: ControlPlaneIntent = controlPlaneIntent_resolve(
            'what workflows do you have?',
            SCRIPTS
        );

        expect(intent).toEqual({ plane: 'conversation' });
    });
});

