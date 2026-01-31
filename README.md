# ARGUS

**ATLAS Resource Graphical User System**

ARGUS is the conceptual UI layer for **ATLAS** (Advanced Training and Learning At Scale), a platform designed to enable federated machine learning on medical imaging data across distributed, secure institutional nodes.

Originally conceived as a rapid prototyping environment to explore user interaction models for the "Federated ML Developer" persona, ARGUS has evolved into a functional architectural reference.

## The Concept

The core design challenge of ATLAS is complexity. A developer must discover datasets they cannot see, write code that runs in environments they cannot access, and orchestrate training across institutions with disparate governance policies.

ARGUS explores how an **Intelligence Console** metaphor—blending command-line precision with natural language AI assistance—can tame this complexity. Instead of navigating dozens of web forms, the user interacts with a unified workspace that feels less like a website and more like a dedicated workstation.

## From Mockup to Reference Architecture

During the development of this prototype, we discovered that building a convincing "facade" required modeling the underlying system mechanics. To make the file browser feel real, we had to build a working virtual filesystem. To make the terminal feel responsive, we had to implement a shell interpreter.

What started as a throwaway UI exploration has become a **living blueprint** for the production system. By simulating the mechanics of the SeaGaP (Search, Gather, Process) workflow in the browser, ARGUS provides a rigorous reference for how the real ATLAS services—like the ChRIS backend and MERIDIAN runtime—should expose their capabilities to the frontend.

### Key Architectural Pillars

**The Virtual Computer System (VCS)**
ARGUS simulates a complete runtime environment in the browser. It features an in-memory POSIX-like filesystem (`src/vfs/`) with permissions, directory structures, and content generation. This allows us to validate the "Data Provider" pattern: mapping rich application state (like a dataset cohort) into a file-tree structure that standard tools can interact with.

**The "No-Framework" Approach**
To ensure performance and longevity, ARGUS eschews heavy frontend frameworks like React or Vue in favor of a strict **Vanilla TypeScript** architecture. It uses a custom Pub/Sub store for state management and a "Slot Pattern" for UI composition, demonstrating how to build complex, reactive applications without the overhead of a virtual DOM.

**The Intelligence Console**
The interface unifies three distinct interaction modes into a single stream:
1.  **System Commands**: Standard shell operations (`ls`, `cd`, `grep`).
2.  **Workflow Actions**: High-level system intents (`federate`, `mount`).
3.  **AI RAG**: Natural language queries ("Find me pneumonia datasets under $500") powered by Retrieval Augmented Generation.

## Getting Started

ARGUS is a standard TypeScript project.

```bash
# Install dependencies
make install

# Build and compile
make build

# Start the local development server (http://localhost:8080)
make serve
```

## Documentation

*   **[Developer Onboarding](docs/onboarding.adoc)**: Start here to understand the mental model and codebase structure.
*   **[Framework Patterns](docs/framework.adoc)**: A guide to the architectural conventions (RPN naming, Store/Events) used in the project.
*   **[VCS Specification](docs/vcs.adoc)**: Details on the in-memory filesystem and provider architecture.

## Acknowledgments

*   **Architect & Lead:** Rudolph Pienaar
*   **Design Influence:** The visual language is based on the Star Trek LCARS system, adapted for modern web usability.
*   **AI Collaboration:** Development was accelerated using an agentic workflow with Claude Code, Codex, and Gemini.
