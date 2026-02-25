/**
 * @file Manifest Parser Schemas
 *
 * Zod runtime schemas for YAML manifest validation.
 *
 * These replace the field-by-field `typeof` checks that were written by hand
 * in manifest.ts. Each schema corresponds to one section of the manifest YAML:
 * the top-level header and each stage in the `stages` array.
 *
 * The schemas are deliberately permissive on optional fields (using `.default()`)
 * so that manifests only need to declare what's non-default. Required fields
 * (`id`, `produces`, `name`, `persona`) are enforced strictly.
 *
 * @module dag/graph/parser/schemas
 */

import { z } from 'zod';

// ─── Skip Warning ─────────────────────────────────────────────────────────────

export const SkipWarningSchema = z.object({
    short:        z.string().default(''),
    reason:       z.string().default(''),
    max_warnings: z.number().int().nonnegative().default(2)
});

// ─── Stage (DAGNode raw form) ─────────────────────────────────────────────────

/**
 * Handler names must be lowercase identifiers — enforced by regex.
 * Null means the stage has no plugin handler (structural / auto-execute).
 */
const HandlerSchema = z
    .string()
    .regex(/^[a-z][a-z0-9_-]*$/, 'handler has invalid format — must be a lowercase identifier')
    .nullable();

/**
 * `previous` in YAML can be: absent (root), a single string, or an array.
 * The schema accepts all three; `previous_normalize` in common.ts collapses
 * them to `string[] | null` after validation.
 */
const PreviousSchema = z
    .union([z.string(), z.array(z.string()), z.null()])
    .nullable()
    .optional();

export const StageSchema = z.object({
    id:           z.string().min(1, 'stage id is required'),
    produces:     z.array(z.string()).min(1, 'produces must be a non-empty array'),
    name:         z.string().optional(),
    phase:        z.string().nullable().optional(),
    previous:     PreviousSchema,
    optional:     z.boolean().default(false),
    parameters:   z.record(z.string(), z.unknown()).optional(),
    instruction:  z.string().default(''),
    commands:     z.array(z.string()).default([]),
    handler:      HandlerSchema.optional().default(null),
    skip_warning: SkipWarningSchema.nullable().optional(),
    narrative:    z.string().nullable().optional(),
    blueprint:    z.array(z.string()).default([])
});

// ─── Manifest (full document) ─────────────────────────────────────────────────

export const ManifestSchema = z.object({
    name:        z.string().min(1, 'manifest name is required'),
    persona:     z.string().min(1, 'manifest persona is required'),
    description: z.string().default(''),
    category:    z.string().default(''),
    version:     z.string().default('1.0.0'),
    locked:      z.boolean().default(false),
    authors:     z.string().default(''),
    stages:      z.array(StageSchema).min(1, 'manifest must have at least one stage')
});

export type RawManifest = z.infer<typeof ManifestSchema>;
export type RawStage   = z.infer<typeof StageSchema>;
