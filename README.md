# ARGUS

**ATLAS Resource Graphical User System**

ARGUS is the user-facing intelligence console for ATLAS (Advanced Training and Learning At Scale), a federated medical imaging platform designed for distributed machine learning across secure institutional boundaries. The project functions as both high-fidelity prototype and executable reference architecture: it is meant to be used, not only described.

At its core, ARGUS combines SeaGaP-MP workflow orchestration, a browser-native Virtual Computer System, and a headless AI intent layer called CALYPSO that is shared between web and CLI surfaces. The design objective is simple: natural interaction on top, deterministic materialized state underneath.

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

## Mythology and Design Lineage

The ATLAS/ARGUS/CALYPSO naming model is operational, not decorative:

- **ATLAS carries** infrastructure burden (federated compute, policy, governance).
- **ARGUS sees** distributed state and operator-relevant truth.
- **CALYPSO guides** users through complexity without hiding evidence.

ARGUS also adopts LCARS and the CALYPSO/Zora lineage from *Star Trek* as design grammar: dense operational visibility, composed guidance, and explicit mechanism over abstraction. The goal is a serious working console, not a themed chat wrapper.

## Getting Started

Use the standard TypeScript workflow.

```bash
# Install dependencies
make install

# Build and compile
make build

# Start the local development server (http://localhost:8080)
make serve

# Start headless Calypso server (no browser required)
make calypso

# Connect to Calypso via CLI
make calypso-cli
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

ARGUS builds on established ideas in tool-using and agentic AI, but combines them in a workflow system where assistant interaction is first-class while execution truth stays artifact-grounded.

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
