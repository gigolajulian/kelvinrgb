// Dev harness: the real renderer with a fake rgb bridge and this PC's devices. node mock/bento/harness.js
const fs = require('fs'), path = require('path');
const z = (...n) => n.map(([name, leds]) => ({ name, leds }));
const dev = (key, name, type, zones) => ({ key, name, type, zones, leds: zones.reduce((a, x) => a + x.leds, 0) });
const ST = {
  devices: [
    dev('ram0', 'ENE DRAM', 1, z(['DRAM', 8])), dev('ram1', 'ENE DRAM', 1, z(['DRAM', 8])), dev('ram2', 'ENE DRAM', 1, z(['DRAM', 8])), dev('ram3', 'ENE DRAM', 1, z(['DRAM', 8])),
    dev('gpu', 'Sapphire RX 6700 XT Nitro+', 2, z(['Fans', 20], ['Logo', 6])),
    dev('hub', 'NZXT Smart Device V2', 4, z(['Channel 1', 20], ['Channel 2', 20])),
    dev('wraith', 'AMD Wraith Prism', 3, z(['Logo', 1], ['Fan', 1], ['Ring', 15])),
    dev('mouse', 'SteelSeries Aerox 3 Wireless', 6, z(['Front', 1], ['Middle', 1], ['Rear', 1])),
    dev('board', 'ASUS TUF GAMING X570-PLUS', 0, z(['Aura Mainboard', 2], ['Aura Addressable 1', 0], ['Aura Addressable 2', 0])),
  ],
  openrgb: { ok: true, msg: 'connected' }, sensors: { ok: true, msg: 'live', admin: true }, hw: [], controls: [], guard: false, conflicts: null, version: '0.3.4', update: {}, setup: false,
};
const S = { lighting: { on: true, effect: 'static', color: '#c8323c', brightness: 80, speed: 50 }, devices: { board: { brightness: 70 }, mouse: { zones: { 0: '#2f5bff', 1: '#2f5bff', 2: '#2f5bff' } } }, fans: {}, glass: true, setupSeen: true };
const stub = `window.rgb = new Proxy({ get: async () => ({ settings: ${JSON.stringify(S)}, state: ${JSON.stringify(ST)}, floor: 25 }), onState() {}, onSettings() {} }, { get: (t, k) => t[k] || ((...a) => console.log('rgb.' + k, JSON.stringify(a))) });`;
const R = path.join(__dirname, '../../renderer').split(path.sep).join('/');
// Everything inlined, so it also opens as a snapshot (the Browser pane loads no relative files).
const rd = (f) => fs.readFileSync(path.join(R, f));
const css = rd('style.css').toString().replace(/url\((fonts\/[^)]+)\)/g, (_, f) => `url(data:font/woff2;base64,${rd(f).toString('base64')})`);
const html = rd('index.html').toString()
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
  .replace('<link rel="stylesheet" href="style.css">', () => `<style>${css}</style>`)
  .replace('src="icon.png"', `src="data:image/png;base64,${rd('icon.png').toString('base64')}"`)
  .replace(/<script src="([^"]+)"><\/script>/g, (_, f) => `<script>${rd(f).toString().replace(/<\/script/g, '<\\/script')}</script>`)
  .replace('<body>', () => `<body><script>${stub}</script>`)
  .replace('</body>', `<script>setTimeout(() => document.querySelector('[data-page=devices]').click(), 50)</script></body>`);
fs.writeFileSync(path.join(__dirname, 'harness.html'), html);
