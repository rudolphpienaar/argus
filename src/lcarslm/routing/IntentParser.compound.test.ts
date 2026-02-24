import { describe, it, expect } from 'vitest';
import { IntentParser } from './IntentParser.js';
import { SearchProvider } from '../SearchProvider.js';
import { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import { Shell } from '../../vfs/Shell.js';
import type { CalypsoStoreActions, AppState } from '../types.js';

import { IntentGuard, IntentGuardMode } from './IntentGuard.js';

function storeActions_mock(): CalypsoStoreActions {
    return {
        state_get: () => ({}),
        state_set: () => {},
        reset: () => {},
        dataset_select: () => {},
        dataset_deselect: () => {},
        datasets_getSelected: () => [],
        project_getActive: () => null,
        project_getActiveFull: () => null,
        project_setActive: () => {},
        stage_set: () => {},
        session_getPath: () => null,
        session_setPath: () => {},
        sessionId_get: () => null,
        session_start: () => {},
        dataset_getById: () => undefined,
        lastMentioned_set: () => {},
        lastMentioned_get: () => []
    };
}

function parser_create(commands: string[]): IntentParser {
    const vfs = new VirtualFileSystem('tester');
    const shell = new Shell(vfs, 'tester');
    const searchProvider = new SearchProvider(vfs, shell, storeActions_mock());
    const guard = new IntentGuard({ mode: IntentGuardMode.EXPERIMENTAL });
    
    return new IntentParser(searchProvider, storeActions_mock(), guard, {
        activeStageId_get: () => 'train',
        stage_forCommand: (cmd) => ({ id: 'train', commands: ['python train.py', 'train'] }),
        commands_list: () => commands,
        systemCommands_list: () => ['status', 'settings', 'workflows', 'version', 'reset', 'snapshot', 'state', 'session', 'help', 'key'],
        readyCommands_list: () => commands
    });
}

describe('IntentParser Compound Commands', () => {
    it('should resolve exact multi-word workflow commands', async () => {
        const parser = parser_create(['python train.py', 'train']);
        const intent = await parser.intent_resolve('python train.py');

        expect(intent.type).toBe('workflow');
        expect(intent.command).toBe('python train.py');
        expect(intent.args).toEqual([]);
        expect(intent.isModelResolved).toBe(false);
    });

    it('should resolve multi-word workflow commands with arguments', async () => {
        const parser = parser_create(['show container', 'containerize']);
        const intent = await parser.intent_resolve('show container details');

        expect(intent.type).toBe('workflow');
        expect(intent.command).toBe('show container');
        expect(intent.args).toEqual(['details']);
        expect(intent.isModelResolved).toBe(false);
    });

    it('should still resolve single-word commands', async () => {
        const parser = parser_create(['python train.py', 'train']);
        const intent = await parser.intent_resolve('train');

        expect(intent.type).toBe('workflow');
        expect(intent.command).toBe('train');
        expect(intent.args).toEqual([]);
        expect(intent.isModelResolved).toBe(false);
    });

    it('should resolve system commands to special intent', async () => {
        const parser = parser_create([]);
        const intent = await parser.intent_resolve('/settings show');

        expect(intent.type).toBe('special');
        expect(intent.command).toBe('settings');
        expect(intent.args).toEqual(['show']);
        expect(intent.isModelResolved).toBe(false);
    });
});
