// Inlines the app's real style.css (fonts as data URIs) and icons.js into one file: node mock/bento/inline.js
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '../../renderer');
const css = fs.readFileSync(path.join(R, 'style.css'), 'utf8')
  .replace(/url\((fonts\/[^)]+)\)/g, (_, f) => `url(data:font/woff2;base64,${fs.readFileSync(path.join(R, f)).toString('base64')})`);
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
  .replace('<link rel="stylesheet" href="../../renderer/style.css">', () => `<style>${css}</style>`)
  .replace('<script src="../../renderer/icons.js"></script>', () => `<script>${fs.readFileSync(path.join(R, 'icons.js'), 'utf8')}</script>`);
fs.writeFileSync(path.join(__dirname, 'Bento.html'), html);
