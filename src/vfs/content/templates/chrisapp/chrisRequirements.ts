/**
 * @file requirements.txt Template Generator
 */

import type { ContentContext, ContentGenerator } from '../../../types.js';

function content_generate(context: ContentContext): string {
    return [
        'chris_plugin==0.4.0',
        'torch',
        'torchvision',
        'numpy'
    ].join('\n');
}

export const chrisRequirementsGenerator: ContentGenerator = {
    pattern: 'chris-requirements',
    generate: content_generate
};