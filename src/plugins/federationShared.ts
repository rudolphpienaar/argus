/**
 * @file Shared helpers for stage-scoped federation plugins.
 *
 * Federation orchestration is implemented as stage plugins. This module
 * provides common path/config/materialization helpers without introducing
 * backend orchestration state machines.
 *
 * @module plugins/federationShared
 */

import type { PluginContext } from '../lcarslm/types.js';
import type { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';

export interface FederationPublishConfig {
    appName: string | null;
    org: string | null;
    visibility: 'public' | 'private';
}

export interface FederationDagPaths {
    crosscompileBase: string;
    crosscompileData: string;
    containerizeBase: string;
    containerizeData: string;
    publishBase: string;
    publishData: string;
    dispatchBase: string;
    dispatchData: string;
    dispatchReceipts: string;
    roundsBase: string;
    roundsData: string;
}

const FEDERATION_CONFIG_FILE = '.federation-config.json';

/**
 * Resolve project root from stage data directory.
 */
export function projectRoot_resolve(context: PluginContext): string {
    const dataMarker: string = '/provenance/';
    const markerIndex: number = context.dataDir.indexOf(dataMarker);
    if (markerIndex > 0) {
        // v11.0: Project root is the session directory
        return context.dataDir.substring(0, markerIndex);
    }

    const username: string = context.shell.env_get('USER') || 'user';
    const persona: string = context.shell.env_get('PERSONA') || 'fedml';
    const sessionId: string = context.store.sessionId_get() || 'unknown';
    return `/home/${username}/projects/${persona}/${sessionId}`;
}

/**
 * Resolve federation DAG helper paths under the project source tree.
 */
export function dagPaths_resolve(projectRoot: string): FederationDagPaths {
    const crosscompileBase: string = `${projectRoot}/src/source-crosscompile`;
    const crosscompileData: string = `${crosscompileBase}/data`;
    const containerizeBase: string = `${crosscompileBase}/containerize`;
    const containerizeData: string = `${containerizeBase}/data`;
    const publishBase: string = `${containerizeBase}/marketplace-publish`;
    const publishData: string = `${publishBase}/data`;
    const dispatchBase: string = `${publishBase}/dispatch`;
    const dispatchData: string = `${dispatchBase}/data`;
    const dispatchReceipts: string = `${dispatchData}/receipts`;
    const roundsBase: string = `${dispatchBase}/federated-rounds`;
    const roundsData: string = `${roundsBase}/data`;

    return {
        crosscompileBase,
        crosscompileData,
        containerizeBase,
        containerizeData,
        publishBase,
        publishData,
        dispatchBase,
        dispatchData,
        dispatchReceipts,
        roundsBase,
        roundsData,
    };
}

/**
 * Load publication config from project root.
 */
export function publishConfig_load(vfs: VirtualFileSystem, projectRoot: string): FederationPublishConfig {
    const path: string = publishConfig_path(projectRoot);
    try {
        const raw: string | null = vfs.node_read(path);
        if (!raw) {
            return publishConfig_default(projectRoot);
        }
        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed)) {
            return publishConfig_default(projectRoot);
        }

        const appName: string | null = typeof parsed.appName === 'string' ? parsed.appName : null;
        const org: string | null = typeof parsed.org === 'string' ? parsed.org : null;
        const visibility: 'public' | 'private' =
            parsed.visibility === 'private' ? 'private' : 'public';
        return { appName, org, visibility };
    } catch {
        return publishConfig_default(projectRoot);
    }
}

/**
 * Persist publication config to project root.
 */
export function publishConfig_save(
    vfs: VirtualFileSystem,
    projectRoot: string,
    publish: FederationPublishConfig
): void {
    const path: string = publishConfig_path(projectRoot);
    const payload: string = JSON.stringify(publish, null, 2);
    write_createOrReplace(vfs, path, payload);
}

/**
 * Build canonical publish summary lines for terminal output.
 */
export function publishSummary_lines(publish: FederationPublishConfig): string[] {
    return [
        `○ APP: ${publish.appName ?? '(unset)'}`,
        `○ ORG: ${publish.org ?? '(none)'}`,
        `○ VISIBILITY: ${publish.visibility.toUpperCase()}`,
    ];
}

/**
 * Materialize transcompile side-effect files.
 */
export function transcompile_materialize(
    vfs: VirtualFileSystem,
    projectRoot: string,
    dag: FederationDagPaths
): void {
    const now: string = new Date().toISOString();
    dir_ensure(vfs, dag.crosscompileData);
    dir_ensure(vfs, dag.containerizeBase);

    write_createOrReplace(
        vfs,
        `${dag.crosscompileData}/node.py`,
        [
            '# Auto-generated federated node entrypoint',
            'import flwr as fl',
            '',
            'def client_fn(context):',
            '    return None',
            '',
            'if __name__ == "__main__":',
            '    fl.client.start_client(server_address="127.0.0.1:8080", client=client_fn({}))',
        ].join('\n')
    );

    write_createOrReplace(
        vfs,
        `${dag.crosscompileData}/flower_hooks.py`,
        [
            '# Auto-generated Flower hooks',
            'def train_hook(batch):',
            '    return {"loss": 0.0, "acc": 0.0}',
            '',
            'def eval_hook(batch):',
            '    return {"val_loss": 0.0, "val_acc": 0.0}',
        ].join('\n')
    );

    write_createOrReplace(
        vfs,
        `${dag.crosscompileData}/transcompile.log`,
        `TRANSPILE START: ${now}\nSOURCE: ${projectRoot}/src/train.py\nSTATUS: COMPLETE\n`
    );

    write_createOrReplace(
        vfs,
        `${dag.crosscompileData}/artifact.json`,
        JSON.stringify(
            {
                stage: 'source-crosscompile',
                status: 'complete',
                generatedAt: now,
                inputs: [`${projectRoot}/src/train.py`],
                outputs: ['node.py', 'flower_hooks.py', 'transcompile.log'],
            },
            null,
            2
        )
    );
}

/**
 * Materialize containerization side-effect files.
 */
export function containerize_materialize(vfs: VirtualFileSystem, dag: FederationDagPaths): void {
    const now: string = new Date().toISOString();
    dir_ensure(vfs, dag.containerizeData);
    dir_ensure(vfs, dag.publishBase);

    write_createOrReplace(
        vfs,
        `${dag.containerizeData}/Dockerfile`,
        [
            'FROM python:3.11-slim',
            'WORKDIR /app',
            'COPY ../source-crosscompile/data/node.py /app/node.py',
            'COPY ../source-crosscompile/data/flower_hooks.py /app/flower_hooks.py',
            'CMD ["python", "/app/node.py"]',
        ].join('\n')
    );

    write_createOrReplace(vfs, `${dag.containerizeData}/image.tar`, 'SIMULATED OCI IMAGE TAR\n');
    write_createOrReplace(vfs, `${dag.containerizeData}/image.digest`, 'sha256:simulatedfedmlimage0001\n');
    write_createOrReplace(
        vfs,
        `${dag.containerizeData}/sbom.json`,
        JSON.stringify({ format: 'spdx-json', generatedAt: now, packages: ['python', 'flwr'] }, null, 2)
    );
    write_createOrReplace(
        vfs,
        `${dag.containerizeData}/build.log`,
        `BUILD START: ${now}\nLAYER CACHE: HIT\nIMAGE: COMPLETE\n`
    );
}

/**
 * Materialize publication side-effect files.
 */
export function publish_materialize(
    vfs: VirtualFileSystem,
    dag: FederationDagPaths,
    publish: FederationPublishConfig
): void {
    const now: string = new Date().toISOString();
    dir_ensure(vfs, dag.publishData);
    dir_ensure(vfs, dag.dispatchBase);

    const appName: string = publish.appName || 'unnamed-fedml-app';
    write_createOrReplace(
        vfs,
        `${dag.publishData}/app.json`,
        JSON.stringify(
            {
                appName,
                org: publish.org,
                visibility: publish.visibility,
                imageDigest: 'sha256:simulatedfedmlimage0001',
                publishedAt: now,
            },
            null,
            2
        )
    );
    write_createOrReplace(
        vfs,
        `${dag.publishData}/publish-receipt.json`,
        JSON.stringify(
            {
                status: 'published',
                appName,
                registry: 'internal://argus-marketplace',
                publishedAt: now,
            },
            null,
            2
        )
    );
    write_createOrReplace(vfs, `${dag.publishData}/registry-ref.txt`, `internal://argus-marketplace/${appName}:latest\n`);
    write_createOrReplace(
        vfs,
        `${dag.publishData}/publish.log`,
        `PUBLISH START: ${now}\nAPP: ${appName}\nSTATUS: COMPLETE\n`
    );
}

/**
 * Materialize dispatch and execution helper files.
 */
export function dispatch_materialize(
    vfs: VirtualFileSystem,
    projectRoot: string,
    dag: FederationDagPaths,
    sites: string[]
): void {
    const now: string = new Date().toISOString();

    dir_ensure(vfs, dag.dispatchData);
    dir_ensure(vfs, dag.dispatchReceipts);
    dir_ensure(vfs, dag.roundsData);

    write_createOrReplace(
        vfs,
        `${dag.dispatchData}/participants.json`,
        JSON.stringify(
            sites.map((site: string) => ({ site, endpoint: `federation://${site.toLowerCase()}/node`, status: 'ready' })),
            null,
            2
        )
    );

    write_createOrReplace(
        vfs,
        `${dag.dispatchData}/dispatch.log`,
        `DISPATCH START: ${now}\nTARGETS: ${sites.join(', ')}\nSTATUS: COMPLETE\n`
    );

    for (const site of sites) {
        write_createOrReplace(
            vfs,
            `${dag.dispatchReceipts}/${site.toLowerCase()}.json`,
            JSON.stringify({ site, status: 'accepted', timestamp: now }, null, 2)
        );
    }

    const rounds: number[] = [1, 2, 3, 4, 5];
    const aggregate: number[] = [0.62, 0.71, 0.79, 0.84, 0.89];
    rounds.forEach((round: number, idx: number): void => {
        write_createOrReplace(
            vfs,
            `${dag.roundsData}/round-0${round}.json`,
            JSON.stringify(
                {
                    round,
                    participants: sites.map((site: string) => ({ site, status: 'ok' })),
                    aggregate: aggregate[idx],
                    timestamp: now,
                },
                null,
                2
            )
        );
    });

    write_createOrReplace(
        vfs,
        `${dag.roundsData}/aggregate-metrics.json`,
        JSON.stringify({ finalAggregate: 0.89, rounds: aggregate, completedAt: now }, null, 2)
    );
    write_createOrReplace(vfs, `${dag.roundsData}/final-checkpoint.bin`, 'SIMULATED_CHECKPOINT_PAYLOAD\n');

    write_createOrReplace(
        vfs,
        `${projectRoot}/.federation-dag.json`,
        JSON.stringify(
            {
                root: `${projectRoot}/src/source-crosscompile`,
                lastMaterializedAt: now,
                phases: ['source-crosscompile', 'containerize', 'marketplace-publish', 'dispatch', 'federated-rounds'],
            },
            null,
            2
        )
    );
}

/**
 * Parse dispatch site list from command args.
 */
export function dispatchSites_parse(args: string[]): string[] {
    const defaultSites: string[] = ['BCH', 'MGH', 'BIDMC'];
    for (let i = 0; i < args.length; i++) {
        const token: string = args[i].toLowerCase();
        if (token === '--sites' && args[i + 1]) {
            return args[i + 1]
                .split(',')
                .map((site: string) => site.trim().toUpperCase())
                .filter((site: string) => !!site);
        }
        if (token.startsWith('--sites=')) {
            return token
                .slice('--sites='.length)
                .split(',')
                .map((site: string) => site.trim().toUpperCase())
                .filter((site: string) => !!site);
        }
    }
    return defaultSites;
}

function publishConfig_path(projectRoot: string): string {
    return `${projectRoot}/${FEDERATION_CONFIG_FILE}`;
}

function publishConfig_default(projectRoot: string): FederationPublishConfig {
    const projectName: string = projectRoot.split('/').pop() || 'project';
    return {
        appName: `${projectName}-fedapp`,
        org: null,
        visibility: 'public',
    };
}

function dir_ensure(vfs: VirtualFileSystem, path: string): void {
    try {
        vfs.dir_create(path);
    } catch {
        // no-op
    }
}

function write_createOrReplace(vfs: VirtualFileSystem, path: string, content: string): void {
    const parent: string = path.substring(0, path.lastIndexOf('/'));
    dir_ensure(vfs, parent);
    if (vfs.node_stat(path)) {
        vfs.node_write(path, content);
    } else {
        vfs.file_create(path, content);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
