// Dev harness: the real renderer with a fake rgb bridge and this PC's devices. node mock/bento/harness.js [page]
const fs = require('fs'), path = require('path');
const z = (...n) => n.map(([name, leds]) => ({ name, leds }));
const dev = (key, name, type, zones, firmware = '') => ({ key, name, type, zones, firmware, leds: zones.reduce((a, x) => a + x.leds, 0) });
const ST = {
  devices: [
    dev('ram0', 'ENE DRAM', 1, z(['DRAM', 8])), dev('ram1', 'ENE DRAM', 1, z(['DRAM', 8])), dev('ram2', 'ENE DRAM', 1, z(['DRAM', 8])), dev('ram3', 'ENE DRAM', 1, z(['DRAM', 8])),
    dev('gpu', 'Sapphire RX 6700 XT Nitro+', 2, z(['Fans', 20], ['Logo', 6])),
    dev('hub', 'NZXT Smart Device V2', 4, z(['Channel 1', 20], ['Channel 2', 20]), '1.13.2'),
    dev('wraith', 'AMD Wraith Prism', 3, z(['Logo', 1], ['Fan', 1], ['Ring', 15])),
    dev('mouse', 'SteelSeries Aerox 3 Wireless', 6, z(['Front', 1], ['Middle', 1], ['Rear', 1])),
    dev('board', 'ASUS TUF GAMING X570-PLUS', 0, z(['Aura Mainboard', 2], ['Aura Addressable 1', 0], ['Aura Addressable 2', 0])),
  ],
  openrgb: { ok: true, msg: 'connected' }, sensors: { ok: true, msg: 'live', admin: true }, hw: [], controls: [], guard: false, conflicts: null, version: '1.0.0', update: { kind: 'current', text: 'Up to date · 1.0.0' }, setup: { openrgb: true, pawnio: true, busy: '', bundled: true },
  drivers: { checking: false, at: Date.now(), lhm: '0.9.6.0', busy: '', msg: '',
    openrgb: { installed: '1.1.0', latest: 'release_1.1', pinned: '1.1.0', act: '' }, pawnio: { installed: '2.2.0.0', latest: '2.2.0', pinned: '2.2.0', act: '' },
    windows: [
      { id: 'chipset', name: 'AMD chipset', what: 'Board drivers: GPIO, SMBus, PSP.', device: 'AMD SMBus', state: 'ok', installed: '8.09.28.1124' },
      { id: 'radeon', name: 'AMD Software', what: 'Radeon graphics driver.', device: 'Microsoft Basic Display Adapter', state: 'inbox', installed: '' },
      { id: 'realtek', name: 'Realtek network', what: 'Wired network on the board.', device: 'Realtek Gaming GbE Family Controller', state: 'inbox', inboxOk: true, installed: '' },
      { id: 'fresco', name: 'Fresco Logic USB 3', what: 'USB 3 card. Windows has no driver for it.', device: 'USB Controller', state: 'none', installed: '' },
    ] },
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
  .replace('</body>', `<script>setTimeout(() => document.querySelector('[data-page=${process.argv[2] || 'lighting'}]').click(), 50)</script></body>`);
fs.writeFileSync(path.join(__dirname, 'harness.html'), html);
