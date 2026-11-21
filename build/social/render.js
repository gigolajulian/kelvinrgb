// Builds thumb.html (template + hairline kernel + the Setup sheet's three figures) and renders the GitHub social preview.
// node build/social/render.js [a|b|c ...] [--out=dir]   PNGs land in --out (default D:/KelvinRGB-social).
const fs = require('fs');
const path = require('path');
const { chromium } = require(path.join(process.env.LOCALAPPDATA, 'hairline-look/node_modules/playwright-core'));

const here = __dirname, repo = path.join(here, '../..');
const kernel = fs.readFileSync('C:/Users/Julian/.claude/skills/hairline-create/kernel.js', 'utf8');
let h = fs.readFileSync(path.join(here, 'thumb.tpl.html'), 'utf8').replace('/*KERNEL*/', () => kernel);
for (const n of ['ring', 'chip', 'fan']) h = h.replace(`/*${n.toUpperCase()}*/`, () => fs.readFileSync(path.join(repo, 'mock/setup', n + '.js'), 'utf8'));
const html = path.join(here, 'thumb.html');
fs.writeFileSync(html, h);

const args = process.argv.slice(2);
const out = (args.find((a) => a.startsWith('--out=')) || '--out=D:/KelvinRGB-social').slice(6);
const vs = args.filter((a) => !a.startsWith('--'));
fs.mkdirSync(out, { recursive: true });

(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await b.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
  for (const v of vs.length ? vs : ['a', 'b', 'c']) {
    await p.goto('file:///' + html.replace(/\\/g, '/') + '?v=' + v);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(1500); // figures settle to rest
    const f = path.join(out, `social-${v}.png`);
    await p.screenshot({ path: f });
    console.log(f, fs.statSync(f).size);
  }
  await b.close();
})();
