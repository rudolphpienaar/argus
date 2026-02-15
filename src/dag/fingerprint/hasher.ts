/**
 * @file Fingerprint Hasher
 *
 * Computes SHA-256 fingerprints for DAG artifacts. The fingerprint
 * incorporates the artifact's content and all parent fingerprints,
 * forming the Merkle chain that enables staleness detection.
 *
 * Parent fingerprints are sorted alphabetically by key before hashing
 * to guarantee order-independence.
 *
 * @module dag/fingerprint
 * @see docs/dag-engine.adoc
 */

import { createHash } from 'crypto';
import type { FingerprintHasher } from './types.js';

/**
 * Compute a fingerprint from content and parent fingerprints.
 *
 * Formula: hash(content + '\0' + sorted parent entries)
 *
 * @param content - Serialized artifact content (JSON string)
 * @param parentFingerprints - Map of parent stage ID → fingerprint
 * @returns SHA-256 hex string
 */
export function fingerprint_compute(
    content: string,
    parentFingerprints: Record<string, string>,
): string {
    const parentPart = Object.entries(parentFingerprints)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${v}`)
        .join(',');

    const input = content + '\0' + parentPart;
    return createHash('sha256').update(input).digest('hex');
}

/**
 * SHA-256 hasher implementing the FingerprintHasher interface.
 */
export class Sha256Hasher implements FingerprintHasher {
    fingerprint_compute(content: string, parentFingerprints: Record<string, string>): string {
        return fingerprint_compute(content, parentFingerprints);
    }
}
