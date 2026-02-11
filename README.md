# ARGUS

**ATLAS Resource Guided User System**

ARGUS is the operator console for ATLAS (Advanced Training and Learning At Scale), a federated medical imaging platform born from an ARPA-H funding initiative to build national infrastructure for federated learning across the US healthcare system. American healthcare data is fragmented across thousands of siloed providers, each locked behind institutional boundaries and vendor ecosystems. ATLAS addresses that problem directly: an open-source, federated compute platform that lets institutions train models collaboratively without centralizing patient data. If successful, this approach could reshape how healthcare computing works — breaking vendor lock-in, enabling cross-institutional research at national scale, and proving that open infrastructure can outperform proprietary silos.

ARGUS is the user-facing layer of that effort. It functions as both high-fidelity prototype and executable reference architecture: it is meant to be used, not only described.

At its core, ARGUS combines SeaGaP-MP workflow orchestration (Search, Gather, Process, Monitor, Post), a browser-native Virtual Computer System, and a headless AI intent layer called CALYPSO that is shared between web and CLI surfaces. The design objective is simple: natural interaction on top, deterministic materialized state underneath.

## The Triad: ATLAS, ARGUS, CALYPSO

**ATLAS** (Advanced Training and Learning At Scale) is the federated infrastructure layer, funded through ARPA-H to build open-source national infrastructure for federated learning in healthcare. It carries the burden nobody sees in screenshots: cross-site compute orchestration, data custody, policy boundaries, scheduling, failure handling, and the governance machinery that keeps federated work legal and reproducible. ATLAS is the platform; everything above it depends on its reliability.

**ARGUS** (ATLAS Resource Guided User System) is the operator console. Named after Argus Panoptes, the hundred-eyed watchman, ARGUS exists to make distributed state legible and actionable. A federated workflow is not one event — it is many asynchronous truths happening at once: cohort composition, artifact generation, model state, transfer status, and execution provenance. ARGUS lets the operator see those truths without drowning in them, and guides them through the SeaGaP-MP stage sequence (Search, Gather, Process, Monitor, Post) that structures all workflow interaction.

**CALYPSO** is the AI intent layer — the conversational mediator between human intent and deterministic execution. In myth, Calypso is associated with concealment; the project inverts that purpose. CALYPSO does not conceal outcomes; CALYPSO conceals unnecessary friction. The user speaks in intent, the system executes deterministically, and the evidence is left behind as materialized state. CALYPSO is shared across browser and CLI surfaces: the same operational core drives both, so guidance is consistent regardless of how the user connects.

The triad maps cleanly to software responsibility. If a feature belongs in orchestration, it is ATLAS work. If it belongs in observability and operator control, it is ARGUS work. If it belongs in intent interpretation and command routing, it is CALYPSO work.

## Where ARGUS Sits

Most AI-assisted applications treat the conversational layer as peripheral — a chatbot sidebar that hovers at the edge of the real UI, able to answer questions but not owning the interaction flow. Development-focused tools (Cursor, Aider, Claude Code) integrate AI more deeply, but are specific to software engineering. Autonomous agent systems (SWE-agent, OpenHands) go the other direction: the AI is the only controller, and humans step back entirely.

ARGUS occupies a distinct position. The conversational and terminal layer is the **primary interaction surface** for a domain-specific operational system. CALYPSO interprets user intent and routes to deterministic execution, the same core drives both graphical and CLI surfaces, and workflow state is proven by materialized artifacts rather than asserted by the AI. The AI is not a sidebar, not autonomous, and not general-purpose — it is the command interpreter for an operational console where every claim maps to evidence. This intent-action separation has a direct architectural ancestor in the [ChRIS Intent-Action Service](https://github.com/FNNDSC/intent-server) proposal, which formalized the principle that clients should speak in intent while a distinct orchestration layer resolves those intents into executable action sequences.

## Who ARGUS Is For

ARGUS is, at its current stage, a thought experiment made concrete — a live design that is not simply a demo but a real architectural blueprint. It explores what the UI layer for a new type of agentic interaction could look like, cast specifically against the operational reality of ATLAS and federated medical imaging.

That exploration has several audiences:

- **ML researchers and engineers** running federated training across institutional boundaries. They need cohort assembly, code scaffolding, local validation, and federation dispatch — and they need to see what is happening at every step rather than trusting a black-box agent.
- **Platform engineers** building and operating ATLAS infrastructure. ARGUS serves as a reference architecture for how an agentic UI layer can sit on top of a distributed compute platform without becoming the source of truth for state it does not own.
- **Clinical teams** consuming model outputs. Their interaction is simpler, but the same principle applies: every result should trace back to auditable artifacts, not to an AI's assertion that work was done.
- **Designers and engineers studying agentic UI patterns.** ARGUS is one answer to a question the field is still working out: what happens when the conversational AI layer is not a sidebar but the primary interaction surface? The architecture, its trade-offs, and its open problems are documented for others building in this space. See [Agentic Design Patterns](docs/agentic.adoc) for a detailed comparison with existing approaches.

## Architectural Doctrine

ARGUS is evolving toward a **CALYPSO-centered operating model**: users interact primarily through CALYPSO, and the UI is pinned to her command/response contract across browser and CLI surfaces.

Core rule: CALYPSO is the interaction layer, not the state authority.

LLM-only state tracking drifts in long, asynchronous workflows. ARGUS prevents that by separating guidance from truth:

- CALYPSO handles intent interpretation and interaction flow.
- The Intent-Action layer dispatches deterministic first-class operations.
- Workflow progress is grounded in explicit, materialized artifacts (files/markers/paths), not optimistic in-memory counters.
- ORACLE-style tests verify behavior through the assistant interface, but assertions are made against deterministic internal state.

See also:
- `docs/intents.adoc` (intent-action switchboard)
- `docs/persona-workflows.adoc` (artifact-grounded workflow semantics)
- `docs/vcs.adoc` (filesystem and shell as state substrate)
- `docs/oracle.adoc` (agentic self-testing methodology)

## Design Lineage

ARGUS adopts LCARS and the CALYPSO/Zora lineage from *Star Trek* as design grammar. Michael Okuda's LCARS treated the interface as instrumentation — dense, layered, and purposeful — and that model maps directly to the challenge of making federated clinical AI state legible. The CALYPSO/Zora thread, drawn from *Short Treks* "Calypso" (2018), encodes the right conversational posture: helpful and composed, grounded in what the system can actually prove, and never a replacement for execution truth. The goal is a serious working console, not a themed chat wrapper. See [The ARGUS Story](backstory/story.md#star-trek-connection) for the full exposition.

## Getting Started

ARGUS uses `make` (GNU Make) to orchestrate its TypeScript build pipeline. Make is a standard build automation tool available on most Unix-like systems; on macOS it ships with Xcode Command Line Tools (`xcode-select --install`), and on Linux it is typically pre-installed or available via your package manager (`apt install make`, `dnf install make`). You also need Node.js (v18+) and npm.

### Full graphical console (browser)

This is the primary mode. It launches the LCARS interface with CALYPSO already embedded — no separate server needed.

```bash
make install          # Install npm dependencies (first time only)
make argus            # Clean, install, and build from scratch
make serve            # Start the dev server at http://localhost:8080
```

After the initial `make argus`, day-to-day iteration is just `make build && make serve` (or `make dev` which does both). Open `http://localhost:8080` in a browser to reach the full ARGUS console with integrated CALYPSO.

### Headless CALYPSO (terminal only)

For terminal-only interaction without a browser, CALYPSO can run as a standalone headless server with a dedicated CLI client. This is useful for scripted workflows, ORACLE testing, and environments without a display.

```bash
make calypso          # Start the headless Calypso server (port 8081)
make calypso-cli      # Connect an interactive CLI client to the server
```

### Other targets

```bash
make test             # Run unit tests (vitest)
make test-oracle      # Run ORACLE integration tests
make watch            # Rebuild on file changes
make clean            # Remove build artifacts
make help             # List all available targets
```

## Architecture in Practice

The `src/vfs/` layer provides an in-memory POSIX-like filesystem with shell semantics and provider-backed content generation. The `src/core/state/` layer provides centralized state and events. Deterministic intent orchestration lives in `src/core/logic/ProjectManager.ts`, and the DOM-free CALYPSO core lives in `src/lcarslm/` so that browser, CLI, and test harnesses all execute the same operational logic.

## Calypso CLI

`calypso-cli` connects to the headless CALYPSO server and supports shell commands, workflow commands, transcript replay, script discovery through `/scripts`, and script execution through `/run <script>`. Detailed usage patterns are documented in [The ARGUS Story](backstory/story.md#power-user-workflows) and [Calypso Scripts (`.clpso`)](scripts/calypso/README.md).

## Documentation Map

### Current (Active Specs)

- [Developer Onboarding](docs/onboarding.adoc): practical entry point for contributors.
- [Architecture](docs/architecture.adoc): system-level topology and event/state flow.
- [Framework Patterns](docs/framework.adoc): canonical implementation patterns.
- [VCS Specification](docs/vcs.adoc): filesystem/shell substrate and provider model.
- [Calypso AI Core](docs/calypso.adoc): shared browser/CLI core and runtime modes.
- [SeaGaP Workflow](docs/seagap-workflow.adoc): UX behavior by stage.
- [Persona Workflows](docs/persona-workflows.adoc): declarative workflow contracts.
- [Intents and Routing](docs/intents.adoc): intent-action switchboard.
- [ORACLE Testing](docs/oracle.adoc): assistant-driven verification model.
- [Agentic Design Patterns](docs/agentic.adoc): comparison with agentic AI landscape.
- [Visual Language](docs/visual_language.adoc): LCARS interaction and motion grammar.
- [Development Context Timeline](docs/CONTEXT.md): versioned architecture trajectory.
- [TypeScript Style Guide](TYPESCRIPT-STYLE-GUIDE.md): coding and naming standards.

### Narrative Context

- [The ARGUS Story](backstory/story.md): canonical narrative from product problem to architecture posture.
- [Mythological Model](backstory/story.md#mythological-model): ATLAS/ARGUS/CALYPSO role model and naming discipline.
- [Star Trek Connection](backstory/story.md#star-trek-connection): LCARS + CALYPSO/Zora lineage as interaction design grammar.
- [Power User Workflows](backstory/story.md#power-user-workflows): scripts, replay, and deterministic acceleration patterns.
- [Credits and Acknowledgments](backstory/story.md#credits-and-acknowledgments): design and implementation provenance.
- [Backstory Index](backstory/README.md): guide to narrative docs.

### Historical / Point-in-Time Records

- [Framework Formalization Plan](docs/framework.md): historical v4.5.1 extraction record.
- [Session State (2026-02-05)](SESSION-STATE.md): archived checkpoint log.

## Script Documentation

Structured and legacy `.clpso` behavior is documented in [Calypso Scripts (`.clpso`)](scripts/calypso/README.md).

## Related Work and Positioning

ARGUS builds on established ideas in tool-using and agentic AI, but combines them in a workflow system where assistant interaction is first-class while execution truth stays artifact-grounded. See [Agentic Design Patterns](docs/agentic.adoc) for a detailed comparison with these approaches.

### Direct Lineage

- **ChRIS Intent-Action Service (IAS):** architectural proposal for bridging declarative hypermedia APIs and procedural client workflows through an external intent-action layer. CALYPSO's routing chain is a concrete instantiation of this principle at the UI layer.
  https://github.com/FNNDSC/intent-server

### Landscape

- **ReAct (Yao et al., 2022):** interleaves reasoning and actions in environment loops.
  https://arxiv.org/abs/2210.03629
- **Toolformer (Schick et al., 2023):** model-directed tool/API usage during generation.  
  https://arxiv.org/abs/2302.04761
- **SWE-agent (2024):** agent-computer interface for autonomous software task execution.  
  https://arxiv.org/abs/2405.15793
- **OpenHands:** open-source software agent platform with terminal/tool integration.  
  https://github.com/OpenHands/OpenHands
- **LangGraph:** stateful orchestration for long-running agent workflows.  
  https://github.com/langchain-ai/langgraph
- **OpenAI function calling (strict schema):** structured, deterministic tool invocation contracts.  
  https://platform.openai.com/docs/guides/function-calling
- **Model Context Protocol (MCP):** open protocol for standardized model-tool/context integration.  
  https://github.com/modelcontextprotocol/modelcontextprotocol

ARGUS is differentiating less by inventing a single new primitive and more by enforcing a strict combination: CALYPSO-centered interaction, deterministic intent-action execution, and artifact-proven workflow state.
