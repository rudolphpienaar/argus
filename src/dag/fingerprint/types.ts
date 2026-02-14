/**
 * @file DAG Fingerprint Type Definitions
 *
 * Types for the Merkle fingerprint chain that enables staleness
 * detection across the DAG. Each stage's artifact carries a fingerprint
 * that is a function of its own content and all ancestor fingerprints.
 *
 * Content-addressed (hash comparison), not timestamp-based. Re-running
 * a stage with identical output produces the same fingerprint and does
 * not force a downstream cascade.
 *
 * @module dag/fingerprint
 * @see docs/dag-engine.adoc
 */

// ─── Fingerprint Record ─────────────────────────────────────────

/**
 * A fingerprint record as stored inside an artifact envelope.
 *
 * The fingerprint combines the artifact's own content hash with the
 * fingerprints of all parent artifacts at the time this artifact was
 * created.
 *
 * Formula: fp(stage) = hash(content(stage), fp(parent_1), ..., fp(parent_N))
 *
 * @property fingerprint - This artifact's computed fingerprint
 * @property parentFingerprints - Recorded parent fingerprints at creation time
 */
export interface FingerprintRecord {
    fingerprint: string;
    parentFingerprints: Record<string, string>;
}

// ─── Staleness Result ───────────────────────────────────────────

/**
 * Result of checking a single stage for staleness.
 *
 * A stage is stale when any of its recorded parent fingerprints no
 * longer match the current parent fingerprints in the store. This
 * means the parent was re-executed after this stage, and this stage's
 * artifact may be based on outdated data.
 *
 * @property stageId - The stage being checked
 * @property stale - Whether the stage is stale
 * @property staleParents - Parent IDs whose fingerprints have changed
 * @property currentFingerprint - This stage's current fingerprint (null if not materialized)
 */
export interface StalenessResult {
    stageId: string;
    stale: boolean;
    staleParents: string[];
    currentFingerprint: string | null;
}

// ─── Chain Validation Result ────────────────────────────────────

/**
 * Result of validating the entire Merkle chain from root to terminal.
 *
 * @property valid - Whether the entire chain is consistent
 * @property staleStages - Stages that are stale (parent fingerprints changed)
 * @property missingStages - Stages that have no materialized artifact
 */
export interface ChainValidationResult {
    valid: boolean;
    staleStages: StalenessResult[];
    missingStages: string[];
}

// ─── Hasher Interface ───────────────────────────────────────────

/**
 * Interface for computing fingerprints.
 *
 * The hasher is pluggable — the default uses SHA-256, but tests can
 * substitute a simpler hash for deterministic assertions.
 */
export interface FingerprintHasher {
    /**
     * Compute a fingerprint from content and parent fingerprints.
     *
     * @param content - Serialized artifact content (JSON string)
     * @param parentFingerprints - Map of parent stage ID → fingerprint
     * @returns The computed fingerprint string
     */
    fingerprint_compute(content: string, parentFingerprints: Record<string, string>): string;
}
