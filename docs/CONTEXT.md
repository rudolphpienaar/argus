# ARGUS Development Context

This document captures the architectural trajectory of ARGUS so current decisions can be understood in sequence rather than as disconnected patches.

## Narrative Timeline

### 2026-02-17 (v9.3.0): Manifest-Driven DAG Engine & Merkle Provenance

ARGUS achieved full architectural maturity by externalizing all persona-specific logic into declarative YAML manifests. The hardcoded workflow switchboards and persona-specific mappers were replaced with a generic DAG engine that dynamically scans for manifests and routes commands through a centralized capability registry (`HANDLER_REGISTRY`). This allows for open extension of the platform without core code modifications.

In parallel, the system implemented **Merkle Provenance Chains** across the DAG. Every workflow artifact now carries a SHA-256 fingerprint anchored to its ancestors, enabling deterministic staleness detection and branching. This transition completes the project's evolution from an LLM-guided prototype to a strictly grounded, machine-verifiable scientific instrument.

### 2026-02-12 (v7.2.0): Calypso WebSocket Service Architecture

The monolithic CLI (2081 lines) and HTTP-only server (456 lines) were decomposed into a layered WebSocket service with nine focused modules. A typed protocol layer enables shared sessions — multiple clients (TUI, future WUI, test harnesses) connect to the same CalypsoCore instance via WebSocket and see identical VFS/Store/workflow state. The duplicate script engine (~560 lines copied from ScriptRuntime) was eliminated. See `docs/calypso-architecture.adoc` for the full specification.

This architecture provided the stable foundation for the manifest-driven sequencing that followed, solving the "context drift" and sequencing hallucinations observed in earlier versions.

### 2026-02-06 (v6.1.0): Data-State Grounding

The platform formalized a key principle: workflow progress is proven by materialized artifacts, not by optimistic in-memory counters. That brought ARGUS explicitly in line with ChRIS-style DAG semantics and clarified why markers such as `.harmonized`, `train.py`, and `.local_pass` are treated as state truth.

### 2026-02-04 (v6.0.0): Local Loop Update

Execution was reorganized into a tiered model. Local training became a first-class checkpoint with realistic log simulation and `.local_pass` certification, federation simulation became gated on local readiness, and `federate` was reframed as a transformation pipeline that stages code adaptation, packaging, and remote dispatch.

### 2026-02-03 (v5.0.0): Oracle Update

CALYPSO was split into a DOM-free core that can run identically in Node and browser contexts. This enabled headless server mode, CLI coupling to the same runtime, and ORACLE-style reflexive integration testing through natural-language command execution plus state assertions.

### 2026-01-31 to 2026-01-30: Quality-of-Life and Framework Codification

The project consolidated filesystem-first workflows, cleaner draft project creation, upload flows, and practical stage UX improvements while codifying architectural patterns in explicit framework documentation. The system's working conventions moved from tribal knowledge to durable specification.

### 2026-01-30 (v4.5.0 and v4.4.0): Overlay Guard and Gather Update

The UI moved from fragile shared DOM mutation toward a slot-driven multi-mode overlay system. In parallel, Search and Gather were fused into a more cohesive inline data assembly workflow with better project continuity and explicit selection economics.

### 2026-01-29 to 2026-01-28: Workspace and Visual Language Convergence

The right-frame workspace became a practical split tooling surface with terminal and file browser coordination, and visual semantics between projects and marketplace assets were unified through reusable card and detail patterns. Motion language and frame-slot behavior were also formalized.

### 2026-01-29 to 2026-01-26: Style Sweep, VCS, and Federalization Pivot

The codebase eliminated pervasive `any` usage, adopted strict RPN naming consistency, and decomposed large monolithic flows into typed modular services. Simultaneously, the in-memory Virtual Computer System reached production-grade structure, and ARGUS pivoted from local-only metaphors to the federation-first ATLAS Factory model.

## What ARGUS Is

ARGUS, the ATLAS Resource Guided User System, is the operating console for federated medical imaging workflows. It is named after Argus Panoptes to emphasize visibility, not merely aesthetics: the system is meant to make distributed state legible and actionable.

## Core Workflow Model

All interaction centers on SeaGaP-MP: Search, Gather, Process, Monitor, and Post. The sequence is not decorative process theater; each stage represents a distinct state transition with expected artifacts and operational controls.

## Current Vertical Focus

The most mature vertical remains the Federated ML Developer flow. Marketplace exploration, cohort assembly, code scaffolding, local training simulation, and federated dispatch are all represented with deterministic state mutation and testable outputs.

## Runtime and Test Posture

ARGUS runs in both full browser mode and headless CALYPSO mode. Unit tests cover VFS, shell, content registry, workflow logic, and simulation primitives, while ORACLE scenarios verify integrated behavior through the same conversational interface exposed to users.
