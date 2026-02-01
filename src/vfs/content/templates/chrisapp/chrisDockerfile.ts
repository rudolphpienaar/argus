/**
 * @file Dockerfile Template Generator
 */

import type { ContentContext, ContentGenerator } from '../../../types.js';

function content_generate(context: ContentContext): string {
    const projectName = context.activeProject?.name || 'chris-app';
    
    let out = 'FROM docker.io/python:3.12.1-slim-bookworm\n\n';
    out += 'LABEL org.opencontainers.image.authors="ATLAS Developer <dev@atlas.local>" \
';
    out += '      org.opencontainers.image.title="' + projectName + '" \
';
    out += '      org.opencontainers.image.description="A ChRIS plugin that..."\n\n';
    out += 'ARG SRCDIR=/usr/local/src/app\n';
    out += 'WORKDIR ${SRCDIR}\n\n';
    out += 'COPY requirements.txt .\n';
    out += 'RUN pip install -r requirements.txt\n\n';
    out += 'COPY . .\n';
    out += 'RUN pip install .\n\n';
    out += 'WORKDIR /\n';
    out += 'CMD ["' + projectName + '"]';
    
    return out;
}

export const chrisDockerfileGenerator: ContentGenerator = {
    pattern: 'chris-dockerfile',
    generate: content_generate
};