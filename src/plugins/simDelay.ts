/**
 * @file Plugin simulation delay helpers.
 *
 * Owns plugin-level latency simulation policy. The host runtime does not
 * impose synthetic timing; plugins opt into delay as needed.
 *
 * @module plugins/simDelay
 */

/**
 * Check whether plugin simulation delay should be skipped.
 *
 * @returns True when CALYPSO_FAST=true.
 */
export function simDelayFast_check(): boolean {
    const env: Record<string, string | undefined> | undefined =
        (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    return env?.CALYPSO_FAST === 'true';
}

/**
 * Wait for a simulated duration unless fast mode is enabled.
 *
 * @param ms - Milliseconds to wait.
 */
export async function simDelay_wait(ms: number): Promise<void> {
    if (simDelayFast_check()) {
        return;
    }
    await new Promise<void>((resolve): void => {
        setTimeout(resolve, ms);
    });
}
