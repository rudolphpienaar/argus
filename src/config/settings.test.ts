import { describe, it, expect } from 'vitest';
import { SettingsService } from './settings.js';

describe('SettingsService', (): void => {
    it('resolves default convo width when no overrides exist', (): void => {
        const service = new SettingsService();
        expect(service.convoWidth_resolve('rudolph')).toBe(88);
        expect(service.convoWidth_source('rudolph')).toBe('default');
    });

    it('applies user override with clamping', (): void => {
        const service = new SettingsService();
        const setResult = service.set('rudolph', 'convo_width', 200);

        expect(setResult.ok).toBe(true);
        expect(service.convoWidth_resolve('rudolph')).toBe(120);
        expect(service.convoWidth_source('rudolph')).toBe('user');
    });

    it('isolates overrides per user', (): void => {
        const service = new SettingsService();
        service.set('alice', 'convo_width', 72);
        service.set('bob', 'convo_width', 96);

        expect(service.convoWidth_resolve('alice')).toBe(72);
        expect(service.convoWidth_resolve('bob')).toBe(96);
    });

    it('supports unsetting user override', (): void => {
        const service = new SettingsService();
        service.set('rudolph', 'convo_width', 70);
        expect(service.convoWidth_resolve('rudolph')).toBe(70);

        service.unset('rudolph', 'convo_width');
        expect(service.convoWidth_resolve('rudolph')).toBe(88);
    });

    it('rejects invalid values', (): void => {
        const service = new SettingsService();
        const result = service.set('rudolph', 'convo_width', 'nope');
        expect(result.ok).toBe(false);
    });
});
