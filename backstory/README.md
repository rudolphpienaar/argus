# ARGUS Backstory

This directory is where ARGUS keeps its long memory.

The root `README.md` is deliberately concise and operational. It tells you how to build, run, and navigate the codebase. This folder answers a different question: why the system was designed this way, and what principles should remain stable as implementation details change.

Start with `story.md`. It is the canonical narrative arc from problem statement to architecture posture. Read it first if you want the context that ties product language, state semantics, and assistant behavior together.

Then use the focused chapters. `mythology.md` defines the ATLAS/ARGUS/CALYPSO role model that keeps terminology precise. `trek.md` explains the LCARS and CALYPSO/Zora lineage as design grammar rather than fandom reference. `powertoys.md` documents how expert users accelerate repetitive flows without sacrificing determinism or traceability. `credits.md` records the real people and reference work that influenced the project.

These files are maintained as engineering documents, not decorative lore. When they are accurate, architecture conversations stay sharper, UI language stays consistent, and new contributors can reason about intent before they touch code.

After this narrative pass, continue into `docs/onboarding.adoc`, `docs/framework.adoc`, `docs/vcs.adoc`, `docs/calypso.adoc`, and `docs/oracle.adoc` for implementation detail.
