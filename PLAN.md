# ARGUS Pre-v11 Hardening Plan: Contract Lock Through Deletion

## Abstract

This plan specifies the final hardening trajectory from the late v10.3 line to a pre-v11 contract lock in which ARGUS Host behavior is mathematically constrained to manifest-driven orchestration and plugin-owned compute semantics. The objective is not feature expansion. The objective is architectural subtraction: remove residual backend-internalized workflow assumptions before they harden into long-lived compatibility debt.

The critical risk addressed here is not correctness in the narrow unit-test sense. It is contract drift. A state-grounded system can still accumulate hidden coupling if command vocabularies, handler inventories, stage pipelines, or bootstrap identities are encoded in backend code paths instead of being derived from declared runtime artifacts. This plan therefore treats every hardcoded backend surrogate as a provenance hazard and a future migration tax.

## Introduction: Historical Pressure and Failure Mode

The v10 architecture established Host/Guest separation in principle, but several transitional seams remained in execution reality. Those seams manifested as static plugin loader tables, workflow-specific command vocabularies in intent routing, federation-specific script-runtime translation branches, and bootstrap literals that assumed persona or project identity (`fedml`, `DRAFT`) without explicit runtime declaration.

These are not cosmetic smells. They are structural liabilities. Each hidden assumption bypasses the manifest as source of truth and silently moves policy into code. When that happens, the platform can pass tests while still violating the core ARGUS doctrine: control decisions must be materialized and declarative, not implicit and internalized.

The pre-v11 program therefore adopts a strict investigative lens: identify where backend code is carrying latent persona semantics, remove those semantics, and re-ground behavior in manifests, plugins, and explicit runtime context.

## Hardening Program

### Workstream 1: Plugin Resolution Purification

The legacy status quo used static handler-to-module assumptions at the Host boundary. This made plugin extension appear dynamic at the manifest layer while still requiring backend edits in practice. The resolution is convention-based module resolution (`<handler>.ts/.js`) with runtime export validation, coupled to manifest-load-time checks that referenced handlers are physically resolvable.

The acceptance criterion is operational rather than stylistic: introducing a new handler no longer requires editing a static backend loader table. If manifest declaration and plugin module exist, Host dispatch is valid.

### Workstream 2: Workflow Routing De-specialization

The routing index previously contained stage-specific exceptions to enforce preferred command ownership. The pressure for these overrides came from migration-era ambiguity. In a contract-locked system, however, those overrides become an undocumented policy surface.

The resolution is to preserve deterministic tie-breaking while eliminating per-stage privileges. Command ownership must emerge from manifest command declarations and stable index rules, never from hardcoded stage names.

### Workstream 3: Script Runtime De-internalization

The script runtime inherited federation translation logic that mapped action names to command chains inside backend code. That pattern reintroduced a hidden orchestrator under a different name. The investigative conclusion is straightforward: if a scripted step must run a command, the script should declare that command directly.

The resolution is a generic command-step primitive in structured runtime and declarative command materialization in script catalog definitions. Federation sequencing remains explicit in stage commands, but backend runtime no longer embeds a federation micro-pipeline.

### Workstream 4: Intent Vocabulary Grounding

Intent compilation originally relied on backend-resident workflow command vocabularies. That model cannot remain stable across personas because manifest evolution and parser evolution can drift apart. The correct source of truth is the active manifest command set exposed through workflow adapter semantics.

The resolution is command-set derivation from active workflow declarations for both deterministic matching and LLM-compiled payload validation. This closes a key loop: language compilation is now constrained by the same graph contract that governs execution.

### Workstream 5: Bootstrap Identity Explicitness

Residual defaults for workflow and project identity were preserved to smooth migration, but they now represent hidden assumptions in core session grounding. In a production-pure backend, identity must come from explicit runtime context (config, environment, active project, persisted session) or deterministic registry fallback, not embedded literals.

The resolution removes silent persona/project defaults in core and store paths and replaces them with explicit resolution chains that remain inspectable and testable.

### Workstream 6: Verification and Narrative Lock

A hardening sweep is incomplete without verification pressure and narrative alignment. The test suite must contain guard assertions for each removed internalization surface, and technical docs must describe the post-cleanup contract in historical voice rather than feature dump shorthand.

The resolution therefore couples code deletion with test reinforcement and documentation refactoring so the written architecture and executable architecture remain congruent.

## Delivery Sequence and Operational Logic

Execution order follows dependency pressure, not convenience. Plugin resolution and routing de-specialization are resolved first because they constrain all downstream semantics. Script-runtime de-internalization follows, then intent vocabulary grounding, then bootstrap cleanup. Verification hardening and documentation lock close the cycle so the release boundary reflects both behavioral and conceptual completion.

This sequence is intentionally monotonic: each stage reduces backend policy surface area and does not reintroduce transitional toggles.

## Completion Standard

The hardening program is complete only when backend runtime no longer contains hidden workflow pipelines, static handler maps, workflow-id regex locks, or bootstrap literals that bypass explicit runtime context. Tests and build gates must remain green after each deletion phase, and documentation must record the architectural outcome as a causal investigation rather than a checklist.

At that point, pre-v11 state is considered contract-locked: manifests declare orchestration, plugins own compute semantics, adapters own rendering, and Host remains a deterministic integrity kernel.
