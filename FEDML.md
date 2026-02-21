# FEDML Pipeline (Code-Current)

This document reflects the **current code behavior** for the `fedml.manifest.yaml` workflow.
Each section maps to one manifest stage, describes what the stage does in runtime, and shows a
`~/projects` tree snapshot after that stage is completed.

## Conventions

- `<USER>` means shell user (from `USER` env var).
- `<PROJECT>` means active project directory under `~/projects`.
- On first run, `<PROJECT>` is usually `DRAFT-xxxx` until `rename`.
- `search` also writes a snapshot under `~/searches/...` (outside `~/projects`).

## 1) `search` (`search <keywords>`)

Handler: `src/plugins/search.ts`  
Stage artifact: `search.json`  
Notes:
- Resolves dataset hits via lexical-first + semantic fallback.
- Writes stage artifact into session tree.
- Writes separate search snapshot into `~/searches` (not shown below).

```text
~/projects/
└── <BOOTSTRAP_PROJECT>/
    └── data/
        ├── session.json
        └── search/
            └── data/
                └── search.json
```

## 2) `gather` (`add <dataset>`, then `gather`)

Handler: `src/plugins/gather.ts`  
Stage artifact: `gather.json`  
Side effects:
- Creates/activates project root.
- Mounts cohort tree into stage data dir.
- Writes `.cohort`.
- If search happened in bootstrap root, migrates prior session tree into active project root.

```text
~/projects/
└── <PROJECT>/
    └── data/
        ├── session.json
        └── search/
            ├── data/
            │   └── search.json
            └── gather/
                └── data/
                    ├── gather.json
                    ├── .cohort
                    ├── manifest.json
                    ├── training/
                    │   └── <Dataset_Name>/
                    │       ├── images/...
                    │       ├── masks/... (if segmentation)
                    │       ├── metadata.json
                    │       └── manifest.json
                    └── validation/...
```

## 3) `rename` (`rename <new-name>`) — optional

Handler: `src/plugins/rename.ts`  
Stage artifact: `rename.json`  
Notes:
- Moves `/home/<USER>/projects/<old>` to `/home/<USER>/projects/<new>`.
- If skipped and user proceeds, host auto-materializes a skip sentinel at the same artifact path.

```text
~/projects/
└── <PROJECT>/   # possibly renamed from DRAFT-xxxx
    └── data/
        └── search/
            └── gather/
                ├── data/
                │   ├── gather.json
                │   └── .cohort
                └── rename/
                    └── data/
                        └── rename.json
```

## 4) `harmonize`

Handler: `src/plugins/harmonize.ts`  
Stage artifact: `harmonize.json`  
Side effects:
- Writes `.harmonized` marker.
- Attempts clone from `~/projects/<PROJECT>/input` into stage data dir (safe if missing/unresolved).

```text
~/projects/
└── <PROJECT>/
    └── data/
        └── search/
            └── gather/
                ├── data/...
                ├── rename/
                │   └── data/
                │       └── rename.json
                └── harmonize/
                    └── data/
                        ├── harmonize.json
                        └── .harmonized
```

## 5) `code` (or `proceed`)

Handler: `src/plugins/scaffold.ts`  
Stage artifact: `code.json`  
Side effects:
- Materializes scaffold files in `.../code/data/`:
  - `train.py`
  - `config.yaml`
  - `requirements.txt`
  - `README.md`
  - `.meridian/manifest.json`

```text
~/projects/
└── <PROJECT>/
    └── data/
        └── search/gather/harmonize/code/
            └── data/
                ├── code.json
                ├── train.py
                ├── config.yaml
                ├── requirements.txt
                ├── README.md
                └── .meridian/
                    └── manifest.json
```

## 6) `train` (or `python train.py`)

Handler: `src/plugins/train.ts`  
Stage artifact: `train.json`  
Side effects:
- Runs through shell path with `DATA_DIR` bound to current stage data dir.
- Writes `.local_pass` in stage data dir on successful local validation.

```text
~/projects/
└── <PROJECT>/
    └── data/
        └── search/gather/harmonize/code/train/
            └── data/
                ├── train.json
                └── .local_pass
```

## 7) `federate` (federation brief)

Handler: `src/plugins/federate-brief.ts`  
Stage artifact: `briefing.json`  
Side effects:
- Creates/updates root config: `~/<PROJECT>/.federation-config.json`.

```text
~/projects/
└── <PROJECT>/
    ├── .federation-config.json
    └── data/
        └── search/gather/harmonize/code/train/federate-brief/
            └── data/
                └── briefing.json
```

## 8) `transcompile`

Handler: `src/plugins/federate-transcompile.ts`  
Stage artifact: `transcompile.json`  
Side effects:
- Writes transcompile artifacts under project source DAG root:
  - `src/source-crosscompile/data/node.py`
  - `src/source-crosscompile/data/flower_hooks.py`
  - `src/source-crosscompile/data/transcompile.log`
  - `src/source-crosscompile/data/artifact.json`

```text
~/projects/
└── <PROJECT>/
    ├── src/
    │   └── source-crosscompile/
    │       └── data/
    │           ├── node.py
    │           ├── flower_hooks.py
    │           ├── transcompile.log
    │           └── artifact.json
    └── data/
        └── search/gather/harmonize/code/train/federate-brief/federate-transcompile/
            └── data/
                └── transcompile.json
```

## 9) `containerize`

Handler: `src/plugins/federate-containerize.ts`  
Stage artifact: `containerize.json`  
Side effects:
- Writes OCI simulation outputs:
  - `src/source-crosscompile/containerize/data/Dockerfile`
  - `image.tar`, `image.digest`, `sbom.json`, `build.log`

```text
~/projects/
└── <PROJECT>/
    ├── src/
    │   └── source-crosscompile/
    │       └── containerize/
    │           └── data/
    │               ├── Dockerfile
    │               ├── image.tar
    │               ├── image.digest
    │               ├── sbom.json
    │               └── build.log
    └── data/
        └── search/gather/harmonize/code/train/federate-brief/federate-transcompile/federate-containerize/
            └── data/
                └── containerize.json
```

## 10) `publish-config` (after `config ...`)

Handler: `src/plugins/federate-publish-config.ts`  
Stage artifact: `publish-config.json`  
Side effects:
- Updates `~/<PROJECT>/.federation-config.json`.

```text
~/projects/
└── <PROJECT>/
    ├── .federation-config.json
    └── data/
        └── search/gather/harmonize/code/train/federate-brief/federate-transcompile/federate-containerize/federate-publish-config/
            └── data/
                └── publish-config.json
```

## 11) `publish-execute`

Handler: `src/plugins/federate-publish-execute.ts`  
Stage artifact: `publish-execute.json`  
Side effects:
- Writes publish outputs:
  - `src/source-crosscompile/containerize/marketplace-publish/data/app.json`
  - `publish-receipt.json`
  - `registry-ref.txt`
  - `publish.log`

```text
~/projects/
└── <PROJECT>/
    ├── src/
    │   └── source-crosscompile/
    │       └── containerize/
    │           └── marketplace-publish/
    │               └── data/
    │                   ├── app.json
    │                   ├── publish-receipt.json
    │                   ├── registry-ref.txt
    │                   └── publish.log
    └── data/
        └── search/gather/harmonize/code/train/federate-brief/federate-transcompile/federate-containerize/federate-publish-config/federate-publish-execute/
            └── data/
                └── publish-execute.json
```

## 12) `dispatch`

Handler: `src/plugins/federate-dispatch.ts`  
Stage artifact: `dispatch.json`  
Side effects:
- Writes dispatch + rounds data:
  - `.../dispatch/data/participants.json`
  - `.../dispatch/data/dispatch.log`
  - `.../dispatch/data/receipts/*.json`
  - `.../dispatch/federated-rounds/data/round-0*.json`
  - `.../dispatch/federated-rounds/data/aggregate-metrics.json`
  - `.../dispatch/federated-rounds/data/final-checkpoint.bin`
- Writes root marker: `~/<PROJECT>/.federation-dag.json`.

```text
~/projects/
└── <PROJECT>/
    ├── .federation-dag.json
    ├── src/
    │   └── source-crosscompile/containerize/marketplace-publish/dispatch/
    │       ├── data/
    │       │   ├── participants.json
    │       │   ├── dispatch.log
    │       │   └── receipts/
    │       │       ├── bch.json
    │       │       ├── mgh.json
    │       │       └── bidmc.json
    │       └── federated-rounds/
    │           └── data/
    │               ├── round-01.json
    │               ├── round-02.json
    │               ├── round-03.json
    │               ├── round-04.json
    │               ├── round-05.json
    │               ├── aggregate-metrics.json
    │               └── final-checkpoint.bin
    └── data/
        └── search/gather/harmonize/code/train/federate-brief/federate-transcompile/federate-containerize/federate-publish-config/federate-publish-execute/federate-dispatch/
            └── data/
                └── dispatch.json
```

## 13) `status` / `show metrics` / `show rounds` (federate-execute)

Handler: `src/plugins/federate-execute.ts`  
Stage artifact: `execute.json`  
Notes:
- Primarily reads and reports metrics/rounds data.
- Stage closure is recorded by writing `execute.json`.

```text
~/projects/
└── <PROJECT>/
    └── data/
        └── search/gather/harmonize/code/train/federate-brief/federate-transcompile/federate-containerize/federate-publish-config/federate-publish-execute/federate-dispatch/federate-execute/
            └── data/
                └── execute.json
```

## 14) `publish model` (federate-model-publish)

Handler: `src/plugins/federate-model-publish.ts`  
Stage artifact: `model-publish.json`  
Side effects:
- Writes root completion marker: `~/<PROJECT>/.federated`.

```text
~/projects/
└── <PROJECT>/
    ├── .federation-config.json
    ├── .federation-dag.json
    ├── .federated
    ├── src/
    │   └── source-crosscompile/...
    └── data/
        ├── session.json
        └── search/
            └── gather/
                ├── data/gather.json
                ├── rename/data/rename.json
                └── harmonize/
                    └── code/
                        └── train/
                            └── federate-brief/
                                └── federate-transcompile/
                                    └── federate-containerize/
                                        └── federate-publish-config/
                                            └── federate-publish-execute/
                                                └── federate-dispatch/
                                                    └── federate-execute/
                                                        └── federate-model-publish/
                                                            └── data/
                                                                └── model-publish.json
```

## 15) Final Explicit Tree (Canonical Full Run Example)

Assumptions for this explicit tree:
- User selected `ds-006` (`Histology_Segmentation`), then renamed project to `histo-exp`.
- Full pipeline executed to `publish model`.
- `harmonize` copied current `input` view into its stage data dir.

```text
~/projects/
└── histo-exp/
    ├── .federated
    ├── .federation-config.json
    ├── .federation-dag.json
    ├── data/
    │   ├── session.json
    │   └── search/
    │       ├── data/
    │       │   └── search.json
    │       └── gather/
    │           ├── data/
    │           │   ├── .cohort
    │           │   ├── gather.json
    │           │   ├── manifest.json
    │           │   ├── training/
    │           │   │   └── Histology_Segmentation/
    │           │   │       ├── images/
    │           │   │       │   ├── WBC_001.bmp
    │           │   │       │   ├── WBC_002.bmp
    │           │   │       │   ├── WBC_003.bmp
    │           │   │       │   ├── WBC_004.bmp
    │           │   │       │   ├── WBC_005.bmp
    │           │   │       │   ├── WBC_006.bmp
    │           │   │       │   ├── WBC_007.bmp
    │           │   │       │   ├── WBC_008.bmp
    │           │   │       │   ├── WBC_009.bmp
    │           │   │       │   ├── WBC_010.bmp
    │           │   │       │   ├── WBC_011.bmp
    │           │   │       │   ├── WBC_012.bmp
    │           │   │       │   ├── WBC_013.bmp
    │           │   │       │   ├── WBC_014.bmp
    │           │   │       │   ├── WBC_015.bmp
    │           │   │       │   ├── WBC_016.bmp
    │           │   │       │   ├── WBC_017.bmp
    │           │   │       │   ├── WBC_018.bmp
    │           │   │       │   ├── WBC_019.bmp
    │           │   │       │   └── WBC_020.bmp
    │           │   │       ├── manifest.json
    │           │   │       ├── masks/
    │           │   │       │   ├── WBC_001_mask.png
    │           │   │       │   ├── WBC_002_mask.png
    │           │   │       │   ├── WBC_003_mask.png
    │           │   │       │   ├── WBC_004_mask.png
    │           │   │       │   ├── WBC_005_mask.png
    │           │   │       │   ├── WBC_006_mask.png
    │           │   │       │   ├── WBC_007_mask.png
    │           │   │       │   ├── WBC_008_mask.png
    │           │   │       │   ├── WBC_009_mask.png
    │           │   │       │   ├── WBC_010_mask.png
    │           │   │       │   ├── WBC_011_mask.png
    │           │   │       │   ├── WBC_012_mask.png
    │           │   │       │   ├── WBC_013_mask.png
    │           │   │       │   ├── WBC_014_mask.png
    │           │   │       │   ├── WBC_015_mask.png
    │           │   │       │   ├── WBC_016_mask.png
    │           │   │       │   ├── WBC_017_mask.png
    │           │   │       │   ├── WBC_018_mask.png
    │           │   │       │   ├── WBC_019_mask.png
    │           │   │       │   └── WBC_020_mask.png
    │           │   │       └── metadata.json
    │           │   └── validation/
    │           │       ├── images/
    │           │       │   ├── val_001.jpg
    │           │       │   └── val_002.jpg
    │           │       └── masks/
    │           │           ├── val_001_mask.png
    │           │           └── val_002_mask.png
    │           ├── harmonize/
    │           │   └── data/
    │           │       ├── .cohort
    │           │       ├── .harmonized
    │           │       ├── gather.json
    │           │       ├── harmonize.json
    │           │       ├── manifest.json
    │           │       ├── training/
    │           │       │   └── Histology_Segmentation/
    │           │       │       ├── images/
    │           │       │       │   ├── WBC_001.bmp
    │           │       │       │   ├── WBC_002.bmp
    │           │       │       │   ├── WBC_003.bmp
    │           │       │       │   ├── WBC_004.bmp
    │           │       │       │   ├── WBC_005.bmp
    │           │       │       │   ├── WBC_006.bmp
    │           │       │       │   ├── WBC_007.bmp
    │           │       │       │   ├── WBC_008.bmp
    │           │       │       │   ├── WBC_009.bmp
    │           │       │       │   ├── WBC_010.bmp
    │           │       │       │   ├── WBC_011.bmp
    │           │       │       │   ├── WBC_012.bmp
    │           │       │       │   ├── WBC_013.bmp
    │           │       │       │   ├── WBC_014.bmp
    │           │       │       │   ├── WBC_015.bmp
    │           │       │       │   ├── WBC_016.bmp
    │           │       │       │   ├── WBC_017.bmp
    │           │       │       │   ├── WBC_018.bmp
    │           │       │       │   ├── WBC_019.bmp
    │           │       │       │   └── WBC_020.bmp
    │           │       │       ├── manifest.json
    │           │       │       ├── masks/
    │           │       │       │   ├── WBC_001_mask.png
    │           │       │       │   ├── WBC_002_mask.png
    │           │       │       │   ├── WBC_003_mask.png
    │           │       │       │   ├── WBC_004_mask.png
    │           │       │       │   ├── WBC_005_mask.png
    │           │       │       │   ├── WBC_006_mask.png
    │           │       │       │   ├── WBC_007_mask.png
    │           │       │       │   ├── WBC_008_mask.png
    │           │       │       │   ├── WBC_009_mask.png
    │           │       │       │   ├── WBC_010_mask.png
    │           │       │       │   ├── WBC_011_mask.png
    │           │       │       │   ├── WBC_012_mask.png
    │           │       │       │   ├── WBC_013_mask.png
    │           │       │       │   ├── WBC_014_mask.png
    │           │       │       │   ├── WBC_015_mask.png
    │           │       │       │   ├── WBC_016_mask.png
    │           │       │       │   ├── WBC_017_mask.png
    │           │       │       │   ├── WBC_018_mask.png
    │           │       │       │   ├── WBC_019_mask.png
    │           │       │       │   └── WBC_020_mask.png
    │           │       │       └── metadata.json
    │           │       ├── validation/
    │           │       │   ├── images/
    │           │       │   │   ├── val_001.jpg
    │           │       │   │   └── val_002.jpg
    │           │       │   └── masks/
    │           │       │       ├── val_001_mask.png
    │           │       │       └── val_002_mask.png
    │           │       └── code/
    │           │           └── data/
    │           │               ├── README.md
    │           │               ├── code.json
    │           │               ├── config.yaml
    │           │               ├── requirements.txt
    │           │               ├── train.py
    │           │               ├── .meridian/
    │           │               │   └── manifest.json
    │           │               └── train/
    │           │                   └── data/
    │           │                       ├── .local_pass
    │           │                       ├── train.json
    │           │                       └── federate-brief/
    │           │                           └── data/
    │           │                               ├── briefing.json
    │           │                               └── federate-transcompile/
    │           │                                   └── data/
    │           │                                       ├── transcompile.json
    │           │                                       └── federate-containerize/
    │           │                                           └── data/
    │           │                                               ├── containerize.json
    │           │                                               └── federate-publish-config/
    │           │                                                   └── data/
    │           │                                                       ├── publish-config.json
    │           │                                                       └── federate-publish-execute/
    │           │                                                           └── data/
    │           │                                                               ├── publish-execute.json
    │           │                                                               └── federate-dispatch/
    │           │                                                                   └── data/
    │           │                                                                       ├── dispatch.json
    │           │                                                                       └── federate-execute/
    │           │                                                                           └── data/
    │           │                                                                               ├── execute.json
    │           │                                                                               └── federate-model-publish/
    │           │                                                                                   └── data/
    │           │                                                                                       └── model-publish.json
    │           └── rename/
    │               └── data/
    │                   └── rename.json
    └── src/
        └── source-crosscompile/
            ├── data/
            │   ├── artifact.json
            │   ├── flower_hooks.py
            │   ├── node.py
            │   └── transcompile.log
            └── containerize/
                └── data/
                    ├── Dockerfile
                    ├── build.log
                    ├── image.digest
                    ├── image.tar
                    ├── sbom.json
                    └── marketplace-publish/
                        └── data/
                            ├── app.json
                            ├── publish-receipt.json
                            ├── publish.log
                            ├── registry-ref.txt
                            └── dispatch/
                                ├── data/
                                │   ├── dispatch.log
                                │   ├── participants.json
                                │   └── receipts/
                                │       ├── bch.json
                                │       ├── bidmc.json
                                │       └── mgh.json
                                └── federated-rounds/
                                    └── data/
                                        ├── aggregate-metrics.json
                                        ├── final-checkpoint.bin
                                        ├── round-01.json
                                        ├── round-02.json
                                        ├── round-03.json
                                        ├── round-04.json
                                        └── round-05.json
```

## 16) Final Explicit Tree (No-Rename Variant)

Assumptions for this explicit variant:
- User selected `ds-006` (`Histology_Segmentation`) and did **not** run `rename`.
- Project remained in bootstrap naming (example: `DRAFT-8067`).
- Full pipeline executed to `publish model`.

Notes:
- Payload files are the same as Section 15.
- The only structural deltas are project-root naming and `rename` stage artifact policy
  (either `rename/data/rename.json` if explicitly invoked, or host skip sentinel at that path when skipped).

```text
~/projects/
└── DRAFT-8067/
    ├── .federated
    ├── .federation-config.json
    ├── .federation-dag.json
    ├── data/
    │   ├── session.json
    │   └── search/
    │       ├── data/
    │       │   └── search.json
    │       └── gather/
    │           ├── data/                       # same full payload tree as Section 15
    │           │   ├── .cohort
    │           │   ├── gather.json
    │           │   ├── manifest.json
    │           │   ├── training/Histology_Segmentation/...
    │           │   └── validation/...
    │           ├── harmonize/
    │           │   └── data/                   # same full payload tree as Section 15
    │           │       ├── .cohort
    │           │       ├── .harmonized
    │           │       ├── gather.json
    │           │       ├── harmonize.json
    │           │       ├── manifest.json
    │           │       ├── training/Histology_Segmentation/...
    │           │       ├── validation/...
    │           │       └── code/
    │           │           └── data/
    │           │               ├── README.md
    │           │               ├── code.json
    │           │               ├── config.yaml
    │           │               ├── requirements.txt
    │           │               ├── train.py
    │           │               ├── .meridian/manifest.json
    │           │               └── train/data/...
    │           └── rename/
    │               └── data/
    │                   └── rename.json         # explicit rename or skip sentinel artifact
    └── src/
        └── source-crosscompile/
            ├── data/
            │   ├── artifact.json
            │   ├── flower_hooks.py
            │   ├── node.py
            │   └── transcompile.log
            └── containerize/
                └── data/
                    ├── Dockerfile
                    ├── build.log
                    ├── image.digest
                    ├── image.tar
                    ├── sbom.json
                    └── marketplace-publish/
                        └── data/
                            ├── app.json
                            ├── publish-receipt.json
                            ├── publish.log
                            ├── registry-ref.txt
                            └── dispatch/
                                ├── data/
                                │   ├── dispatch.log
                                │   ├── participants.json
                                │   └── receipts/
                                │       ├── bch.json
                                │       ├── bidmc.json
                                │       └── mgh.json
                                └── federated-rounds/
                                    └── data/
                                        ├── aggregate-metrics.json
                                        ├── final-checkpoint.bin
                                        ├── round-01.json
                                        ├── round-02.json
                                        ├── round-03.json
                                        ├── round-04.json
                                        └── round-05.json
```

## 17) Search Snapshot Tree (`~/searches`, Outside Project Root)

Assumptions for this explicit variant:
- User executed at least one `search <keywords>`.
- Snapshot persisted by search provider in home-scoped catalog cache.

```text
~/searches/
├── search-2026-02-20T21-47-47-275Z-7831.json
├── search-2026-02-21T08-14-02-104Z-1199.json
└── search-2026-02-21T09-36-55-987Z-4412.json
```

Example snapshot shape:

```json
{
  "query": "histology data sets",
  "timestamp": "2026-02-20T21:47:47.275Z",
  "results": [
    { "id": "ds-006", "name": "Histology Segmentation" },
    { "id": "ds-001", "name": "BCH Chest X-ray Cohort" }
  ]
}
```

## Quick Path Index (artifact envelopes)

- `search`: `.../search/data/search.json`
- `gather`: `.../search/gather/data/gather.json`
- `rename`: `.../search/gather/rename/data/rename.json`
- `harmonize`: `.../search/gather/harmonize/data/harmonize.json`
- `code`: `.../search/gather/harmonize/code/data/code.json`
- `train`: `.../search/gather/harmonize/code/train/data/train.json`
- `federate-brief`: `.../federate-brief/data/briefing.json`
- `federate-transcompile`: `.../federate-transcompile/data/transcompile.json`
- `federate-containerize`: `.../federate-containerize/data/containerize.json`
- `federate-publish-config`: `.../federate-publish-config/data/publish-config.json`
- `federate-publish-execute`: `.../federate-publish-execute/data/publish-execute.json`
- `federate-dispatch`: `.../federate-dispatch/data/dispatch.json`
- `federate-execute`: `.../federate-execute/data/execute.json`
- `federate-model-publish`: `.../federate-model-publish/data/model-publish.json`
