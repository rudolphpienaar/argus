# Mythological Metaphor

The naming in ARGUS started as a practical decision, not a branding exercise. In distributed systems, names either sharpen thinking or quietly poison it. When language is vague, teams spend half their time arguing about terms that should have been obvious. The ATLAS, ARGUS, and CALYPSO triad was chosen to avoid that drift.

ATLAS is the easiest to explain and the hardest to build. In myth, Atlas carries the heavens. In this project, ATLAS carries the burden nobody sees in screenshots: cross-site compute, data custody, policy boundaries, scheduling, failure handling, and all the governance machinery that keeps federated work legal and reproducible. If ATLAS is weak, everything above it becomes theater.

ARGUS is the watchman. Argus Panoptes had a hundred eyes because a single point of view was never enough. That image maps cleanly to the console problem. A federated workflow is not one event; it is many asynchronous truths happening at once: cohort composition, artifact generation, model state, transfer status, and execution provenance. ARGUS exists so the operator can see those truths without drowning in them.

CALYPSO is the mediator. In myth, Calypso is associated with concealment. The project keeps that meaning, but inverts its purpose. CALYPSO does not conceal outcomes; CALYPSO conceals unnecessary friction. The user speaks in intent, the system executes deterministically, and the evidence is left behind as materialized state. Good mediation is not magic. It is translation with accountability.

That is why the triad is operationally useful. ATLAS carries. ARGUS sees. CALYPSO guides. Each name maps to a real software responsibility, and that mapping keeps design conversations honest. If a feature belongs in orchestration, we call it ATLAS work. If it belongs in observability and operator control, we call it ARGUS work. If it belongs in intent interpretation and command routing, we call it CALYPSO work.

There is also a tone implication. ATLAS should feel dependable, not flashy. ARGUS should feel alert, not noisy. CALYPSO should feel composed, not chatty. In a medical AI context, that tone matters because users infer system maturity from how the system speaks, not just from what it does.

The final benefit is documentary discipline. When these names are used consistently across UI text, CLI behavior, architecture docs, and code comments, the project keeps a stable mental model as it grows. Without that stability, teams start rewriting the same conceptual map every quarter. With it, new contributors can orient quickly and make decisions that fit the existing system.
