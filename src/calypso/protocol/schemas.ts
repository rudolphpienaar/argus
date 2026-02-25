/**
 * @file Calypso Protocol Schemas
 *
 * Zod runtime schemas for all inbound WebSocket messages (Client → Server).
 *
 * These are the Pydantic equivalent for the WS wire boundary: every message
 * that arrives from an external client is validated here before any handler
 * logic runs. A malformed field (wrong type, missing required key) produces
 * a structured parse error, not a silent undefined downstream.
 *
 * Usage:
 *   const result = ClientMessageSchema.safeParse(JSON.parse(raw));
 *   if (!result.success) { ... return error to client ... }
 *   const msg = result.data;  // fully typed, all fields guaranteed
 *
 * @module calypso/protocol/schemas
 */

import { z } from 'zod';

// ─── Shared ──────────────────────────────────────────────────────────────────

/** Every client message carries a non-empty correlation ID. */
const IdSchema = z.string().min(1);

// ─── Individual message schemas ──────────────────────────────────────────────

export const CommandMessageSchema = z.object({
    type:    z.literal('command'),
    id:      IdSchema,
    command: z.string().min(1)
});

export const LoginMessageSchema = z.object({
    type:     z.literal('login'),
    id:       IdSchema,
    username: z.string()
});

export const PersonaMessageSchema = z.object({
    type:       z.literal('persona'),
    id:         IdSchema,
    workflowId: z.string().nullable()
});

export const PromptRequestMessageSchema = z.object({
    type: z.literal('prompt'),
    id:   IdSchema
});

export const TabCompleteMessageSchema = z.object({
    type:   z.literal('tab-complete'),
    id:     IdSchema,
    line:   z.string(),
    cursor: z.number().int().nonnegative()
});

// ─── Union ───────────────────────────────────────────────────────────────────

/**
 * Discriminated union of all valid client messages.
 *
 * `safeParse` this at the WS message boundary before touching any fields.
 * Zod uses the `type` literal to pick the right schema branch — same
 * pattern as a Python `Union[CommandMessage, LoginMessage, ...]` with
 * a `Literal` discriminator field.
 */
export const ClientMessageSchema = z.discriminatedUnion('type', [
    CommandMessageSchema,
    LoginMessageSchema,
    PersonaMessageSchema,
    PromptRequestMessageSchema,
    TabCompleteMessageSchema
]);

export type ValidatedClientMessage = z.infer<typeof ClientMessageSchema>;
