/**
 * @file Marketplace Assets Data
 * 
 * High-Imagination "Pro" Generator for 400+ unique medical AI assets.
 * Uses tiered dictionaries to simulate a realistic, diverse ecosystem.
 */

export interface MarketplaceAsset {
    id: string;
    name: string;
    type: 'plugin' | 'dataset' | 'model' | 'workflow' | 'annotation';
    version: string;
    description: string;
    author: string;
    stars: number;
    size: string;
    installed: boolean;
}

// --- Dictionaries for Imagination ---

const CODENAMES = [
    'Aegis', 'Vortex', 'Synapse', 'Prism', 'Loom', 'Nebula', 'Chronos', 'Flux', 'Aura', 'Zenith',
    'Titan', 'Icarus', 'Helix', 'Nexus', 'Pulse', 'Vector', 'Echo', 'Mirage', 'Orion', 'Spectrum',
    'Catalyst', 'Forge', 'Beacon', 'Cipher', 'Mantle', 'Stratus', 'Quill', 'Vertex', 'Apex', 'Solstice'
];

const CLINICAL_TASKS = [
    'Glioblastoma parcellation', 'Left atrial appendage flow analysis', 'Retinopathy of prematurity stage detection',
    'Fetal cortical folding quantification', 'Ischemic stroke core mapping', 'Myocardial strain tensor estimation',
    'Non-small cell lung cancer margin detection', 'Triple-negative breast cancer H&E grading',
    'Neonatal white matter connectivity', 'Hepatic venous pressure gradient simulation',
    'Osteoarthritis cartilage thickness mapping', 'Alzheimer\'s tau protein density estimation',
    'Diabetic macular edema fluid segmentation', 'Pediatric scoliosis angle automation',
    'Cardiac 4D-flow turbulence quantification'
];

const MODALITIES = [
    'T1w-Gadolinium MRI', 'Diffusion Tensor Imaging (DTI)', 'High-Resolution CT (HRCT)',
    'Full-field Digital Mammography', 'Optical Coherence Tomography (OCT)', '4D-Flow MRI',
    'H&E Histology Slides', 'Contrast-enhanced Ultrasound (CEUS)', 'Positron Emission Tomography (PET/CT)',
    'Magnetoencephalography (MEG)', 'Electrocorticography (ECoG)', 'Functional Near-Infrared Spectroscopy (fNIRS)'
];

const METHODS = [
    'Attention-gated U-Net', 'Vision Transformer (ViT)', 'Conditional GAN', 'Geometric Deep Learning',
    'Topological Data Analysis', 'Bayesian Neural Networks', 'Diffusion Probabilistic Models',
    'Zero-shot Multi-modal Learning', 'Contrastive Self-supervised Learning', 'Neural Radiance Fields (NeRF)'
];

const INSTITUTIONS = [
    'FNNDSC / Boston Children\'s', 'MGH Center for Clinical Data Science', 'Stanford AIMI',
    'The ChRIS Project Core', 'Mayo Clinic AI Lab', 'Oxford Big Data Institute',
    'Charité Universitätsmedizin Berlin', 'UCSF Center for Intelligent Imaging',
    'Mila - Quebec AI Institute', 'DeepMind Health Research', 'Zuckerman Brain Institute',
    'Allen Institute for Cell Science', 'Broad Institute of MIT and Harvard'
];

function getRandom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

const assets: MarketplaceAsset[] = [];

// 1. Plugins (100) - Evocative ChRIS Apps
for (let i = 1; i <= 100; i++) {
    const codename = getRandom(CODENAMES) + '-' + i;
    const task = getRandom(CLINICAL_TASKS);
    const mod = getRandom(MODALITIES);
    const inst = getRandom(INSTITUTIONS);
    
    assets.push({
        id: `pl-app-${i}`,
        name: `pl-${codename.toLowerCase()}`,
        type: 'plugin',
        version: `${Math.floor(Math.random() * 4)}.${Math.floor(Math.random() * 9)}.2`,
        description: `Autonomous pipeline for ${task.toLowerCase()}. Optimized for ${mod} inputs. Uses state-of-the-art ${getRandom(METHODS).toLowerCase()} under the hood.`,
        author: inst,
        stars: Math.floor(Math.random() * 950),
        size: `${Math.floor(Math.random() * 600) + 50} MB`,
        installed: false
    });
}

// 2. Datasets (100) - High-Value Research Cohorts
for (let i = 1; i <= 100; i++) {
    const task = getRandom(CLINICAL_TASKS);
    const inst = getRandom(INSTITUTIONS);
    const mod = getRandom(MODALITIES);
    const name = `${getRandom(CODENAMES)} ${task.split(' ').slice(0,2).join(' ')} Collection`;
    
    assets.push({
        id: `ds-ref-${i}`,
        name,
        type: 'dataset',
        version: 'Release 2026.A',
        description: `Global reference cohort for ${task.toLowerCase()}. Sourced from ${inst}, featuring ${Math.floor(Math.random() * 8000) + 200} ${mod} cases with longitudinal outcomes.`,
        author: inst,
        stars: Math.floor(Math.random() * 500) + 200,
        size: `${(Math.random() * 200 + 10).toFixed(1)} GB`,
        installed: false
    });
}

// 3. Annotations (100) - Validated Ground Truth
for (let i = 1; i <= 100; i++) {
    const task = getRandom(CLINICAL_TASKS);
    const inst = getRandom(INSTITUTIONS);
    const codename = getRandom(CODENAMES);
    
    assets.push({
        id: `ann-mask-${i}`,
        name: `${codename} ${task.split(' ')[0]} Ground-Truth`,
        type: 'annotation',
        version: 'v4.2-verified',
        description: `Multi-expert consensus masks for ${task.toLowerCase()}. Pixel-perfect parcellations validated by double-blind radiologist review.`,
        author: inst,
        stars: Math.floor(Math.random() * 300),
        size: `${Math.floor(Math.random() * 150) + 10} MB`,
        installed: false
    });
}

// 4. Models (100) - Neural Architectures
for (let i = 1; i <= 100; i++) {
    const method = getRandom(METHODS);
    const task = getRandom(CLINICAL_TASKS);
    const inst = getRandom(INSTITUTIONS);
    const name = `${getRandom(CODENAMES)}-${method.split(' ')[0]}-v${i}`;
    
    assets.push({
        id: `mdl-net-${i}`,
        name,
        type: 'model',
        version: 'Production-Stable',
        description: `Pre-trained ${method} weights specifically fine-tuned for ${task.toLowerCase()}. High robustness across cross-institutional domain shifts.`,
        author: inst,
        stars: Math.floor(Math.random() * 1500) + 500,
        size: `${Math.floor(Math.random() * 1200) + 200} MB`,
        installed: false
    });
}

export const MARKETPLACE_ASSETS: MarketplaceAsset[] = assets;