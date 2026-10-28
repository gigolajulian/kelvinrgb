// openrgb-sdk 0.6.0 pads flag bitfields with Array(known - actual), which throws when
// OpenRGB 1.1 sends more flag bits than the SDK knows (seen on NZXT Smart Device V2 / Wraith Prism).
// Runs on postinstall. Idempotent.
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '..', 'node_modules', 'openrgb-sdk', 'dist', 'device.js');
const src = fs.readFileSync(file, 'utf8');
const out = src.replace(/Array\((\w+)\.length - (\w+)\.length\)/g, 'Array(Math.max(0, $1.length - $2.length))');
if (out !== src) fs.writeFileSync(file, out);
console.log(out !== src ? 'patched openrgb-sdk flag parsing' : 'openrgb-sdk already patched');
