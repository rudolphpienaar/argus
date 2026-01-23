# ARGUS

**ATLAS Resource Graphical User System**

ARGUS is the primary user interface for the [ATLAS](https://github.com/FNNDSC/ATLAS) federated medical imaging platform. The name draws from Greek mythology—Argus Panoptes, the hundred-eyed giant whose vigilance made him the perfect guardian. ARGUS provides comprehensive visibility into distributed resources across federated Trusted Domains.

## Overview

ARGUS implements the **SeaGaP-MP** workflow framework:

| Stage | Description |
|-------|-------------|
| **Search** | Query the ATLAS catalog for datasets, models, or services |
| **Gather** | Assemble selected resources into a virtual filesystem cohort |
| **Process** | Perform work (train models, annotate, run inference) |
| **Monitor** | Track progress, costs, and node status in real-time |
| **Post** | Publish results to the ATLAS marketplace |

## Current Status

This repository contains a **prototype** of the Developer vertical—demonstrating the workflow for training federated ML models on distributed medical imaging data.

### Features

- LCARS-themed UI (Star Trek inspired interface)
- Mock catalog with chest X-ray datasets
- Virtual filesystem view of gathered cohorts
- Simulated federated training across 5 Trusted Domains
- Real-time training progress with loss charts
- Cost tracking with abort capability

## Quick Start

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Serve the prototype
npm run serve
```

Then open http://localhost:8080

## Project Structure

```
argus/
├── docs/
│   └── philosophy.adoc       # Design philosophy and concepts
├── src/
│   ├── core/
│   │   ├── models/           # TypeScript interfaces
│   │   └── stages/           # SeaGaP-MP stage implementations
│   ├── personas/             # Persona-specific customizations
│   │   ├── developer/
│   │   ├── annotator/
│   │   ├── user/
│   │   └── dataProvider/
│   ├── ui/
│   │   ├── lcars/            # LCARS theme components
│   │   └── components/       # Shared UI widgets
│   ├── lib/                  # Platform integration
│   └── utils/                # Generic helpers
├── dist/                     # Built output
├── data/                     # Sample medical images
└── TYPESCRIPT-STYLE-GUIDE.md # Coding conventions
```

## User Personas

ARGUS serves multiple user types:

- **Developer** - Build and train ML models (current prototype)
- **Annotator** - Label medical images
- **User** - Run inference with existing models
- **Data Provider** - Manage contributed datasets
- **App Developer** - Build MERIDIAN-compliant applications
- **Administrator** - Platform governance

## Technology

- TypeScript 5.0+ with strict mode
- LCARS CSS theme (adapted from [theLCARS.com](https://www.thelcars.com))
- Vanilla JS runtime (no framework dependencies)
- RPN naming convention (`object_method` pattern)

## Related Projects

- [ATLAS](https://github.com/FNNDSC/ATLAS) - Advanced Training and Learning At Scale
- [ChRIS](https://github.com/FNNDSC/ChRIS_ultron_backEnd) - ChRIS Research Integration System
- [MERIDIAN](docs/philosophy.adoc) - Multi-tenant Execution Runtime for Integrated Distributed Infrastructure in ATLAS Nodes

## License

MIT

## Acknowledgments

- LCARS theme based on work by Jim Robertus ([theLCARS.com](https://www.thelcars.com))
- Sample chest X-ray images from [COVID Chest X-ray Dataset](https://github.com/ieee8023/covid-chestxray-dataset) and Wikimedia Commons
