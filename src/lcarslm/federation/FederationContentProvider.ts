/**
 * @file Federation Content Provider
 *
 * Generates artifact content for the federation workflow stages.
 * Moves hardcoded JSON/Python templates out of the orchestrator.
 *
 * @module lcarslm/federation/content
 */

import type { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import type { FederationDagPaths, FederationPublishConfig } from './types.js';

export class FederationContentProvider {
    constructor(private readonly vfs: VirtualFileSystem) {}

    /**
     * Materialize Step 1 artifacts: Transcompilation.
     */
    public transcompile_materialize(
        projectBase: string,
        dag: FederationDagPaths
    ): void {
        const now: string = new Date().toISOString();
        this.vfs.dir_create(dag.crosscompileData);
        this.vfs.dir_create(dag.containerizeBase);

        this.dag_write(
            `${dag.crosscompileData}/node.py`,
            [
                '# Auto-generated federated node entrypoint',
                'import flwr as fl',
                '',
                'def client_fn(context):',
                '    return None',
                '',
                'if __name__ == "__main__":',
                '    fl.client.start_client(server_address="127.0.0.1:8080", client=client_fn({}))'
            ].join('
')
        );

        this.dag_write(
            `${dag.crosscompileData}/flower_hooks.py`,
            [
                '# Auto-generated Flower hooks',
                'def train_hook(batch):',
                '    return {"loss": 0.0, "acc": 0.0}',
                '',
                'def eval_hook(batch):',
                '    return {"val_loss": 0.0, "val_acc": 0.0}'
            ].join('
')
        );

        this.dag_write(
            `${dag.crosscompileData}/transcompile.log`,
            `TRANSPILE START: ${now}
SOURCE: ${projectBase}/src/train.py
STATUS: COMPLETE
`
        );

        this.dag_write(
            `${dag.crosscompileData}/artifact.json`,
            JSON.stringify(
                {
                    stage: 'source-crosscompile',
                    status: 'complete',
                    generatedAt: now,
                    inputs: [`${projectBase}/src/train.py`],
                    outputs: ['node.py', 'flower_hooks.py', 'transcompile.log']
                },
                null,
                2
            )
        );
    }

    /**
     * Materialize Step 2 artifacts: Containerization.
     */
    public containerize_materialize(
        dag: FederationDagPaths
    ): void {
        const now: string = new Date().toISOString();
        this.vfs.dir_create(dag.containerizeData);
        this.vfs.dir_create(dag.publishBase);

        this.dag_write(
            `${dag.containerizeData}/Dockerfile`,
            [
                'FROM python:3.11-slim',
                'WORKDIR /app',
                'COPY ../source-crosscompile/data/node.py /app/node.py',
                'COPY ../source-crosscompile/data/flower_hooks.py /app/flower_hooks.py',
                'CMD ["python", "/app/node.py"]'
            ].join('
')
        );

        this.dag_write(`${dag.containerizeData}/image.tar`, 'SIMULATED OCI IMAGE TAR
');
        this.dag_write(`${dag.containerizeData}/image.digest`, 'sha256:simulatedfedmlimage0001
');
        
        this.dag_write(
            `${dag.containerizeData}/sbom.json`,
            JSON.stringify({ format: 'spdx-json', generatedAt: now, packages: ['python', 'flwr'] }, null, 2)
        );

        this.dag_write(
            `${dag.containerizeData}/build.log`,
            `BUILD START: ${now}
LAYER CACHE: HIT
IMAGE: COMPLETE
`
        );
    }

    /**
     * Materialize Step 4 artifacts: Publication.
     */
    public publish_materialize(
        dag: FederationDagPaths,
        publish: FederationPublishConfig
    ): void {
        const now: string = new Date().toISOString();
        this.vfs.dir_create(dag.publishData);
        this.vfs.dir_create(dag.dispatchBase);

        const appName: string = publish.appName || 'unnamed-fedml-app';
        
        this.dag_write(
            `${dag.publishData}/app.json`,
            JSON.stringify(
                {
                    appName,
                    org: publish.org,
                    visibility: publish.visibility,
                    imageDigest: 'sha256:simulatedfedmlimage0001',
                    publishedAt: now
                },
                null,
                2
            )
        );

        this.dag_write(
            `${dag.publishData}/publish-receipt.json`,
            JSON.stringify(
                {
                    status: 'published',
                    appName,
                    registry: 'internal://argus-marketplace',
                    publishedAt: now
                },
                null,
                2
            )
        );

        this.dag_write(`${dag.publishData}/registry-ref.txt`, `internal://argus-marketplace/${appName}:latest
`);
        
        this.dag_write(
            `${dag.publishData}/publish.log`,
            `PUBLISH START: ${now}
APP: ${appName}
STATUS: COMPLETE
`
        );
    }

    /**
     * Materialize Phase 3 artifacts: Dispatch & Execution.
     */
    public dispatch_materialize(
        projectBase: string,
        dag: FederationDagPaths
    ): void {
        const now: string = new Date().toISOString();
        const participants: string[] = ['BCH', 'MGH', 'BIDMC'];

        this.vfs.dir_create(dag.dispatchData);
        this.vfs.dir_create(dag.dispatchReceipts);
        this.vfs.dir_create(dag.roundsData);

        this.dag_write(
            `${dag.dispatchData}/participants.json`,
            JSON.stringify(
                participants.map((site: string) => ({ site, endpoint: `federation://${site.toLowerCase()}/node`, status: 'ready' })),
                null,
                2
            )
        );

        this.dag_write(
            `${dag.dispatchData}/dispatch.log`,
            `DISPATCH START: ${now}
TARGETS: ${participants.join(', ')}
STATUS: COMPLETE
`
        );

        participants.forEach(site => {
            this.dag_write(
                `${dag.dispatchReceipts}/${site.toLowerCase()}.json`,
                JSON.stringify({ site, status: 'accepted', timestamp: now }, null, 2)
            );
        });

        const rounds: number[] = [1, 2, 3, 4, 5];
        const aggregate: number[] = [0.62, 0.71, 0.79, 0.84, 0.89];
        
        rounds.forEach((round: number, idx: number): void => {
            this.dag_write(
                `${dag.roundsData}/round-0${round}.json`,
                JSON.stringify(
                    {
                        round,
                        participants: participants.map((site: string) => ({ site, status: 'ok' })),
                        aggregate: aggregate[idx],
                        timestamp: now
                    },
                    null,
                    2
                )
            );
        });

        this.dag_write(
            `${dag.roundsData}/aggregate-metrics.json`,
            JSON.stringify({ finalAggregate: 0.89, rounds: aggregate, completedAt: now }, null, 2)
        );

        this.dag_write(`${dag.roundsData}/final-checkpoint.bin`, 'SIMULATED_CHECKPOINT_PAYLOAD
');

        this.dag_write(
            `${projectBase}/.federation-dag.json`,
            JSON.stringify(
                {
                    root: `${projectBase}/src/source-crosscompile`,
                    lastMaterializedAt: now,
                    phases: ['source-crosscompile', 'containerize', 'marketplace-publish', 'dispatch', 'federated-rounds']
                },
                null,
                2
            )
        );
    }

    // ─── Private Helpers ────────────────────────────────────────────────

    private dag_write(path: string, content: string): void {
        const parent: string = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '/';
        this.vfs.dir_create(parent);
        this.vfs.node_write(path, content);
    }
}
