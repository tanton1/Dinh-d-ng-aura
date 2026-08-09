const fs = require('fs');
let manifest = JSON.parse(fs.readFileSync('public/manifest.webmanifest', 'utf8'));

manifest.icons = [
  {
    "src": "aura-logo.png",
    "sizes": "512x512",
    "type": "image/png",
    "purpose": "any maskable"
  }
];

fs.writeFileSync('public/manifest.webmanifest', JSON.stringify(manifest, null, 2));
