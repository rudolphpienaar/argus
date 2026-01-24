const fs = require('fs');

// Minimal 1x1 black PNG
const blackPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

// We'll just use 1x1 white PNG for the "mask" part in this prototype 
// to avoid heavy image libs, but we name it correctly.
const whitePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');

const dir = 'src/argus/data/BrainMRI/masks';
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

for (let i = 1; i <= 10; i++) {
    const name = `MRI_${String(i).padStart(3, '0')}_mask.png`;
    fs.writeFileSync(`${dir}/${name}`, whitePng);
}
console.log('Generated 10 MRI masks');
