const fs = require('fs');
const path = require('path');

// 1x1 pixel black PNG
const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const buffer = Buffer.from(base64Png, 'base64');

fs.mkdirSync('src/argus/data/_source', { recursive: true });
fs.writeFileSync('src/argus/data/_source/mask_placeholder.png', buffer);
console.log('Created mask_placeholder.png');
