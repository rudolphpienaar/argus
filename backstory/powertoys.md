# Power User Workflows

Power workflows in ARGUS exist for a specific reason: repeated setup loops consume attention that should be spent on decisions. Advanced users do not need fewer stages; they need faster traversal through known stages with the same deterministic guarantees as manual operation.

The primary acceleration mechanism is script-driven execution through `.clpso` files. A script captures an operational path once and replays it consistently. The key design constraint is that replay does not bypass truth. Every step still resolves to concrete commands, and every stage still materializes artifacts in the expected workspace paths.

In practical terms, `/scripts` is discovery, `/run` is execution, and `/run --dry` is intent preview. Together they form a safe loop: inspect what will happen, execute it, and verify outputs. This is especially valuable for harmonize-first flows where users repeatedly need to reach the same cohort-ready checkpoint before coding or federation work.

Transcript replay is the second acceleration pattern. `calypso-cli` can ingest mixed command-and-output text, extract executable lines, and ignore terminal chatter. This makes prior sessions reusable as operational macros. A conversation that once took ten minutes to compose can become a deterministic starting point in seconds.

Batch and jump commands are the third pattern. They serve users who want explicit fast-forwarding without maintaining separate script files. The important property is that target stage remains visible and auditable. A command like `/batch train ds-006` is clear about destination and leaves an inspectable trail.

These capabilities matter beyond convenience. They directly improve testing discipline. The same scripted flow used for daily operator efficiency can be promoted into ORACLE scenarios, reducing divergence between how humans use the system and how the system is validated. Fewer bespoke test paths means fewer blind spots.

Power features also impose responsibility on UX design. Fast paths must remain understandable to occasional users, and CALYPSO should be able to explain, not merely execute. If a user forgets script names or stage semantics, the assistant should recover context quickly and point to actionable next steps.

The long-term goal is to make speed and rigor coexist. ARGUS should let experts move quickly without creating a second, hidden system of behavior that only power users understand. A good power workflow is one that remains legible to everyone else.
