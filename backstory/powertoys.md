# Power User Workflows

Power workflows in ARGUS were born from friction, not ambition. Experienced users kept repeating the same setup choreography before they could start meaningful work. Search, gather, rename, harmonize, scaffold, train. The sequence was correct, but the repetition was costly.

The project's answer was not to delete stages. It was to make stage traversal programmable while preserving state truth. That is the central rule for every power feature in this system: speed is allowed, opacity is not.

`.clpso` scripts are the clearest expression of that rule. A script captures a known-good sequence and replays it deterministically. The operator gains time, but nothing becomes hidden. Commands still execute in order, state still materializes in the same locations, and failures still stop the run where they happen.

`/scripts` and `/run --dry` are as important as `/run`. Discovery and preview are what keep automation from turning into mystery. A user should always be able to see what a script is, what it will do, and where in the workflow it will land.

Transcript replay serves a related purpose. Teams often prototype flows conversationally, then need to reproduce that behavior during debugging or demos. `calypso-cli` can ingest mixed transcript text, execute the command-bearing lines, and ignore chatter. What was once ad hoc interaction becomes reusable operational input.

Batch and jump shortcuts are the lightweight alternative for users who do not want to maintain script files. They provide explicit fast-forwarding to a stage target while retaining deterministic stage actions and clear auditability.

These features matter beyond convenience because they collapse the distance between operation and testing. A flow that helps a user move faster can be promoted into ORACLE validation with minimal translation. The practical effect is fewer one-off test paths and better alignment between real usage and regression coverage.

Power tools only work when CALYPSO remains a good guide. Users forget command forms, script names, and stage semantics. The assistant should recover context and provide concrete next steps without making the user feel they dropped into a private expert mode.

The long-term standard is simple: ARGUS should let experts move quickly without creating a second system that only experts understand.
