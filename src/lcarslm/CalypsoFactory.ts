/**
 * @file Calypso Factory
 *
 * Dependency injection and instantiation orchestrator for CalypsoCore.
 * Provides standard configurations for Production, Development, and Testing.
 *
 * @module lcarslm/CalypsoFactory
 */

import { CalypsoCore } from './CalypsoCore.js';
import type { CalypsoCoreConfig, CalypsoStoreActions } from './types.js';
import type { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import type { Shell } from '../vfs/Shell.js';
import { TelemetryBus } from './TelemetryBus.js';
import { SettingsService } from '../config/settings.js';

/**
 * Factory for creating CalypsoCore instances with standard dependency bags.
 */
export class CalypsoFactory {
    /**
     * Create a standard production-grade CalypsoCore instance.
     * 
     * @param vfs - The Virtual File System.
     * @param shell - The VCS Shell.
     * @param storeActions - Global store mutations.
     * @param config - Instance-specific overrides.
     * @returns Fully initialized CalypsoCore.
     */
    public static create(
        vfs: VirtualFileSystem,
        shell: Shell,
        storeActions: CalypsoStoreActions,
        config: CalypsoCoreConfig = {}
    ): CalypsoCore {
        return new CalypsoCore(vfs, shell, storeActions, {
            telemetryBus: new TelemetryBus(),
            settingsService: SettingsService.instance_get(),
            ...config
        });
    }

    /**
     * Create a mock CalypsoCore for testing environments.
     * 
     * @param vfs - Mock VFS.
     * @param shell - Mock Shell.
     * @param storeActions - Mock Store actions.
     * @returns Stripped-down CalypsoCore.
     */
    public static createTest(
        vfs: VirtualFileSystem,
        shell: Shell,
        storeActions: CalypsoStoreActions
    ): CalypsoCore {
        return new CalypsoCore(vfs, shell, storeActions, {
            enableIntentGuardrails: false,
            knowledge: {}
        });
    }
}
