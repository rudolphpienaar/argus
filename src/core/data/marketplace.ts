/**
 * @file Marketplace Assets Data
 * 
 * High-Imagination "Pro" Generator for 400+ unique medical AI assets.
 * Uses tiered dictionaries to simulate a realistic, diverse ecosystem.
 */

export interface MarketplaceAsset {
    id: string;
    name: string;
    type: 'plugin' | 'dataset' | 'model' | 'workflow' | 'annotation' | 'fda';
    version: string;
    description: string;
    author: string;
    stars: number;
    size: string;
    installed: boolean;
    // Extended fields for detail view
    license: string;
    updated: string;
    downloads: number;
    dependencies: string[];
    usage: string[];
    changelog: { version: string; date: string; notes: string }[];
    related: string[];  // IDs of related assets
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

function array_getRandom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

function array_getRandomItems<T>(arr: T[], count: number): T[] {
    const shuffled = [...arr].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
}

const LICENSES = [
    'MIT License', 'Apache 2.0', 'BSD 3-Clause', 'GPL v3', 'CC BY 4.0', 'Public Domain'
];

const DEPENDENCIES_POOL = [
    'Python >= 3.10', 'NumPy >= 1.24', 'PyTorch >= 2.0', 'TensorFlow >= 2.12',
    'OpenCV >= 4.8', 'SimpleITK >= 2.3', 'nibabel >= 5.0', 'scikit-image >= 0.21',
    'CUDA 12.x', 'Docker >= 24.0', 'FreeSurfer >= 7.4', 'ANTs >= 2.5',
    'dcm2niix >= 1.0.20230411', 'MONAI >= 1.3', 'nnU-Net >= 2.2'
];

function date_generate(): string {
    const year = 2026;
    const month = Math.floor(Math.random() * 12) + 1;
    const day = Math.floor(Math.random() * 28) + 1;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function changelog_generate(): { version: string; date: string; notes: string }[] {
    const notes = [
        'Initial release', 'Bug fixes and performance improvements',
        'Added support for new input formats', 'Improved accuracy on edge cases',
        'Memory optimization for large datasets', 'Added batch processing mode',
        'Fixed DICOM header parsing issues', 'Enhanced logging and error messages'
    ];
    const count = Math.floor(Math.random() * 3) + 1;
    return Array.from({ length: count }, (_, i) => ({
        version: `${3 - i}.${Math.floor(Math.random() * 9)}.${Math.floor(Math.random() * 9)}`,
        date: date_generate(),
        notes: array_getRandom(notes)
    }));
}

const assets: MarketplaceAsset[] = [];

// 1. Plugins (100) - Evocative ChRIS Apps
for (let i = 1; i <= 100; i++) {
    const codename = array_getRandom(CODENAMES) + '-' + i;
    const task = array_getRandom(CLINICAL_TASKS);
    const mod = array_getRandom(MODALITIES);
    const inst = array_getRandom(INSTITUTIONS);
    const name = `pl-${codename.toLowerCase()}`;

    assets.push({
        id: `pl-app-${i}`,
        name,
        type: 'plugin',
        version: `${Math.floor(Math.random() * 4)}.${Math.floor(Math.random() * 9)}.2`,
        description: `Autonomous pipeline for ${task.toLowerCase()}. Optimized for ${mod} inputs. Uses state-of-the-art ${array_getRandom(METHODS).toLowerCase()} under the hood.`,
        author: inst,
        stars: Math.floor(Math.random() * 950),
        size: `${Math.floor(Math.random() * 600) + 50} MB`,
        installed: false,
        license: array_getRandom(LICENSES),
        updated: date_generate(),
        downloads: Math.floor(Math.random() * 50000) + 100,
        dependencies: array_getRandomItems(DEPENDENCIES_POOL, Math.floor(Math.random() * 4) + 2),
        usage: [
            `${name} --inputdir /incoming --outputdir /outgoing`,
            `${name} --mode batch --threads 4`,
            `${name} --help`
        ],
        changelog: changelog_generate(),
        related: []  // Will be populated after all assets created
    });
}

// 2. Datasets (100) - High-Value Research Cohorts
for (let i = 1; i <= 100; i++) {
    const task = array_getRandom(CLINICAL_TASKS);
    const inst = array_getRandom(INSTITUTIONS);
    const mod = array_getRandom(MODALITIES);
    const name = `${array_getRandom(CODENAMES)} ${task.split(' ').slice(0,2).join(' ')} Collection`;
    const caseCount = Math.floor(Math.random() * 8000) + 200;

    assets.push({
        id: `ds-ref-${i}`,
        name,
        type: 'dataset',
        version: 'Release 2026.A',
        description: `Global reference cohort for ${task.toLowerCase()}. Sourced from ${inst}, featuring ${caseCount} ${mod} cases with longitudinal outcomes.`,
        author: inst,
        stars: Math.floor(Math.random() * 500) + 200,
        size: `${(Math.random() * 200 + 10).toFixed(1)} GB`,
        installed: false,
        license: array_getRandom(['CC BY 4.0', 'CC BY-NC 4.0', 'CC0 1.0', 'DUA Required']),
        updated: date_generate(),
        downloads: Math.floor(Math.random() * 10000) + 50,
        dependencies: ['DICOM viewer', 'NIfTI support'],
        usage: [
            `mount /datasets/${name.toLowerCase().replace(/\\s+/g, '-')}`,
            `ls /datasets/${name.toLowerCase().replace(/\\s+/g, '-')}/subjects/`
        ],
        changelog: [{ version: '2026.A', date: date_generate(), notes: 'Initial public release' }],
        related: []
    });
}

// 3. Annotations (100) - Validated Ground Truth
for (let i = 1; i <= 100; i++) {
    const task = array_getRandom(CLINICAL_TASKS);
    const inst = array_getRandom(INSTITUTIONS);
    const codename = array_getRandom(CODENAMES);
    const name = `${codename} ${task.split(' ')[0]} Ground-Truth`;

    assets.push({
        id: `ann-mask-${i}`,
        name,
        type: 'annotation',
        version: 'v4.2-verified',
        description: `Multi-expert consensus masks for ${task.toLowerCase()}. Pixel-perfect parcellations validated by double-blind radiologist review.`,
        author: inst,
        stars: Math.floor(Math.random() * 300),
        size: `${Math.floor(Math.random() * 150) + 10} MB`,
        installed: false,
        license: array_getRandom(['CC BY 4.0', 'CC0 1.0', 'Research Only']),
        updated: date_generate(),
        downloads: Math.floor(Math.random() * 5000) + 100,
        dependencies: ['ITK-SNAP >= 4.0', 'Label format: NIfTI'],
        usage: [
            `load --annotations /masks/${codename.toLowerCase()}/`,
            `validate --ground-truth /masks/${codename.toLowerCase()}/labels.nii.gz`
        ],
        changelog: changelog_generate(),
        related: []
    });
}

// 4. Models (100) - Neural Architectures
for (let i = 1; i <= 100; i++) {
    const method = array_getRandom(METHODS);
    const task = array_getRandom(CLINICAL_TASKS);
    const inst = array_getRandom(INSTITUTIONS);
    const name = `${array_getRandom(CODENAMES)}-${method.split(' ')[0]}-v${i}`;

    assets.push({
        id: `mdl-net-${i}`,
        name,
        type: 'model',
        version: 'Production-Stable',
        description: `Pre-trained ${method} weights specifically fine-tuned for ${task.toLowerCase()}. High robustness across cross-institutional domain shifts.`,
        author: inst,
        stars: Math.floor(Math.random() * 1500) + 500,
        size: `${Math.floor(Math.random() * 1200) + 200} MB`,
        installed: false,
        license: array_getRandom(['MIT License', 'Apache 2.0', 'Research Only', 'CC BY-NC 4.0']),
        updated: date_generate(),
        downloads: Math.floor(Math.random() * 25000) + 500,
        dependencies: array_getRandomItems(['PyTorch >= 2.0', 'TensorFlow >= 2.12', 'CUDA 12.x', 'MONAI >= 1.3', 'nnU-Net >= 2.2'], 3),
        usage: [
            `model.load('/models/${name.toLowerCase()}/weights.pt')`,
            `inference --model ${name} --input /scans/ --output /predictions/`
        ],
        changelog: changelog_generate(),
        related: []
    });
}

// 5. FDA Regulatory Science Tools (RST) - Official CDRH Tools
// Based on https://cdrh-rst.fda.gov/ catalog
const FDA_RST_TOOLS = [
    {
        id: 'fda-rst-001',
        name: 'sFRC Hallucination Detector',
        description: 'Scanning Fourier Ring Correlation tool that compares radiological images from AI or iterative-based image restoration algorithms to identify and label hallucinations using small red bounding boxes.',
        area: 'Medical Imaging and Diagnostics'
    },
    {
        id: 'fda-rst-002',
        name: 'RAMAC Landmark Matching',
        description: 'Registration-based Automated Matching and Correspondence tool that automatically identifies corresponding locations of landmarks across multiple medical images.',
        area: 'AI/Machine Learning'
    },
    {
        id: 'fda-rst-003',
        name: 'TorchSurv Survival Analysis',
        description: 'Deep learning tools for survival analysis. AI model tool used for developing and evaluating deep learning-based survival models in clinical research.',
        area: 'AI/Machine Learning'
    },
    {
        id: 'fda-rst-004',
        name: 'DxGoals Diagnostic Performance',
        description: 'RShiny software application intended to determine and visualize performance goals for common diagnostic test classification accuracy metrics.',
        area: 'Medical Imaging and Diagnostics'
    },
    {
        id: 'fda-rst-005',
        name: 'SegVal-WSI Pathology Assessment',
        description: 'Whole Slide Image Segmentation Algorithm Performance Assessment Tool. Python program for performance assessment of segmentation algorithms applied to digital pathology.',
        area: 'Digital Pathology'
    },
    {
        id: 'fda-rst-006',
        name: 'DomID Deep Clustering',
        description: 'Python package offering unsupervised deep learning algorithms for clustering medical image datasets without labeled training data.',
        area: 'AI/Machine Learning'
    },
    {
        id: 'fda-rst-007',
        name: 'PyBDC Breast Dosage Calculator',
        description: 'Python toolkit for calculating the radiation deposited dose for breast computed tomography. Estimates mean glandular dose for patient safety assessment.',
        area: 'Medical Imaging and Diagnostics'
    },
    {
        id: 'fda-rst-008',
        name: 'MCGPUv1.3 X-ray Simulation',
        description: 'GPU-accelerated Monte Carlo X-ray Simulation Software supporting evaluation of photon counting detectors by generating in-silico X-ray projections.',
        area: 'Medical Imaging and Diagnostics'
    },
    {
        id: 'fda-rst-009',
        name: 'LiFT Orthopedic Testing',
        description: 'Linear Fit Tool for orthopedic device testing. MATLAB script that automates the determination of stiffness from mechanical test data.',
        area: 'Orthopedic Devices'
    },
    {
        id: 'fda-rst-010',
        name: 'Cardiovascular Fluid Model',
        description: 'Mathematical model of cardiovascular system response to fluid perturbations. Includes cohort generation tool for virtual patient subjects.',
        area: 'Patient Monitoring'
    },
    {
        id: 'fda-rst-011',
        name: 'IR Thermal Face Dataset',
        description: 'Dataset of infrared facial and oral temperatures collected from thermography of over 1000 human volunteers for fever screening validation.',
        area: 'Emergency Preparedness'
    },
    {
        id: 'fda-rst-012',
        name: 'MRI Transfer Function Analyzer',
        description: 'Apparatus to measure transfer functions of implantable medical devices in curved trajectories for MRI safety assessment.',
        area: 'Electromagnetic Safety'
    },
    {
        id: 'fda-rst-013',
        name: 'AR/VR PSF Resolution Tool',
        description: 'Point Spread Function method for measuring spatial resolution of optical see-through augmented reality head mounted displays.',
        area: 'Medical Extended Reality'
    },
    {
        id: 'fda-rst-014',
        name: 'CTF HMD Analysis Tool',
        description: 'Contrast Transfer Function Analysis Tool that calculates the CTF of Augmented Reality and Virtual Reality head mounted displays.',
        area: 'Medical Extended Reality'
    },
    {
        id: 'fda-rst-015',
        name: 'MXR Traffic Modeling',
        description: 'Link-Level Traffic Modeling Method for networked Medical Extended Reality applications to ensure reliable real-time performance.',
        area: 'Medical Extended Reality'
    },
    {
        id: 'fda-rst-016',
        name: 'Li-Battery IMD Model',
        description: 'Computational model for predicting implantable lithium battery temperature, remaining capacity and longevity in medical devices.',
        area: 'Electromagnetic Safety'
    },
    {
        id: 'fda-rst-017',
        name: 'DHS-GC/MS Volatiles Detection',
        description: 'Dynamic Headspace Gas Chromatography Mass Spectrometry method for detection and quantification of volatiles in aqueous extracts.',
        area: 'Chemical Characterization'
    },
    {
        id: 'fda-rst-018',
        name: 'Microfluidic Flow Resistivity',
        description: 'Lab method to measure flow resistivity in microfluidic-based medical devices for quality control and performance validation.',
        area: 'Microfluidics'
    }
];

FDA_RST_TOOLS.forEach((tool: { id: string; name: string; description: string; area: string }): void => {
    assets.push({
        id: tool.id,
        name: tool.name,
        type: 'fda',
        version: 'RST-2026',
        description: tool.description,
        author: 'FDA CDRH / OSEL',
        stars: Math.floor(Math.random() * 200) + 800,
        size: `${Math.floor(Math.random() * 50) + 5} MB`,
        installed: false,
        license: 'Public Domain',
        updated: '2026-01-15',
        downloads: Math.floor(Math.random() * 3000) + 500,
        dependencies: ['Python >= 3.10', 'FDA RST Framework'],
        usage: [
            `rst-${tool.name.toLowerCase().replace(/[\\s\\/]+/g, '-')} --input /data --output /results`,
            `rst-${tool.name.toLowerCase().replace(/[\\s\\/]+/g, '-')} --validate --report`
        ],
        changelog: [
            { version: 'RST-2026', date: '2026-01-15', notes: 'Official FDA CDRH release' }
        ],
        related: []
    });
});

// Populate related assets (3 random assets of same type for each)
assets.forEach((asset: MarketplaceAsset): void => {
    const sameType: MarketplaceAsset[] = assets.filter((a: MarketplaceAsset): boolean => a.type === asset.type && a.id !== asset.id);
    const relatedIds: string[] = array_getRandomItems(sameType, 3).map((a: MarketplaceAsset): string => a.id);
    asset.related = relatedIds;
});

export const MARKETPLACE_ASSETS: MarketplaceAsset[] = assets;