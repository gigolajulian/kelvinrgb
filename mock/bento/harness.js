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
  hw: [
    { name: 'ASUS TUF GAMING X570-PLUS', type: 'Motherboard', sensors: [] },
    { name: 'Nuvoton NCT6798D', type: 'SuperIO', sensors: [1, 2, 3, 4, 5].map((i) => ({ id: '/lpc/fan' + i, name: 'Fan #' + i, type: 'Fan', index: i - 1, value: [1180, 940, 0, 860, 870][i - 1] })) },
    { name: 'AMD Ryzen 7 3700X', type: 'Cpu', sensors: [
      { id: '/cpu/t', name: 'Core (Tctl/Tdie)', type: 'Temperature', value: 52.4 }, { id: '/cpu/l', name: 'CPU Total', type: 'Load', value: 14.2 },
      { id: '/cpu/p', name: 'Package', type: 'Power', value: 46.8 }, ...[4310, 4190, 4250, 4280, 4150, 4220, 4300, 4240].map((v, i) => ({ id: '/cpu/c' + i, name: 'Core #' + (i + 1), type: 'Clock', value: v }))] },
    { name: 'AMD Radeon RX 6700 XT', type: 'GpuAmd', sensors: [
      { id: '/gpu/t', name: 'GPU Core', type: 'Temperature', value: 44 }, { id: '/gpu/l', name: 'GPU Core', type: 'Load', value: 6 }, { id: '/gpu/c', name: 'GPU Core', type: 'Clock', value: 512 }] },
    { name: 'Generic Memory', type: 'Memory', sensors: [{ id: '/ram/l', name: 'Memory', type: 'Load', value: 31.5 }, { id: '/ram/u', name: 'Memory Used', type: 'Data', value: 20.1 }, { id: '/ram/a', name: 'Memory Available', type: 'Data', value: 11.8 }] },
  ],
  controls: [1, 2, 3, 4, 5].map((i) => ({ id: 'fan' + i, name: ['CPU Fan', 'Chassis Fan 1', 'Chassis Fan 2', 'Chassis Fan 3', 'AIO Pump'][i - 1] + ' Control', hw: 'Nuvoton NCT6798D', index: i - 1, kind: 'board', value: [42, 35, 35, 35, 60][i - 1] })),
  openrgb: { ok: true, msg: 'connected' }, sensors: { ok: true, msg: 'live', admin: true }, guard: false, conflicts: null, version: '1.0.0', update: { kind: 'current', text: 'Up to date · 1.0.0' }, setup: { openrgb: true, pawnio: true, busy: '', bundled: true },
  drivers: { checking: false, at: Date.now(), lhm: '0.9.6.0', busy: '', msg: '',
    openrgb: { installed: '1.1.0', latest: 'release_1.1', pinned: '1.1.0', act: '', tone: 'ok' }, pawnio: { installed: '2.2.0.0', latest: '2.2.0', pinned: '2.2.0', act: '', tone: 'ok' },
    windows: [
      { id: 'chipset', name: 'AMD chipset', what: 'Board drivers: GPIO, SMBus, PSP.', device: 'AMD SMBus', state: 'ok', installed: '8.09.28.1124', tone: 'ok' },
      { id: 'radeon', name: 'AMD Software', what: 'Radeon graphics driver.', device: 'Microsoft Basic Display Adapter', state: 'inbox', installed: '', tone: 'bad' },
      { id: 'realtek', name: 'Realtek network', what: 'Wired network on the board.', device: 'Realtek Gaming GbE Family Controller', state: 'inbox', inboxOk: true, installed: '', tone: 'ok' },
      { id: 'fresco', name: 'Fresco Logic USB 3', what: 'USB 3 card. Windows has no driver for it.', device: 'USB Controller', state: 'none', installed: '', tone: 'bad' },
    ] },
};
if (process.argv[3] === 'pending') Object.assign(ST.drivers.openrgb, { latest: 'release_1.2', act: 'update', tone: 'warn' });
if (process.argv[3] === 'clean') { ST.drivers.windows.forEach((w) => { w.state = 'ok'; w.installed ||= '1.0'; w.tone = 'ok'; }); }
const S = { lighting: { on: true, effect: 'static', color: '#b3121f', brightness: 80, speed: 50 }, devices: { board: { brightness: 70 }, mouse: { zones: { 0: '#2f5bff', 1: '#2f5bff', 2: '#2f5bff' } } }, fans: Object.fromEntries([1, 2, 3, 4, 5].map((i) => ['fan' + i, { mode: 'curve', shape: 'smooth', points: [[30, 25], [50, 35], [65, 55], [80, 85], [90, 100]], fixed: 50, sensor: '/cpu/t' }])), glass: true, setupSeen: true };
const stub = `window.rgb = new Proxy({ get: async () => ({ settings: ${JSON.stringify(S)}, state: ${JSON.stringify(ST)}, floor: 25 }), onState(cb) { const st = ${JSON.stringify(ST)}; let n = 0; const t = setInterval(() => { for (const h of st.hw) for (const s of h.sensors) if (s.value) s.value = +(s.value * (0.97 + Math.random() * 0.06)).toFixed(1); cb(JSON.parse(JSON.stringify(st))); if (++n >= 60) clearInterval(t); }, 15); }, onSettings() {} }, { get: (t, k) => t[k] || ((...a) => console.log('rgb.' + k, JSON.stringify(a))) });`;
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
fs.writeFileSync(path.join(__dirname, process.argv[4] || 'harness.html'), html);
