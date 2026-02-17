/**
 * @file Action Router
 *
 * Intercepts imperative natural language workflow intents and maps them
 * to deterministic commands.
 *
 * @module lcarslm/routing/action
 */

/**
 * Resolves natural language input into a deterministic workflow command.
 *
 * @param input - Raw user input
 * @returns Resolved command or null
 */
export function actionIntent_resolve(input: string): string | null {
    const trimmed = input.trim().toLowerCase();

    // 1. Data Harmonization
    if (
        /^(ok|yes|please|go\s+ahead|do\s+it|run|start)\s+(the\s+)?harmoniz/i.test(trimmed) ||
        /^harmonize\s+(it|them|the\s+data|the\s+cohort)$/i.test(trimmed)
    ) {
        return 'harmonize';
    }

    // 2. Data Gathering
    if (
        /^(ok|yes|please|go\s+ahead|do\s+it|run|start)\s+(the\s+)?gather/i.test(trimmed) ||
        /^gather\s+(it|them|the\s+data|the\s+cohort)$/i.test(trimmed)
    ) {
        return 'gather';
    }

    // 3. Local Training
    if (
        /^(ok|yes|please|go\s+ahead|do\s+it|run|start)\s+(the\s+)?train/i.test(trimmed) ||
        /^train\s+(it|the\s+model)$/i.test(trimmed) ||
        /^run\s+train\.py$/i.test(trimmed)
    ) {
        return 'python train.py';
    }

    // 4. Scaffolding / Proceeding
    if (
        /^(ok|yes|please|go\s+ahead|do\s+it|run|start)\s+(the\s+)?scaffold/i.test(trimmed) ||
        /^proceed$/i.test(trimmed) ||
        /^start\s+coding$/i.test(trimmed)
    ) {
        return 'proceed';
    }

    // 5. Federation
    if (
        /^federate\s+(it|the\s+project)$/i.test(trimmed) ||
        /^(start|dispatch)\s+(the\s+)?federation/i.test(trimmed)
    ) {
        return 'federate';
    }

    return null;
}
