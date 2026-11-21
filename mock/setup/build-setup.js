// Assembles index.html: the setup mock, the hairline kernel, and the three figures, each in its own block scope.
const fs = require('fs');
const path = require('path');
const here = __dirname;
const kernel = fs.readFileSync('C:/Users/Julian/.claude/skills/hairline-create/kernel.js', 'utf8');
let h = fs.readFileSync(path.join(here, 'setup.tpl.html'), 'utf8');
h = h.replace('/*KERNEL*/', () => kernel);
for (const n of ['ring', 'chip', 'fan']) h = h.replace(`/*${n.toUpperCase()}*/`, () => fs.readFileSync(path.join(here, `${n}.js`), 'utf8'));
fs.writeFileSync(path.join(here, 'index.html'), h);
console.log('index.html', h.length);
