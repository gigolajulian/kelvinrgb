// Renderer: four pages built from strings, live values patched in place on every state push.
let S;            // settings (local copy, sent back to main on change)
let ST;           // latest state from main
let FLOOR = 25;
let page = 'monitoring';
const history = new Map(); // sensor id -> last 60 values
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const main = $('#page');

const EFFECTS = [['static', 'Static'], ['breathing', 'Breathing'], ['spectrum', 'Spectrum cycle'], ['wave', 'Wave'], ['off', 'Off']];
const SWATCHES = ['#c8323c', '#2fb8cf', '#e08a2c', '#f2efe8', '#6a4cc8'];
const PRESETS = {
  Quiet: [[30, 25], [55, 30], [70, 50], [85, 80], [95, 100]],
  Balanced: [[30, 25], [50, 35], [65, 55], [80, 85], [90, 100]],
  Performance: [[30, 35], [45, 50], [60, 70], [75, 90], [85, 100]],
};

// ---------- sensor lookups ----------
function sensors() { return ST ? ST.hw.flatMap((h) => h.sensors.map((s) => ({ ...s, hwName: h.name, hwType: h.type }))) : []; }
function pick(hwType, type, nameRe) {
  const all = sensors().filter((s) => hwType.test(s.hwType) && s.type === type && !/virtual/i.test(s.hwName));
  return all.find((s) => nameRe.test(s.name)) || all[0] || null;
}
const cpuTemp = () => pick(/^Cpu$/, 'Temperature', /Tctl|Package|Tdie/);
const gpuTemp = () => pick(/^Gpu/, 'Temperature', /GPU Core|Edge/);
const memLoad = () => pick(/^Memory$/, 'Load', /^Memory$/);
const cpuLoad = () => pick(/^Cpu$/, 'Load', /CPU Total/);
const gpuClock = () => pick(/^Gpu/, 'Clock', /GPU Core/);
function fanRpm(c) {
  const h = ST.hw.find((x) => x.name === c.hw);
  const s = h && h.sensors.find((x) => x.type === 'Fan' && x.index === c.index);
  return s ? Math.round(s.value) : null;
}
function fanName(c) { return (S.fans[c.id] && S.fans[c.id].label) || c.name.replace('Fan Control', 'Fan'); }

// ---------- shared bits ----------
const slider = (id, label, min, max, value, shown) =>
  `<label class="slider"><span><span class="lbl">${label}</span><span class="lbl num soft" id="${id}-v">${shown ?? value}</span></span><input type="range" id="${id}" min="${min}" max="${max}" value="${value}"></label>`;
const helpBtn = (id) => `<button class="help" aria-label="Help" aria-expanded="false" data-help="${id}">?</button>`;
const seg = (name, opts, cur) => `<div class="seg" role="group" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" aria-pressed="${v === cur}">${l}</button>`).join('')}</div>`;
const typeLabel = (t) => ['mb', 'ram', 'gpu', 'cooler', 'strip', 'keyboard', 'mouse', 'mousemat', 'headset', 'stand', 'pad', 'light', 'speaker', 'virtual', 'storage', 'case', 'mic', 'accessory', 'keypad', 'laptop', 'monitor'][t] || 'device';

function tune(hex, dev = {}) {
  const n = parseInt(hex.slice(1), 16);
  const g = dev.gain || [1, 1, 1];
  const gm = dev.gamma || 2.2;
  return '#' + [n >> 16 & 255, n >> 8 & 255, n & 255]
    .map((v, i) => Math.round(255 * Math.min(1, Math.pow(v / 255, gm / 2.2) * g[i])).toString(16).padStart(2, '0')).join('');
}

function gauge(id, label, sub, unit) {
  return `<section class="panel"><div style="display:flex;flex-direction:column;gap:2px"><span>${label}</span><span class="lbl" id="${id}-sub">${sub}</span></div>
  <svg class="gauge" viewBox="0 0 140 140" width="150" height="150" role="img" aria-labelledby="${id}-n">
    <circle cx="70" cy="70" r="56" fill="none" stroke="#1e2124" stroke-width="6"/>
    <circle id="${id}-arc" cx="70" cy="70" r="56" fill="none" stroke="#8fd3e0" stroke-width="6" stroke-dasharray="0 352" transform="rotate(-90 70 70)"/>
    <text id="${id}-n" x="70" y="74" text-anchor="middle" font-family="Consolas, monospace" font-size="30" fill="#e4e4e1">-</text>
    <text x="70" y="94" text-anchor="middle" font-family="Consolas, monospace" font-size="10" fill="#8b9096">${unit}</text>
  </svg></section>`;
}
function setGauge(id, s, max) {
  const n = $(`#${id}-n`); if (!n) return;
  n.textContent = s ? Math.round(s.value) : '-';
  $(`#${id}-arc`).setAttribute('stroke-dasharray', `${s ? Math.min(1, s.value / max) * 352 : 0} 352`);
  if (s) $(`#${id}-sub`).textContent = `${s.hwName} · ${s.name}`;
}
function spark(id, label) {
  return `<section class="panel full"><div class="row"><div style="display:flex;flex-direction:column;gap:2px"><span>${label}</span><span class="lbl" id="${id}-sub">1 min</span></div><span class="grow"></span><span class="num" style="font-size:20px" id="${id}-n">-</span></div>
  <svg viewBox="0 0 600 120" width="100%" height="120" preserveAspectRatio="none" aria-hidden="true"><g stroke="#1e2124"><line x1="0" y1="5" x2="600" y2="5"/><line x1="0" y1="60" x2="600" y2="60"/><line x1="0" y1="115" x2="600" y2="115"/></g>
  <polyline id="${id}-line" fill="none" stroke="#8fd3e0" stroke-width="1.5" vector-effect="non-scaling-stroke" points=""/></svg>
  <div class="row" style="justify-content:space-between"><span class="lbl">-1m</span><span class="lbl">-30s</span><span class="lbl">now</span></div></section>`;
}
function setSpark(id, s, unit, max) {
  const n = $(`#${id}-n`); if (!n || !s) return;
  n.textContent = `${Math.round(s.value)} ${unit}`;
  $(`#${id}-sub`).textContent = `${s.hwName} · 1 min`;
  const h = history.get(s.id) || [];
  const top = max || Math.max(1, ...h) * 1.1;
  $(`#${id}-line`).setAttribute('points', h.map((v, i) => `${(i + 60 - h.length) * 10},${115 - (v / top) * 110}`).join(' '));
}

// ---------- pages ----------
const pages = {
  monitoring: {
    build() {
      main.innerHTML = `<header class="top"><span class="lbl">monitoring</span><span class="grow"></span>${helpBtn('h-mon')}</header>
      <p class="helptext" id="h-mon" hidden>Live readings from LibreHardwareMonitor, once a second. Needs admin and the PawnIO driver. All sensors are listed at the bottom.</p>
      <div class="grid">
        ${gauge('g-cpu', 'CPU temperature', 'cpu', '°C')}
        ${gauge('g-gpu', 'GPU temperature', 'gpu', '°C')}
        ${gauge('g-mem', 'Memory load', 'memory', '%')}
        <section class="panel"><div style="display:flex;flex-direction:column;gap:2px"><span>Fans</span><span class="lbl">rpm · duty</span></div><div id="m-fans" class="list" style="gap:8px"></div></section>
        ${spark('s-cpu', 'CPU load')}
        ${spark('s-gpu', 'GPU core clock')}
        <details class="panel full"><summary class="lbl" style="cursor:pointer">all sensors</summary><table class="sensors" id="m-all"></table></details>
      </div>`;
    },
    live() {
      setGauge('g-cpu', cpuTemp(), 100);
      setGauge('g-gpu', gpuTemp(), 100);
      setGauge('g-mem', memLoad(), 100);
      setSpark('s-cpu', cpuLoad(), '%', 100);
      setSpark('s-gpu', gpuClock(), 'MHz');
      $('#m-fans').innerHTML = ST.controls.length ? ST.controls.map((c) =>
        `<div class="row" style="justify-content:space-between"><span>${esc(fanName(c))}</span><span class="num" style="font-size:13px">${fanRpm(c) ?? '-'} · ${Math.round(c.value)}%</span></div>`).join('')
        : '<span class="helptext">No fan headers found yet.</span>';
      const tbl = $('#m-all');
      if (tbl && tbl.closest('details').open) {
        tbl.innerHTML = sensors().map((s) => `<tr><td class="lbl">${esc(s.hwName)}</td><td>${esc(s.name)}</td><td class="lbl">${s.type}</td><td>${s.value}</td></tr>`).join('');
      }
    },
  },

  lighting: {
    build() {
      const L = S.lighting;
      main.innerHTML = `<header class="top"><span class="lbl">lighting</span><span class="grow"></span>${helpBtn('h-light')}</header>
      <p class="helptext" id="h-light" hidden>One effect drives every device OpenRGB found. Per-device brightness and color tuning live on the Devices page. Close SignalRGB first: both apps fight over the same devices.</p>
      <section class="panel"><div class="row"><span class="lbl">devices</span><span class="grow"></span><span class="lbl" id="l-count"></span></div><div class="wrap" id="l-devs" style="gap:8px"></div></section>
      <div class="wrap">
        <section class="panel" style="flex:1 1 220px;padding:12px;gap:2px"><span class="lbl" style="padding:4px 8px 10px">effects</span>
          <div class="list" id="l-effects">${EFFECTS.map(([v, l]) => `<button data-v="${v}" aria-pressed="${v === L.effect}">${l}</button>`).join('')}</div></section>
        <section class="panel" style="flex:999 1 420px;min-width:0">
          <span class="lbl">color</span>
          <div class="row" style="flex-wrap:wrap;gap:14px">
            <input type="color" id="l-color" value="${L.color}" aria-label="Color" style="width:96px;height:96px;border:0;padding:0;background:none">
            <div style="display:flex;flex-direction:column;gap:12px">
              <div class="row" style="gap:6px">${SWATCHES.map((c) => `<button class="swatch" data-c="${c}" aria-label="${c}" aria-pressed="${c === L.color}" style="background:${c}"></button>`).join('')}</div>
              <label class="row"><span class="lbl">hex</span><input type="text" id="l-hex" class="num" value="${L.color}" style="width:110px"></label>
            </div>
          </div>
          ${slider('l-speed', 'speed', 0, 100, L.speed)}
        </section>
      </div>`;
      $('#l-effects').onclick = (e) => { const b = e.target.closest('button'); if (b) setLighting({ effect: b.dataset.v }); };
      $('#l-color').oninput = (e) => setLighting({ color: e.target.value }, false);
      $('#l-hex').onchange = (e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && setLighting({ color: e.target.value.toLowerCase() });
      $$('.swatch').forEach((b) => (b.onclick = () => setLighting({ color: b.dataset.c })));
      $('#l-speed').oninput = (e) => { $('#l-speed-v').textContent = e.target.value; setLighting({ speed: +e.target.value }, false); };
    },
    live() {
      $('#l-count').textContent = `${ST.devices.length} devices · ${ST.devices.reduce((a, d) => a + d.leds, 0)} leds`;
      $('#l-devs').innerHTML = ST.devices.map((d) =>
        `<span class="row" style="padding:8px 10px;border:1px solid var(--line2);border-radius:6px"><span class="dot" style="background:${S.lighting.on && S.lighting.effect !== 'off' ? tune(S.lighting.color, S.devices[d.key]) : '#3a3d41'}"></span>${esc(d.name)}</span>`).join('')
        || '<span class="helptext">Waiting for OpenRGB.</span>';
    },
  },

  devices: {
    sel: null,
    build() {
      const d = ST.devices.find((x) => x.key === this.sel) || ST.devices[0];
      this.sel = d && d.key;
      const cfg = (d && S.devices[d.key]) || {};
      const g = cfg.gain || [1, 1, 1];
      main.innerHTML = `<div class="wrap" style="align-items:flex-start">
      <section style="flex:1 1 240px;max-width:320px;display:flex;flex-direction:column;gap:2px">
        <div class="row" style="padding:0 4px 10px"><span class="lbl">devices · ${ST.devices.length}</span><span class="grow"></span><button class="btn" id="d-rescan">Rescan</button></div>
        <div class="list" id="d-list">${ST.devices.map((x) => `<button data-k="${esc(x.key)}" aria-pressed="${x.key === this.sel}"><span class="dot" style="background:${x.leds ? tune(S.lighting.color, S.devices[x.key]) : '#3a3d41'}"></span><span class="grow">${esc(x.name)}</span><span class="lbl">${x.leds || 'no leds'}</span></button>`).join('')}</div>
        ${ST.devices.length ? '' : '<p class="helptext">No devices yet. Is OpenRGB running with the SDK server on?</p>'}
      </section>
      ${d ? `<div style="flex:999 1 420px;min-width:0;display:flex;flex-direction:column;gap:16px">
        <header class="top"><h1 style="margin:0;font-size:20px;font-weight:500">${esc(d.name)}</h1><span class="lbl">${typeLabel(d.type)} · ${d.leds} leds · ${d.zones.length} zones</span><span class="grow"></span><button class="btn" id="d-identify">Identify</button>${helpBtn('h-dev')}</header>
        <p class="helptext" id="h-dev" hidden>Brightness balances this device against the others. Tuning scales red, green and blue before colors are sent, so whites match across devices. Gamma 2.2 means unchanged.</p>
        <section class="panel">${slider('d-bright', 'device brightness', 0, 100, cfg.brightness ?? 100)}</section>
        <section class="panel"><div class="row"><span class="lbl">color tuning</span><span class="grow"></span><span class="lbl">saved per device</span></div>
          <div class="row"><div style="flex:1;display:flex;flex-direction:column;gap:6px"><div style="height:44px;border-radius:6px;background:#ffffff"></div><span class="lbl">sent white</span></div>
          <div style="flex:1;display:flex;flex-direction:column;gap:6px"><div id="d-after" style="height:44px;border-radius:6px"></div><span class="lbl">after tuning</span></div></div>
          <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px">
            ${slider('d-r', 'red', 0, 100, Math.round(g[0] * 100), g[0].toFixed(2))}
            ${slider('d-g', 'green', 0, 100, Math.round(g[1] * 100), g[1].toFixed(2))}
            ${slider('d-b', 'blue', 0, 100, Math.round(g[2] * 100), g[2].toFixed(2))}
            ${slider('d-gamma', 'gamma', 10, 30, Math.round((cfg.gamma || 2.2) * 10), (cfg.gamma || 2.2).toFixed(1))}
          </div>
          <div class="row"><button class="btn" id="d-reset">Reset</button><button class="btn" id="d-copy">Copy to all</button></div></section>
        <section class="panel" style="gap:4px"><span class="lbl" style="padding-bottom:8px">zones</span>
          ${d.zones.map((z) => `<div class="row" style="padding:8px 0;border-bottom:1px solid var(--grid)"><span class="grow">${esc(z.name)}</span><span class="num" style="font-size:12px;color:var(--mute)">${z.leds} leds</span></div>`).join('')}</section>
      </div>` : ''}</div>`;
      $('#d-rescan').onclick = () => rgb.rescan();
      $('#d-list').onclick = (e) => { const b = e.target.closest('button'); if (b) { this.sel = b.dataset.k; this.build(); } };
      if (!d) return;
      const k = d.key;
      const cur = () => S.devices[k] || (S.devices[k] = {});
      const paintAfter = () => ($('#d-after').style.background = tune('#ffffff', cur()));
      paintAfter();
      $('#d-identify').onclick = () => rgb.identify(k);
      $('#d-bright').oninput = (e) => { $('#d-bright-v').textContent = e.target.value; cur().brightness = +e.target.value; rgb.device(k, { brightness: +e.target.value }); };
      ['r', 'g', 'b'].forEach((ch, i) => ($(`#d-${ch}`).oninput = (e) => {
        const gain = [...(cur().gain || [1, 1, 1])]; gain[i] = e.target.value / 100;
        $(`#d-${ch}-v`).textContent = gain[i].toFixed(2); cur().gain = gain; rgb.device(k, { gain }); paintAfter();
      }));
      $('#d-gamma').oninput = (e) => { const gamma = e.target.value / 10; $('#d-gamma-v').textContent = gamma.toFixed(1); cur().gamma = gamma; rgb.device(k, { gamma }); paintAfter(); };
      $('#d-reset').onclick = () => { S.devices[k] = { brightness: cur().brightness }; rgb.device(k, { gain: [1, 1, 1], gamma: 2.2 }); this.build(); };
      $('#d-copy').onclick = () => { for (const x of ST.devices) { S.devices[x.key] = { ...S.devices[x.key], gain: cur().gain, gamma: cur().gamma }; rgb.device(x.key, { gain: cur().gain || [1, 1, 1], gamma: cur().gamma || 2.2 }); } };
    },
    live() {},
  },

  cooling: {
    sel: null,
    edit: null, // working copy of the selected fan's config
    build() {
      const c = ST.controls.find((x) => x.id === this.sel) || ST.controls[0];
      this.sel = c && c.id;
      const temps = sensors().filter((s) => s.type === 'Temperature');
      if (c && (!this.edit || this.edit.id !== c.id)) {
        this.edit = { id: c.id, ...structuredClone(S.fans[c.id] || { mode: 'bios', shape: 'smooth', points: PRESETS.Balanced, fixed: 50, sensor: cpuTemp() && cpuTemp().id }) };
      }
      const f = this.edit;
      main.innerHTML = `<header class="top"><span class="lbl">cooling</span><span class="grow"></span><span class="lbl">floor ${FLOOR}% · bios takes over if the app stops</span>${helpBtn('h-cool')}</header>
      <p class="helptext" id="h-cool" hidden>Pick a fan, choose Curve or Fixed, then Apply. BIOS hands the header back to the motherboard. Duty never goes below ${FLOOR}%. If the sensor service dies, the motherboard takes the fans back. If it is force-killed, fans are held at 100% until reboot. Fans are released whenever Apex runs.</p>
      <p class="helptext" id="c-unclean" hidden>The sensor service was force-killed earlier this boot, so fans left on BIOS are held at 100% until you reboot.</p>
      <div class="grid" id="c-cards" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))"></div>
      ${c ? `<section class="panel" style="flex-direction:row;flex-wrap:wrap;gap:24px">
        <div style="flex:999 1 460px;min-width:0;display:flex;flex-direction:column;gap:12px">
          <div class="row" style="flex-wrap:wrap"><span style="font-size:16px">${esc(fanName(c))}</span><span class="grow"></span>${seg('shape', [['smooth', 'Smooth'], ['linear', 'Linear'], ['stepped', 'Stepped']], f.shape)}</div>
          <svg class="curve" id="c-svg" viewBox="-36 -10 476 236" role="img" aria-label="Fan curve editor"></svg>
          <span class="lbl">drag points · double click to add · right click to remove</span>
        </div>
        <div style="flex:1 1 240px;display:flex;flex-direction:column;gap:16px">
          ${seg('mode', [['curve', 'Curve'], ['fixed', 'Fixed'], ['bios', 'BIOS']], f.mode)}
          <div id="c-fixed" ${f.mode === 'fixed' ? '' : 'hidden'}>${slider('c-fixed-r', 'fixed duty', FLOOR, 100, f.fixed ?? 50, `${f.fixed ?? 50}%`)}</div>
          <label style="display:flex;flex-direction:column;gap:6px"><span class="lbl">follows sensor</span>
            <select id="c-sensor">${temps.map((s) => `<option value="${esc(s.id)}" ${s.id === f.sensor ? 'selected' : ''}>${esc(s.hwName)} · ${esc(s.name)}</option>`).join('')}</select></label>
          <label style="display:flex;flex-direction:column;gap:6px"><span class="lbl">preset</span>
            <select id="c-preset"><option value="">Choose...</option>${Object.keys(PRESETS).map((p) => `<option>${p}</option>`).join('')}</select></label>
          <span class="grow"></span>
          <span class="lbl" id="c-dirty"></span>
          <button class="btn primary" id="c-apply" style="padding:10px 0">Apply</button>
        </div></section>` : '<p class="helptext">No controllable fan headers found. The sensor service needs admin and PawnIO.</p>'}`;
      if (!c) return;
      $$('[data-seg]').forEach((g) => (g.onclick = (e) => {
        const b = e.target.closest('button'); if (!b) return;
        f[g.dataset.seg] = b.dataset.v;
        $$('button', g).forEach((x) => x.setAttribute('aria-pressed', x === b));
        $('#c-fixed').hidden = f.mode !== 'fixed';
        this.drawCurve(); this.dirty();
      }));
      $('#c-fixed-r').oninput = (e) => { f.fixed = +e.target.value; $('#c-fixed-r-v').textContent = `${f.fixed}%`; this.dirty(); };
      $('#c-sensor').onchange = (e) => { f.sensor = e.target.value; this.drawCurve(); this.dirty(); };
      $('#c-preset').onchange = (e) => { if (e.target.value) { f.points = structuredClone(PRESETS[e.target.value]); this.drawCurve(); this.dirty(); } };
      $('#c-apply').onclick = () => { const { id, ...cfg } = f; S.fans[id] = structuredClone(cfg); rgb.fan(id, cfg); this.dirty(); };
      this.bindCurve();
      this.drawCurve();
      this.dirty();
    },
    dirty() {
      const { id, ...cfg } = this.edit;
      $('#c-dirty').textContent = JSON.stringify(cfg) === JSON.stringify(S.fans[id] || null) ? 'applied' : 'not applied yet';
    },
    drawCurve() {
      const f = this.edit;
      const X = (t) => ((t - 20) / 80) * 400;
      const Y = (d) => 200 - d * 2;
      const pts = [...f.points].sort((a, b) => a[0] - b[0]);
      // sample the real shape so smooth/stepped look like what the fan will do
      const path = [];
      for (let t = 20; t <= 100; t += 0.5) path.push(`${X(t).toFixed(1)},${Y(curve(pts, t, f.shape)).toFixed(1)}`);
      const temp = sensorById(f.sensor);
      const now = temp ? Math.max(FLOOR, curve(pts, temp.value, f.shape)) : null;
      const grid = [0, 50, 100, 150, 200].map((y) => `<line x1="0" y1="${y}" x2="400" y2="${y}"/>`).join('') + [0, 100, 200, 300, 400].map((x) => `<line x1="${x}" y1="0" x2="${x}" y2="200"/>`).join('');
      $('#c-svg').innerHTML = `<g stroke="#1e2124">${grid}</g>
        <rect x="0" y="${Y(FLOOR)}" width="400" height="${FLOOR * 2}" fill="#16181a"/>
        <line x1="0" y1="${Y(FLOOR)}" x2="400" y2="${Y(FLOOR)}" stroke="#5c6166" stroke-dasharray="3 4"/>
        <text x="396" y="${Y(FLOOR) + 16}" text-anchor="end" font-family="Consolas, monospace" font-size="9" fill="#8b9096">FLOOR ${FLOOR}%</text>
        <polyline points="${path.join(' ')}" fill="none" stroke="${f.mode === 'curve' ? '#8fd3e0' : '#5c6166'}" stroke-width="2"/>
        ${pts.map((p, i) => `<circle class="pt" data-i="${f.points.indexOf(p)}" cx="${X(p[0])}" cy="${Y(p[1])}" r="6" fill="#0d0e0f" stroke="#8fd3e0" stroke-width="2"/>`).join('')}
        ${temp ? `<line x1="${X(temp.value)}" y1="0" x2="${X(temp.value)}" y2="200" stroke="#e4e4e1" opacity=".35"/>
        <circle cx="${X(temp.value)}" cy="${Y(now)}" r="4" fill="#e4e4e1"/>
        <text x="${Math.min(X(temp.value) + 6, 330)}" y="${Y(now) - 6}" font-family="Consolas, monospace" font-size="10" fill="#e4e4e1">${Math.round(temp.value)} °C · ${Math.round(now)}%</text>` : ''}
        <g font-family="Consolas, monospace" font-size="9" fill="#8b9096">${[20, 40, 60, 80, 100].map((t) => `<text x="${X(t)}" y="216" text-anchor="middle">${t}${t === 100 ? ' °C' : ''}</text>`).join('')}
        <text x="-8" y="3" text-anchor="end">100</text><text x="-8" y="103" text-anchor="end">50</text><text x="-8" y="203" text-anchor="end">0%</text></g>`;
    },
    bindCurve() {
      const svg = $('#c-svg');
      const f = this.edit;
      const toData = (e) => {
        const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
        const q = p.matrixTransform(svg.getScreenCTM().inverse());
        return [Math.round(Math.min(100, Math.max(20, 20 + (q.x / 400) * 80))), Math.round(Math.min(100, Math.max(FLOOR, (200 - q.y) / 2)))];
      };
      let drag = null;
      svg.onpointerdown = (e) => { if (e.target.classList.contains('pt') && e.button === 0) { drag = +e.target.dataset.i; svg.setPointerCapture(e.pointerId); } };
      svg.onpointermove = (e) => { if (drag == null) return; f.points[drag] = toData(e); this.drawCurve(); };
      svg.onpointerup = () => { if (drag != null) { drag = null; f.points.sort((a, b) => a[0] - b[0]); this.drawCurve(); this.dirty(); } };
      svg.ondblclick = (e) => { f.points.push(toData(e)); f.points.sort((a, b) => a[0] - b[0]); this.drawCurve(); this.dirty(); };
      svg.oncontextmenu = (e) => {
        e.preventDefault();
        if (e.target.classList.contains('pt') && f.points.length > 2) { f.points.splice(+e.target.dataset.i, 1); this.drawCurve(); this.dirty(); }
      };
    },
    live() {
      const box = $('#c-cards'); if (!box) return;
      $('#c-unclean').hidden = !ST.sensors.unclean;
      box.innerHTML = ST.controls.map((c) => {
        const f = S.fans[c.id];
        const mode = !f || f.mode === 'bios' ? (c.ours ? 'held 100% until reboot' : 'bios') : f.mode === 'fixed' ? `fixed ${f.fixed}%` : 'curve';
        return `<button class="fancard" data-id="${esc(c.id)}" aria-pressed="${c.id === this.sel}"><span class="row" style="width:100%"><span class="grow">${esc(fanName(c))}</span><span class="lbl">${esc(c.hw)}</span></span>
          <span class="big">${fanRpm(c) ?? '-'}<span style="font-size:12px;color:var(--mute)"> rpm</span></span><span class="lbl">${Math.round(c.value)}% · ${mode}</span></button>`;
      }).join('');
      box.onclick = (e) => { const b = e.target.closest('.fancard'); if (b && b.dataset.id !== this.sel) { this.sel = b.dataset.id; this.edit = null; this.build(); this.live(); } };
      if ($('#c-svg') && !document.querySelector('#c-svg:active')) this.drawCurve();
    },
  },
};

function curve(points, temp, shape) {
  const p = [...points].sort((a, b) => a[0] - b[0]);
  if (temp <= p[0][0]) return p[0][1];
  if (temp >= p[p.length - 1][0]) return p[p.length - 1][1];
  for (let i = 1; i < p.length; i++) {
    if (temp > p[i][0]) continue;
    const [t0, d0] = p[i - 1]; const [t1, d1] = p[i];
    if (shape === 'stepped') return d0;
    let k = (temp - t0) / (t1 - t0);
    if (shape === 'smooth') k = k * k * (3 - 2 * k);
    return d0 + (d1 - d0) * k;
  }
}
function sensorById(id) { return sensors().find((s) => s.id === id) || null; }

// ---------- chrome ----------
function setLighting(patch, rebuild = true) {
  Object.assign(S.lighting, patch);
  rgb.lighting(patch);
  footer();
  if (rebuild && page === 'lighting') { pages.lighting.build(); pages.lighting.live(); }
}
function footer() {
  const L = S.lighting;
  $('#ft-swatch').style.background = L.effect === 'off' || !L.on ? '#2a2c2f' : L.color;
  $('#ft-effect').textContent = EFFECTS.find((e) => e[0] === L.effect)[1];
  $('#ft-sub').textContent = `${L.color} · all devices`;
  $('#ft-power').setAttribute('aria-pressed', L.on);
  $('#ft-bright').value = L.brightness;
  $('#ft-bright-v').textContent = L.brightness;
}
$('#ft-power').onclick = () => setLighting({ on: !S.lighting.on });
$('#ft-bright').oninput = (e) => setLighting({ brightness: +e.target.value }, false);

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-help]');
  if (!b) return;
  const p = document.getElementById(b.dataset.help);
  p.hidden = !p.hidden;
  b.setAttribute('aria-expanded', !p.hidden);
});
$$('nav [data-page]').forEach((b) => (b.onclick = () => go(b.dataset.page)));

function go(p) {
  page = p;
  $$('nav [data-page]').forEach((b) => (b.dataset.page === p ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  pages[p].build();
  if (ST) pages[p].live();
}

// In-app conflict list: main sends state.conflicts and flips each row's running flag as apps close.
let cfLast = '';
let audio;
// Soft two-note chime when a row turns green: rising fifth (E6 then B6), bell-like decay.
function tick() {
  audio ||= new AudioContext();
  const t0 = audio.currentTime;
  [[1318.5, 0], [1975.5, 0.11]].forEach(([f, d]) => {
    const t = t0 + d, o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + 0.5);
  });
}
function conflicts(c) {
  const el = $('#conflicts');
  if (!c) { el.hidden = true; cfLast = ''; return; }
  const key = JSON.stringify(c);
  if (key === cfLast) return;
  const opening = !cfLast;
  const was = opening ? [] : JSON.parse(cfLast);
  if (c.some((x) => !x.running && was.find((w) => w.name === x.name)?.running)) tick();
  cfLast = key;
  const left = c.filter((x) => x.running).length;
  $('#cf-count').textContent = left ? `conflicts · ${left} of ${c.length} running` : `conflicts · all ${c.length} closed`;
  $('#cf-list').innerHTML = c.map((x) => `<li class="${x.running ? 'on' : 'off'}"><span class="dot"></span>
    <span class="grow">${esc(x.label)}<small>${esc(x.note)}</small></span>
    ${!x.running ? '<span class="lbl state">closed</span>'
      : x.closable ? `<button class="btn" data-close="${esc(x.name)}">Close</button>`
      : x.service ? `<button class="btn" data-close="${esc(x.name)}">Stop service</button>`
      : '<span class="lbl state">close it yourself</span>'}</li>`).join('');
  const done = $('#cf-done');
  done.textContent = left ? 'Continue anyway' : 'Continue';
  done.classList.toggle('primary', !left);
  el.hidden = false;
  if (opening || !left) ($('#cf-list [data-close]') || done).focus();
}
$('#cf-list').onclick = (e) => { const b = e.target.closest('[data-close]'); if (b) { b.disabled = true; b.textContent = 'Closing'; rgb.conflictClose(b.dataset.close); } };
$('#cf-done').onclick = () => rgb.conflictDone();
document.addEventListener('keydown', (e) => { if (cfLast && e.key === 'Escape') rgb.conflictDone(); });

function onState(s) {
  conflicts(s.conflicts);
  const devicesChanged = !ST || ST.devices.map((d) => d.key).join() !== s.devices.map((d) => d.key).join();
  const fansChanged = !ST || ST.controls.map((c) => c.id).join() !== s.controls.map((c) => c.id).join();
  ST = s;
  for (const sn of sensors()) {
    const h = history.get(sn.id) || [];
    h.push(sn.value); if (h.length > 60) h.shift();
    history.set(sn.id, h);
  }
  $('#st-openrgb').textContent = s.openrgb.msg;
  $('#st-sensors').textContent = s.sensors.msg;
  $('#st-guard').textContent = s.guard ? 'active' : 'idle';
  if ((page === 'devices' && devicesChanged) || (page === 'cooling' && fansChanged)) pages[page].build();
  pages[page].live();
}

rgb.get().then((r) => {
  S = r.settings; FLOOR = r.floor;
  $('#st-conflicts').checked = S.closeConflicts !== false;
  $('#st-conflicts').onchange = (e) => { S.closeConflicts = e.target.checked; rgb.closeConflicts(e.target.checked); };
  footer();
  go(page);
  onState(r.state);
  rgb.onState(onState);
});
