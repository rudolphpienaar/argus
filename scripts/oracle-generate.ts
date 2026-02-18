/**
 * @file Oracle Scenario Generator
 *
 * Automatically generates conversational smoke tests (Oracle scenarios)
 * from persona manifests.
 *
 * Usage: npx tsx scripts/oracle-generate.ts <persona-id>
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { manifest_parse } from '../src/dag/graph/parser/manifest.js';
import { sessionPaths_compute } from '../src/dag/bridge/SessionPaths.js';
import type { DAGNode, DAGDefinition } from '../src/dag/graph/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface OracleStep {
    send?: string;
    success?: boolean;
    output_contains?: string | string[];
    vfs_exists?: string;
    capture_project?: boolean;
}

interface OracleScenario {
    name: string;
    username: string;
    persona: string;
    steps: OracleStep[];
}

/**
 * Hardcoded defaults for stages that require specific inputs to succeed.
 */
const ORACLE_DEFAULTS: Record<string, string[]> = {
    'search': ['search brain'],
    'gather': ['add ds-001', 'gather'],
    'federate-transcompile': ['show transcompile', 'approve'],
    'federate-containerize': ['show container', 'approve'],
    'federate-publish-config': ['config name oracle-app', 'approve'],
    'federate-publish-execute': ['show publish', 'approve'],
    'federate-dispatch': ['dispatch'],
    'federate-execute': ['status'],
    'federate-model-publish': ['publish model'],
};

/**
 * Generate a linear walk scenario for a manifest.
 */
function scenario_generate(definition: DAGDefinition): OracleScenario {
    const steps: OracleStep[] = [];
    const pathMap = sessionPaths_compute(definition);

    // Initial setup steps
    steps.push({
        send: `/reset`,
        success: true
    });

    // Topological sort (simple for our DAGs)
    const visited = new Set<string>();
    const queue: string[] = [...definition.rootIds];

    while (queue.length > 0) {
        const stageId = queue.shift()!;
        if (visited.has(stageId)) continue;
        visited.add(stageId);

        const node = definition.nodes.get(stageId)!;
        
        // 1. Emit commands for this stage
        const custom = ORACLE_DEFAULTS[stageId];
        let commands: string[];
        
        if (custom) {
            commands = custom;
        } else {
            // Priority: 'approve' > first command
            const approveCmd = node.commands.find(c => c.startsWith('approve'));
            const rawCmd = approveCmd || node.commands[0] || node.id;
            commands = [rawCmd.split(' <')[0].trim()];
        }

        for (const cmd of commands) {
            steps.push({
                send: cmd,
                success: true,
                capture_project: stageId === 'gather' && cmd === 'gather'
            });
        }

        // 2. Assert artifacts for this stage (if it's not an action stage)
        const stagePath = pathMap.get(stageId);
        if (stagePath && node.completes_with !== null) {
            steps.push({
                vfs_exists: `\${session}/${stagePath.artifactFile}`
            });
        }

        // Add children to queue
        const children = definition.edges
            .filter(e => e.from === stageId)
            .map(e => e.to);
        queue.push(...children);
    }

    return {
        name: `Generated Linear Walk: ${definition.header.name}`,
        username: 'oracle',
        persona: (definition.header as any).persona || 'fedml',
        steps
    };
}

function main() {
    const personaId = process.argv[2];
    if (!personaId) {
        console.error('Usage: npx tsx scripts/oracle-generate.ts <persona-id>');
        process.exit(1);
    }

    const manifestPath = resolve(__dirname, `../src/dag/manifests/${personaId}.manifest.yaml`);
    try {
        const yaml = readFileSync(manifestPath, 'utf-8');
        const definition = manifest_parse(yaml);
        const scenario = scenario_generate(definition);
        
        const outputPath = resolve(__dirname, `../tests/oracle/generated-${personaId}.oracle.json`);
        writeFileSync(outputPath, JSON.stringify(scenario, null, 2));
        
        console.log(`Successfully generated oracle scenario: ${outputPath}`);
    } catch (err: any) {
        console.error(`Failed to generate oracle for '${personaId}': ${err.message}`);
        process.exit(1);
    }
}

main();
