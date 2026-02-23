/**
 * @file Runtime Settings Service
 *
 * User-scoped runtime settings manager with central validation and
 * deterministic precedence (user override > env > defaults).
 *
 * @module
 */

export interface UserSettings {
    convo_width?: number;
}

export type SettingsKey = keyof UserSettings;

export interface ResolvedUserSettings {
    convo_width: number;
}

export type SettingSource = 'user' | 'env' | 'default';

interface NumericBounds {
    min: number;
    max: number;
}

export class SettingsService {
    private static singleton: SettingsService | null = null;
    private readonly byUser: Map<string, UserSettings> = new Map();
    private readonly defaults: ResolvedUserSettings = {
        convo_width: 88,
    };
    private readonly bounds: Record<SettingsKey, NumericBounds> = {
        convo_width: { min: 60, max: 120 },
    };

    /**
     * Resolve process-global singleton.
     */
    public static instance_get(): SettingsService {
        if (!SettingsService.singleton) {
            SettingsService.singleton = new SettingsService();
        }
        return SettingsService.singleton;
    }

    /**
     * Return effective settings for a given user.
     */
    public snapshot(user: string): ResolvedUserSettings {
        return {
            convo_width: this.convoWidth_resolve(user),
        };
    }

    /**
     * Return currently persisted user overrides (without env/default resolution).
     */
    public userSettings_get(user: string): UserSettings {
        const key: string = this.userKey_normalize(user);
        return { ...(this.byUser.get(key) || {}) };
    }

    /**
     * Set one user-scoped setting with validation.
     */
    public set(user: string, key: SettingsKey, value: unknown): { ok: true; value: number } | { ok: false; error: string } {
        if (key !== 'convo_width') {
            return { ok: false, error: `Unknown setting key: ${String(key)}` };
        }

        const parsed: number = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
        if (!Number.isFinite(parsed)) {
            return { ok: false, error: `Invalid value for ${key}: ${String(value)}` };
        }

        const clamped: number = this.value_clamp(key, Math.round(parsed));
        const userKey: string = this.userKey_normalize(user);
        const next: UserSettings = { ...(this.byUser.get(userKey) || {}) };
        next[key] = clamped;
        this.byUser.set(userKey, next);
        return { ok: true, value: clamped };
    }

    /**
     * Remove one user-scoped override.
     */
    public unset(user: string, key: SettingsKey): void {
        const userKey: string = this.userKey_normalize(user);
        const current: UserSettings | undefined = this.byUser.get(userKey);
        if (!current) return;

        const next: UserSettings = { ...current };
        delete next[key];

        if (Object.keys(next).length === 0) {
            this.byUser.delete(userKey);
            return;
        }
        this.byUser.set(userKey, next);
    }

    /**
     * Resolve effective conversational wrap width for one user.
     */
    public convoWidth_resolve(user: string): number {
        const userOverride: number | undefined = this.userSettings_get(user).convo_width;
        if (typeof userOverride === 'number') {
            return this.value_clamp('convo_width', userOverride);
        }

        const envOverride: number | undefined = this.envNumeric_resolve('CALYPSO_CONVO_WIDTH');
        if (typeof envOverride === 'number') {
            return this.value_clamp('convo_width', envOverride);
        }

        return this.defaults.convo_width;
    }

    /**
     * Resolve source of effective conversational wrap width.
     */
    public convoWidth_source(user: string): SettingSource {
        const userOverride: number | undefined = this.userSettings_get(user).convo_width;
        if (typeof userOverride === 'number') return 'user';
        if (typeof this.envNumeric_resolve('CALYPSO_CONVO_WIDTH') === 'number') return 'env';
        return 'default';
    }

    private envNumeric_resolve(key: string): number | undefined {
        const envRaw: string | undefined = (globalThis as { process?: { env?: Record<string, string | undefined> } })
            .process?.env?.[key];
        if (!envRaw) return undefined;

        const parsed: number = Number.parseInt(envRaw, 10);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    private userKey_normalize(user: string): string {
        const normalized: string = user.trim().toLowerCase();
        return normalized || 'developer';
    }

    private value_clamp(key: SettingsKey, value: number): number {
        const bounds: NumericBounds = this.bounds[key];
        return Math.max(bounds.min, Math.min(bounds.max, value));
    }
}
