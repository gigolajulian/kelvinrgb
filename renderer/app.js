// Renderer: six screens built from strings, live values patched on every state push.
// Every hardware-derived string goes through esc(); main validates everything sent back.
let S;            // settings (local copy, sent back to main on change)
let ST;           // latest state from main
let FLOOR = 25;
let page = 'home';
const history = new Map(); // sensor id -> last 60 values (1 min)
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const main = $('#page');

const EFFECTS = [['static', 'Static'], ['breathing', 'Breathing'], ['spectrum', 'Spectrum'], ['wave', 'Wave'], ['off', 'Off']];
const SWATCHES = [['White', '#ffffff'], ['Red', '#c8323c'], ['Orange', '#ff6a1a'], ['Cobalt', '#2f5bff'], ['Teal', '#13a3a3'], ['Violet', '#8a5cff']];
const PRESETS = {
  Quiet: [[30, 25], [55, 30], [70, 50], [85, 80], [95, 100]],
  Balanced: [[30, 25], [50, 35], [65, 55], [80, 85], [90, 100]],
  Performance: [[30, 35], [45, 50], [60, 70], [75, 90], [85, 100]],
};
const TYPES = ['Board', 'RAM', 'Graphics', 'Cooler', 'Strip', 'Keyboard', 'Mouse', 'Mousemat', 'Headset', 'Stand', 'Pad', 'Light', 'Speaker', 'Virtual', 'Storage', 'Case', 'Mic', 'Accessory', 'Keypad', 'Laptop', 'Monitor'];
const typeLabel = (t) => TYPES[t] || 'Device';
const isWraith = (d) => d.name === 'AMD Wraith Prism';
const isWraithFan = (d, z) => isWraith(d) && /fan/i.test(z.name);
// Devices that sit on the desk, outside the case (the Devices page's right column).
const HUB = new Set(['Strip', 'Light', 'Fan']); // the first of these takes the case's hub slot
const DESK = new Set(['Mouse', 'Keyboard', 'Mousemat', 'Headset', 'Stand', 'Pad', 'Speaker', 'Mic', 'Keypad', 'Laptop', 'Monitor', 'Accessory']);

// ---------- sensor lookups ----------
function sensors() { return ST ? ST.hw.flatMap((h) => h.sensors.map((s) => ({ ...s, hwName: h.name, hwType: h.type }))) : []; }
function pick(hwType, type, nameRe) {
  // A 0 °C reading means the sensor isn't readable (no admin), not a cold CPU.
  const all = sensors().filter((s) => hwType.test(s.hwType) && s.type === type && !/virtual/i.test(s.hwName) && !(type === 'Temperature' && s.value <= 0));
  return all.find((s) => nameRe.test(s.name)) || all[0] || null;
}
const cpuTemp = () => pick(/^Cpu$/, 'Temperature', /Tctl|Package|Tdie/);
const gpuTemp = () => pick(/^Gpu/, 'Temperature', /GPU Core|Edge/);
const memLoad = () => pick(/^Memory$/, 'Load', /^Memory$/);
const memUsed = () => pick(/^Memory$/, 'Data', /Memory Used|Used Memory/);
const cpuLoad = () => pick(/^Cpu$/, 'Load', /CPU Total/);
const gpuLoad = () => pick(/^Gpu/, 'Load', /GPU Core/);
const gpuClock = () => pick(/^Gpu/, 'Clock', /GPU Core/);
// Why the Cooling page has no fans, and the one step that fixes it.
function fanHelp() {
  const m = ST ? ST.sensors : { ok: false, msg: 'starting' };
  if (ST && ST.guard) return 'Fans are back on BIOS while Apex runs. They return when the game closes.';
  if (/missing/.test(m.msg)) return 'The sensor service files are missing. Reinstall KelvinRGB from the latest release.';
  if (!m.ok) return `The sensor service is not running (${m.msg}).`;
  if (m.admin === false) return 'KelvinRGB is not running as admin. Close it and start it again, then click Yes on the Windows prompt.';
  return 'No fan controller answered. Install the PawnIO driver (pawnio.eu), then restart KelvinRGB. Fans on a hub or the GPU are not controlled here.';
}
const sensorById = (id) => sensors().find((s) => s.id === id) || null;
function fanRpm(c) {
  const h = ST.hw.find((x) => x.name === c.hw);
  const s = h && h.sensors.find((x) => x.type === 'Fan' && x.index === c.index);
  return s ? Math.round(s.value) : null;
}
const fanName = (c) => (S.fans[c.id] && S.fans[c.id].label) || c.name.replace('Fan Control', 'Fan');
const lightsOn = () => S.lighting.on && S.lighting.effect !== 'off';

// ---------- shared bits ----------
const slider = (id, label, min, max, value, shown) =>
  `<label class="slider"><span><span class="lbl">${label}</span><span class="num sub" id="${id}-v">${shown ?? value}</span></span><input type="range" id="${id}" min="${min}" max="${max}" value="${value}"></label>`;
const seg = (name, opts, cur) => `<div class="seg" role="group" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" aria-pressed="${v === cur}">${l}</button>`).join('')}</div>`;
const val = (s, d = 0) => (s ? s.value.toFixed(d) : '-');
const pct = (s, max = 100) => (s ? Math.min(100, Math.max(0, (s.value / max) * 100)) : 0);
function sparkPts(id, top) {
  const h = history.get(id) || [];
  const max = top || Math.max(1, ...h) * 1.1;
  return h.map((v, i) => `${(i + 60 - h.length) * 10},${38 - (v / max) * 34}`).join(' ');
}
const spark = (id, top) => `<svg class="spark" viewBox="0 0 600 40" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="#8fd3e0" stroke-width="1.5" vector-effect="non-scaling-stroke" points="${id ? sparkPts(id, top) : ''}"/></svg>`;

function tune(hex, dev = {}) {
  const n = parseInt(hex.slice(1), 16);
  const g = dev.gain || [1, 1, 1];
  const gm = dev.gamma || 2.2;
  return '#' + [n >> 16 & 255, n >> 8 & 255, n & 255]
    .map((v, i) => Math.round(255 * Math.min(1, Math.pow(v / 255, gm / 2.2) * g[i])).toString(16).padStart(2, '0')).join('');
}
// HSV for the colour pad: hue 0..360, saturation and value 0..1.
function hsv(hex) {
  const n = parseInt(hex.slice(1), 16), [r, g, b] = [n >> 16 & 255, n >> 8 & 255, n & 255].map((v) => v / 255);
  const mx = Math.max(r, g, b), c = mx - Math.min(r, g, b);
  const h = !c ? 0 : mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4;
  return [(h * 60 + 360) % 360, mx ? c / mx : 0, mx];
}
function fromHsv(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return '#' + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
const hueHex = (h) => fromHsv(h, 1, 1);
// Lighting zone ids are 'deviceKey:zone'; keys can hold colons ("I2C: 0x70"), so split on the last one.
const zsplit = (z) => { const i = z.lastIndexOf(':'); return [z.slice(0, i), z.slice(i + 1)]; };
function fanHex(v) { // yellow to white, measured on the Wraith blade
  const t = Math.max(0, Math.min(1, ((v ?? 240) - 184) / 56));
  return '#' + [[255, 255], [199, 255], [90, 255]].map(([a, b]) => Math.round(a + (b - a) * t).toString(16).padStart(2, '0')).join('');
}
function zoneColor(d, zi) {
  const z = d.zones[zi], dev = S.devices[d.key] || {};
  if (isWraithFan(d, z)) return fanHex(S.lighting.on && !dev.off ? dev.fanWhite : 0); // red + green never turn off
  if (dev.off) return '#1b1c1e';
  if (!lightsOn()) return '#1b1c1e';
  return (dev.zones && dev.zones[zi]) || tune(S.lighting.color, dev);
}

// ---------- pages ----------
const pages = {
  home: {
    build() {
      main.innerHTML = `<div class="hd"><h1 id="h-title">KelvinRGB</h1><span class="sub" id="h-sub"></span></div>
      <div class="grid c4">
        <div class="g"><span class="lbl">cpu</span><div class="big" style="margin:10px 0 8px"><span id="h-cpu">-</span><small>°C</small></div><div class="meter"><i id="h-cpu-m"></i></div><div class="sub" style="margin-top:8px" id="h-cpu-s"></div></div>
        <div class="g"><span class="lbl">gpu</span><div class="big" style="margin:10px 0 8px"><span id="h-gpu">-</span><small>°C</small></div><div class="meter"><i id="h-gpu-m"></i></div><div class="sub" style="margin-top:8px" id="h-gpu-s"></div></div>
        <div class="g"><span class="lbl">memory</span><div class="big" style="margin:10px 0 8px"><span id="h-mem">-</span><small>%</small></div><div class="meter"><i id="h-mem-m"></i></div><div class="sub" style="margin-top:8px" id="h-mem-s"></div></div>
        <div class="g"><span class="lbl">fans</span><div class="big" style="margin:10px 0 8px"><span id="h-fans">-</span><small id="h-fans-of"></small></div><div class="meter"><i id="h-fans-m" style="background:var(--ok)"></i></div><div class="sub" style="margin-top:8px" id="h-fans-s"></div></div>
      </div>
      <div class="grid c2">
        <div class="g row" style="gap:16px"><span class="sw" id="h-sw" style="width:54px;height:54px"></span><div style="flex:1"><span class="lbl">lighting</span><div style="font-size:17px;font-weight:500;margin-top:4px" id="h-fx"></div><div class="sub" id="h-fx-s"></div></div><button class="btn" data-go="lighting">Change</button></div>
        <div class="g"><div class="row" style="margin-bottom:4px"><span class="lbl">cpu load · last minute</span><span class="grow"></span><span class="num sub" id="h-load"></span></div><div id="h-spark">${spark()}</div></div>
      </div>`;
    },
    live() {
      const ct = cpuTemp(), gt = gpuTemp(), ml = memLoad(), mu = memUsed(), cl = cpuLoad(), gl = gpuLoad();
      const hot = (ct && ct.value >= 85) || (gt && gt.value >= 85);
      const fans = ST.controls, spinning = fans.filter((c) => (fanRpm(c) || 0) > 0).length;
      $('#h-title').textContent = !ST.sensors.ok ? 'Starting up' : hot ? 'Running hot' : 'All good';
      $('#h-sub').textContent = ST.guard ? 'Apex is running, so lights and fans are handed back.'
        : !ST.sensors.ok ? `Waiting for sensors (${ST.sensors.msg}) and OpenRGB (${ST.openrgb.msg}).`
        : hot ? 'A temperature is over 85 °C.' : `${lightsOn() ? 'Lights on' : 'Lights off'}, fans on your settings, nothing over limit.`;
      $('#h-cpu').textContent = val(ct); $('#h-cpu-m').style.width = pct(ct) + '%'; $('#h-cpu-s').textContent = cl ? `${val(cl)}% load` : '';
      $('#h-gpu').textContent = val(gt); $('#h-gpu-m').style.width = pct(gt) + '%'; $('#h-gpu-s').textContent = gl ? `${val(gl)}% load` : '';
      $('#h-mem').textContent = val(ml); $('#h-mem-m').style.width = pct(ml) + '%'; $('#h-mem-s').textContent = mu ? `${val(mu, 1)} GB used` : '';
      $('#h-fans').textContent = fans.length ? spinning : '-'; $('#h-fans-of').textContent = fans.length ? `of ${fans.length}` : '';
      $('#h-fans-m').style.width = fans.length ? (spinning / fans.length) * 100 + '%' : '0';
      $('#h-fans-s').textContent = `spinning · ${FLOOR}% floor`;
      $('#h-sw').style.background = lightsOn() ? S.lighting.color : '#1b1c1e';
      $('#h-fx').textContent = S.lighting.on ? EFFECTS.find((e) => e[0] === S.lighting.effect)[1] : 'Lights off';
      const own = ST.devices.reduce((a, d) => a + Object.keys((S.devices[d.key] || {}).zones || {}).length, 0);
      $('#h-fx-s').textContent = `${ST.devices.length} devices${own ? ` · ${own} zones with their own colour` : ''}`;
      $('#h-load').textContent = cl ? `${val(cl)}%` : '';
      $('#h-spark').innerHTML = spark(cl && cl.id, 100);
    },
  },

  // Focus grid: one tile per device (same-name sticks such as the four DRAM modules share one tile), brightness
  // on each tile, click a tile to open its colour in place. Colour is per zone in settings; "whole device" sets every zone.
  lighting: {
    open: null, // group key of the open tile
    hue: null, // the pad's hue, kept so greys (saturation or value 0) don't reset it to red
    zone: null, // in the open tile: null = whole device, else 'deviceKey:zoneIndex' or 'deviceKey:*' for one stick
    dragging: false,
    sig: '',
    groups() {
      const out = [], byName = new Map();
      for (const d of ST.devices) {
        const twins = ST.devices.filter((x) => x.name === d.name && x.type === d.type);
        if (twins.length > 1) { if (byName.has(d.name)) continue; byName.set(d.name, 1); }
        out.push({ key: d.key, name: d.name, type: typeLabel(d.type), devs: twins.length > 1 ? twins : [d] });
      }
      return out;
    },
    build() {
      this.dragging = false; // a tray change can rebuild mid-drag
      main.innerHTML = `<div class="g lg-all" id="l-all"></div><div class="lgrid" id="l-grid"></div>`;
      const all = $('#l-all'), grid = $('#l-grid');
      all.onclick = (e) => {
        const b = e.target.closest('[data-fx],[data-c]'); if (!b) return;
        setLighting(b.dataset.fx ? { effect: b.dataset.fx } : { color: b.dataset.c });
      };
      all.oninput = (e) => {
        const t = e.target;
        if (t.id === 'l-color') setLighting({ color: t.value }, false);
        if (t.id === 'l-speed') { $('#l-speed-v').textContent = t.value; setLighting({ speed: +t.value }, false); }
        if (t.id === 'l-bright') { $('#l-bright-v').textContent = t.value + '%'; t.style.setProperty('--p', t.value + '%'); setLighting({ brightness: +t.value }, false); }
      };
      all.onchange = (e) => {
        if (e.target.id !== 'l-hex') return;
        const v = e.target.value.trim();
        if (/^#[0-9a-f]{6}$/i.test(v)) setLighting({ color: v.toLowerCase() }); else e.target.value = S.lighting.color;
      };
      grid.onclick = (e) => this.click(e);
      grid.oninput = (e) => this.input(e);
      grid.onchange = () => this.draw();
      grid.onkeydown = (e) => this.key(e);
      grid.onpointerdown = (e) => this.drag(e);
      this.paint();
      this.draw();
    },
    // The global bar. Rebuilt on effect or colour changes from here, the footer or the tray.
    paint() {
      const L = S.lighting, c = L.color, anim = ['breathing', 'spectrum', 'wave'].includes(L.effect);
      const FX = { static: c, breathing: `linear-gradient(90deg,#111,${c},#111)`, spectrum: 'linear-gradient(90deg,#c8323c,#ff6a1a,#13a3a3,#2f5bff,#8a5cff)', wave: `repeating-linear-gradient(90deg,${c} 0 5px,#111 5px 10px)`, off: '#111' };
      const a = document.activeElement, keep = a && (a.id ? '#' + a.id : a.dataset.fx ? `[data-fx="${a.dataset.fx}"]` : a.dataset.c ? `#l-all [data-c="${a.dataset.c}"]` : null);
      $('#l-all').innerHTML = `<span class="lbl">every device</span>
        <div class="fx">${EFFECTS.map(([k, l]) => `<button data-fx="${k}" aria-pressed="${k === L.effect}"><span class="pv" style="background:${FX[k]}"></span>${l}</button>`).join('')}</div>
        <div class="lg-col"><input type="color" id="l-color" class="cdot" value="${c}" aria-label="Colour"><input type="text" id="l-hex" class="num" value="${c}" aria-label="Hex colour">
          <div class="pre">${SWATCHES.map(([n, h]) => `<button data-c="${h}" aria-label="${n}" title="${n}" aria-pressed="${h === c}" style="background:${h}"></button>`).join('')}</div></div>
        <div class="lg-sl">${anim ? `<label class="ctl"><span class="lbl">speed</span><input type="range" id="l-speed" min="0" max="100" value="${L.speed}"><span class="v num" id="l-speed-v">${L.speed}</span></label>` : ''}
          <label class="ctl"><span class="lbl">brightness</span><input type="range" class="br" id="l-bright" min="0" max="100" value="${L.brightness}" style="--p:${L.brightness}%"><span class="v num" id="l-bright-v">${L.brightness}%</span></label></div>`;
      if (keep && $(keep)) $(keep).focus();
    },
    // ---- per group helpers ----
    group(k) { return this.groups().find((g) => g.key === k); },
    dev(d) { return S.devices[d.key] || {}; },
    colourZones(d) { return d.zones.map((z, i) => i).filter((i) => !isWraithFan(d, d.zones[i])); },
    // the colour a group or zone shows in the picker, and whether it is its own
    current(g, zone) {
      if (zone) {
        const [k, zi] = zsplit(zone), d = g.devs.find((x) => x.key === k), zs = this.dev(d).zones || {};
        const own = zi === '*' ? this.colourZones(d).map((i) => zs[i]).find(Boolean) : zs[zi];
        return { hex: own || S.lighting.color, own: !!own };
      }
      const owns = g.devs.flatMap((d) => this.colourZones(d).map((i) => (this.dev(d).zones || {})[i]));
      const first = owns.find(Boolean);
      return { hex: first || S.lighting.color, own: !!first, mixed: owns.some((o) => o !== first) };
    },
    setColour(g, hex) {
      const sel = this.zone ? zsplit(this.zone) : null;
      for (const d of g.devs) {
        if (sel && sel[0] !== d.key) continue;
        const zones = {};
        for (const i of this.colourZones(d)) if (!sel || sel[1] === '*' || +sel[1] === i) zones[i] = hex;
        pages.devices.patch(d.key, { zones });
      }
      if (page === 'lighting' && ST) this.refresh();
    },
    setBright(g, v) {
      v = Math.max(0, Math.min(100, Math.round(v)));
      for (const d of g.devs) pages.devices.patch(d.key, { brightness: v });
      for (const el of main.querySelectorAll(`[data-bright="${CSS.escape(g.key)}"]`)) {
        el.style.setProperty('--p', v + '%'); el.setAttribute('aria-valuenow', v);
        if (el.value != null) el.value = v;
        const out = el.parentElement.querySelector('.bv'); if (out) out.textContent = v + '%';
      }
      this.refresh();
    },
    changed(g) {
      return g.devs.some((d) => { const x = this.dev(d); return x.off || (x.brightness ?? 100) !== 100 || Object.keys(x.zones || {}).length || (isWraith(d) && (x.fanWhite ?? 240) !== 240); });
    },
    // ---- drawing ----
    leds(g) {
      const L = S.lighting, b = g.devs[0] ? (this.dev(g.devs[0]).brightness ?? 100) : 100;
      const cells = g.devs.flatMap((d) => (d.zones.length ? d.zones.map((_z, zi) => zoneColor(d, zi)) : ['#1b1c1e'])).slice(0, 16);
      return `<span class="leds" style="opacity:${(0.15 + 0.85 * (L.brightness / 100) * (b / 100)).toFixed(2)}">${cells.map((c) => `<i style="background:${c}"></i>`).join('')}</span>`;
    },
    icon(g, size, hi) {
      if (g.devs.length < 2) return deviceIcon(g.type, size, hi);
      const s = Math.round(size * 0.62);
      return `<span class="stack" style="--s:${s}px">${g.devs.map(() => deviceIcon(g.type, s, hi)).join('')}</span>`;
    },
    sub(g) { return g.devs.length > 1 ? `${g.type} · ${g.devs.length} sticks` : g.type === 'Board' ? 'Motherboard' : g.type; },
    on(g) { return g.devs.some((d) => !this.dev(d).off); },
    tile(g) {
      const b = this.dev(g.devs[0]).brightness ?? 100;
      return `<div class="g ltile" data-open="${esc(g.key)}" role="group" aria-label="${esc(g.name)}">
        ${this.changed(g) ? '<span class="chg" title="Changed from the global look"></span>' : ''}
        <button class="tg" data-on="${esc(g.key)}" aria-pressed="${this.on(g)}" aria-label="${esc(g.name)} on"></button>
        <button class="art" data-open="${esc(g.key)}" aria-label="Open ${esc(g.name)} colour">${this.icon(g, 92, false)}</button><div class="ty">${esc(this.sub(g))}</div>
        <div class="nm${this.on(g) ? '' : ' dim'}" title="${esc(g.name)}">${esc(g.name)}</div><span data-leds="${esc(g.key)}">${this.leds(g)}</span>
        <div class="scrub" data-bright="${esc(g.key)}" role="slider" tabindex="0" aria-label="${esc(g.name)} brightness" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${b}" style="--p:${b}%"><i></i><span class="bv">${b}%</span></div></div>`;
    },
    big(g) {
      const b = this.dev(g.devs[0]).brightness ?? 100, z = this.zone;
      const fanDev = z && g.devs.find((d) => d.key === zsplit(z)[0]);
      const fan = fanDev && zsplit(z)[1] !== '*' && isWraithFan(fanDev, fanDev.zones[+zsplit(z)[1]]);
      const canColour = g.devs.some((d) => this.colourZones(d).length);
      const cur = this.current(g, z), [h0, s, v] = hsv(cur.hex), h = this.hue ??= h0;
      const chips = g.devs.length > 1
        ? g.devs.map((d, i) => [`${d.key}:*`, `Stick ${i + 1}`, zoneColor(d, 0)])
        : g.devs[0].zones.map((zz, i) => [`${g.devs[0].key}:${i}`, zz.name, zoneColor(g.devs[0], i)]);
      const status = !canColour ? 'brightness only, no zones reported' : cur.mixed ? 'mixed colours' : cur.own ? `own colour ${cur.hex}` : 'global colour';
      const picker = fan
        ? `<div class="col"><span class="sw" style="width:56px;height:56px;background:${zoneColor(fanDev, +zsplit(z)[1])}"></span><p class="helptext">This LED only has a working blue input, so it goes from yellow to white. White from about 240.</p></div>
           <div class="col"><label class="ctl"><span class="lbl">fan white</span><input type="range" class="warm" id="l-fanw" min="160" max="255" value="${this.dev(fanDev).fanWhite ?? 240}"><span class="v num" id="l-fanw-v">${this.dev(fanDev).fanWhite ?? 240}</span></label>${this.brightRow(g, b)}${this.resetRow(g)}</div>`
        : `<div class="sv" id="l-sv" data-h="${h.toFixed(1)}" role="slider" tabindex="0" aria-label="Saturation and brightness of the colour" aria-valuenow="${Math.round(s * 100)}" aria-valuetext="${cur.hex}" style="--base:${hueHex(h)}"><b style="left:${s * 100}%;top:${(1 - v) * 100}%;background:${cur.hex}"></b></div>
           <div class="col"><label class="ctl"><span class="lbl">hue</span><input type="range" class="hu" id="l-hue" min="0" max="359" value="${Math.round(h)}"><span class="v num" id="l-hue-v">${cur.hex}</span></label>
             <div class="pre ind">${SWATCHES.map(([n, hx]) => `<button data-c="${hx}" aria-label="${n}" title="${n}" aria-pressed="${cur.own && hx === cur.hex}" style="background:${hx}"></button>`).join('')}</div>
             ${this.brightRow(g, b)}${this.resetRow(g)}</div>`;
      return `<div class="g ltile open" data-g="${esc(g.key)}">
        <button class="btn done" data-close="1">Done</button>
        <div class="oh">${this.icon(g, 110, true)}<div class="grow"><div class="ty">${esc(this.sub(g))}</div><div class="nm">${esc(g.name)}</div>
          <div class="row" style="margin-top:6px;gap:10px"><span data-leds="${esc(g.key)}">${this.leds(g)}</span><span class="sub" id="l-status">${status}</span>
          <button class="tg" data-on="${esc(g.key)}" aria-pressed="${this.on(g)}" aria-label="${esc(g.name)} on"></button></div></div></div>
        ${chips.length > 1 || fan ? `<div class="chips"><button class="chip" data-zone="" aria-pressed="${!z}">Whole device</button>${chips.map(([k, n, c]) => `<button class="chip" data-zone="${esc(k)}" aria-pressed="${z === k}"><span class="sw" style="background:${c}"></span>${esc(n)}</button>`).join('')}</div>` : ''}
        <div class="body2${canColour ? '' : ' nocol'}">${canColour || fan ? picker : `<div class="col">${this.brightRow(g, b)}${this.resetRow(g)}</div>`}</div></div>`;
    },
    brightRow(g, b) { return `<label class="ctl"><span class="lbl">brightness</span><input type="range" class="br" data-bright="${esc(g.key)}" min="0" max="100" value="${b}" style="--p:${b}%"><span class="v num bv">${b}%</span></label>`; },
    resetRow(g) { return `<div class="row" style="margin-top:auto"><button class="btn" data-reset="${esc(g.key)}" ${this.changed(g) ? '' : 'disabled'}>Back to the global look</button></div>`; },
    draw() {
      const grid = $('#l-grid'); if (!grid || page !== 'lighting') return;
      if (!ST.devices.length) { grid.innerHTML = `<div class="g"><p class="helptext">${esc(ST.openrgb.msg)}. Waiting for OpenRGB.</p></div>`; return; }
      const gs = this.groups();
      if (this.open && !gs.find((g) => g.key === this.open)) this.open = this.zone = null;
      const a = document.activeElement, fk = a && a.dataset && ['open', 'on', 'bright', 'zone', 'reset', 'c'].find((x) => x in a.dataset), fv = fk && a.dataset[fk], fid = a && a.id;
      grid.innerHTML = gs.map((g) => (g.key === this.open ? this.big(g) : this.tile(g))).join('');
      this.sig = ST.devices.map((d) => d.key).join();
      const back = (fid && $('#' + fid)) || (fk && [...grid.querySelectorAll(`[data-${fk}]`)].find((x) => x.dataset[fk] === fv));
      if (back) back.focus();
    },
    // Colours and labels only, so a drag or a focused control survives.
    refresh() {
      const grid = $('#l-grid'); if (!grid) return;
      const lb = $('#l-bright');
      if (lb && document.activeElement !== lb) { lb.value = S.lighting.brightness; lb.style.setProperty('--p', S.lighting.brightness + '%'); $('#l-bright-v').textContent = S.lighting.brightness + '%'; }
      for (const g of this.groups()) {
        const l = grid.querySelector(`[data-leds="${CSS.escape(g.key)}"]`); if (l) l.innerHTML = this.leds(g);
        if (g.key !== this.open) continue;
        const cur = this.current(g, this.zone);
        if ($('#l-status')) $('#l-status').textContent = cur.mixed ? 'mixed colours' : cur.own ? `own colour ${cur.hex}` : 'global colour';
        if ($('#l-hue-v')) $('#l-hue-v').textContent = cur.hex;
        const knob = $('#l-sv b'); if (knob) knob.style.background = cur.hex;
        for (const c of grid.querySelectorAll('.chip[data-zone]')) {
          const [k, zi] = zsplit(c.dataset.zone), d = g.devs.find((x) => x.key === k), sw = c.querySelector('.sw');
          if (d && sw) sw.style.background = zoneColor(d, zi === '*' ? 0 : +zi);
        }
      }
    },
    click(e) {
      const t = e.target.closest('button,[data-open]'); if (!t) return;
      const ds = t.dataset, g = this.group(ds.on || ds.reset || ds.open || this.open);
      if (ds.on) {
        const off = this.on(g);
        for (const d of g.devs) pages.devices.patch(d.key, { off });
      } else if (ds.reset) {
        for (const d of g.devs) pages.devices.patch(d.key, { off: false, brightness: 100, fanWhite: 240, zones: Object.fromEntries(Object.keys(this.dev(d).zones || {}).map((i) => [i, null])) });
      } else if (ds.c) { this.setColour(g, ds.c); }
      else if ('zone' in ds) this.zone = ds.zone || null;
      else if (ds.close) { const k = this.open; this.open = this.zone = null; this.draw(); const el = $(`button[data-open="${CSS.escape(k)}"]`); if (el) el.focus(); return; }
      else if (ds.open) { if (e.target.closest('.scrub')) return; this.open = ds.open; this.zone = null; this.hue = null; this.draw(); $('[data-close]').focus(); return; }
      else return;
      if ('zone' in ds || ds.c || ds.reset) this.hue = null;
      this.draw();
    },
    input(e) {
      const t = e.target, g = this.group(t.dataset.bright || this.open); if (!g) return;
      if (t.dataset.bright) this.setBright(g, +t.value);
      else if (t.id === 'l-hue') {
        const [, s, v] = hsv(this.current(g, this.zone).hex);
        this.setColour(g, fromHsv(+t.value, s < 0.05 ? 1 : s, v < 0.05 ? 1 : v));
        this.hue = +t.value;
        const sv = $('#l-sv'); if (sv) { sv.dataset.h = t.value; sv.style.setProperty('--base', hueHex(+t.value)); }
      } else if (t.id === 'l-fanw') {
        const d = g.devs.find((x) => x.key === zsplit(this.zone)[0]);
        $('#l-fanw-v').textContent = t.value; pages.devices.patch(d.key, { fanWhite: +t.value }); this.refresh();
      }
    },
    key(e) {
      const t = e.target;
      if (e.key === 'Escape' && this.open) { e.preventDefault(); this.click({ target: $('[data-close]') }); return; }
      const dir = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key]; if (!dir) return;
      const step = e.shiftKey ? 1 : 5;
      if (t.matches('.scrub')) { e.preventDefault(); this.setBright(this.group(t.dataset.bright), +t.getAttribute('aria-valuenow') + dir * step); }
      else if (t.id === 'l-sv') {
        e.preventDefault();
        const g = this.group(this.open), [, s, v] = hsv(this.current(g, this.zone).hex), d = step / 100;
        const horiz = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
        this.svTo(g, Math.max(0, Math.min(1, s + (horiz ? dir * d : 0))), Math.max(0, Math.min(1, v + (horiz ? 0 : dir * d))));
      }
    },
    svTo(g, s, v) {
      const sv = $('#l-sv'), hex = fromHsv(+sv.dataset.h, s, v);
      this.setColour(g, hex);
      const b = $('#l-sv b'); b.style.left = s * 100 + '%'; b.style.top = (1 - v) * 100 + '%';
      sv.setAttribute('aria-valuetext', hex);
    },
    // Scrub bars and the colour pad: drag, then one redraw on release.
    drag(e) {
      const el = e.target.closest('.scrub,#l-sv'); if (!el) return;
      e.preventDefault(); el.setPointerCapture(e.pointerId); el.focus(); this.dragging = true;
      const g = this.group(el.dataset.bright || this.open), r = el.getBoundingClientRect();
      const at = (ev) => {
        const x = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), y = Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height));
        if (el.id === 'l-sv') this.svTo(g, x, 1 - y); else this.setBright(g, x * 100);
      };
      at(e);
      el.onpointermove = at;
      el.onpointerup = el.onpointercancel = () => { el.onpointermove = el.onpointerup = el.onpointercancel = null; this.dragging = false; this.draw(); };
    },
    live() {
      if (this.dragging || !$('#l-grid')) return;
      if (ST.devices.map((d) => d.key).join() !== this.sig) this.draw(); else this.refresh();
    },
  },

  // Bento: one tile per device, laid out like the PC. Inside the case the cooler, RAM, board, graphics card and the
  // first hub or strip get fixed slots; the rest flow after them. Peripherals sit on the desk beside an All tile.
  // Each tile has its own on/off, colour and brightness; click a tile (or one RAM stick) to edit its zones and
  // tuning in the panel below. Everything that differs from the global look is listed at the top with an undo.
  devices: {
    sel: null, // device key
    zone: 0,
    dragging: false,
    // Same-name devices (the four DRAM sticks) share a tile, as on Lighting.
    groups() { return pages.lighting.groups(); },
    area(g, seen) {
      const a = { Cooler: 'cool', RAM: 'ram', Board: 'board', Graphics: 'gpu' }[g.type] || (DESK.has(g.type) ? 'desk' : HUB.has(g.type) ? 'hub' : 'case');
      if (a === 'desk' || !seen.has(a)) { seen.add(a); return a; }
      return 'case';
    },
    build() {
      const devs = ST.devices;
      if (!devs.find((d) => d.key === this.sel)) { this.sel = devs[0] ? devs[0].key : null; this.zone = 0; }
      main.innerHTML = `<div class="hd"><h1>Devices</h1><span class="sub" id="d-count"></span><span class="grow"></span><button class="btn" id="d-reset-all">Reset all to the global look</button><button class="btn" id="d-rescan">Rescan</button></div>
      ${devs.length ? '<div class="changes" id="d-chg"></div><div class="bento" id="d-bento"></div><div class="g drawer" id="d-ed"></div>'
        : `<div class="g"><p class="helptext">${esc(ST.openrgb.msg)}. No devices yet. Is OpenRGB installed, with its SDK server on?</p></div>`}`;
      $('#d-rescan').onclick = () => rgb.rescan();
      $('#d-reset-all').onclick = () => { for (const d of devs) this.resetDevice(d); this.draw(); };
      if (!devs.length) return;
      const bento = $('#d-bento'), grp = (k) => this.groups().find((g) => g.key === k);
      bento.onclick = (e) => {
        const t = e.target, on = t.closest('[data-on]');
        if (on) {
          if (on.dataset.on === '*') setLighting({ on: !S.lighting.on }, false);
          else { const g = grp(on.dataset.on), off = pages.lighting.on(g); for (const d of g.devs) this.patch(d.key, { off }); }
          this.draw(); return;
        }
        if (t.closest('.scrub, input')) return;
        const k = t.closest('[data-k]'), tile = t.closest('.bt[data-g]'), g = tile && grp(tile.dataset.g);
        const key = k ? k.dataset.k : g && (g.devs.some((d) => d.key === this.sel) ? this.sel : g.devs[0].key);
        if (key && key !== this.sel) { this.sel = key; this.zone = 0; this.draw(); }
      };
      // The colour well sets every colour zone of the tile's devices. While it is focused, top() leaves the tiles alone
      // so the open picker isn't destroyed; its own tile's swatches and the panel update in place.
      bento.oninput = (e) => {
        const t = e.target; if (!t.dataset.cw) return;
        const g = grp(t.dataset.cw), tile = t.closest('.bt');
        for (const d of g.devs) this.patch(d.key, { zones: Object.fromEntries(pages.lighting.colourZones(d).map((i) => [i, t.value])) });
        t.classList.remove('follow', 'mixed'); t.style.background = '';
        const leds = tile.querySelector('.leds'); if (leds) leds.outerHTML = pages.lighting.leds(g);
        tile.querySelectorAll('.st i').forEach((el, i) => (el.style.background = zoneColor(g.devs[i], 0)));
        this.editor();
      };
      bento.onchange = (e) => { if (e.target.dataset.cw) { this.top(true); this.editor(); } };
      bento.addEventListener('focusout', (e) => { if (e.target.dataset.cw) setTimeout(() => this.top()); });
      // Brightness: drag across, or arrow keys (Shift for 1%), Home and End.
      const setB = (el, v) => {
        v = Math.max(0, Math.min(100, Math.round(v)));
        el.style.setProperty('--p', v + '%'); el.setAttribute('aria-valuenow', v); el.querySelector('.bv').textContent = v + '%';
        if (el.dataset.bright === '*') setLighting({ brightness: v }, false);
        else for (const d of grp(el.dataset.bright).devs) this.patch(d.key, { brightness: v });
      };
      bento.onpointerdown = (e) => {
        const el = e.target.closest('.scrub'); if (!el) return;
        e.preventDefault(); el.setPointerCapture(e.pointerId); el.focus(); this.dragging = true;
        const r = el.getBoundingClientRect(), at = (ev) => setB(el, ((ev.clientX - r.left) / r.width) * 100);
        at(e);
        el.onpointermove = at;
        el.onpointerup = el.onpointercancel = () => { el.onpointermove = el.onpointerup = el.onpointercancel = null; this.dragging = false; this.top(); };
      };
      bento.onkeydown = (e) => {
        const el = e.target.closest('.scrub'); if (!el) return;
        const v = +el.getAttribute('aria-valuenow'), step = e.shiftKey ? 1 : 5;
        const next = { ArrowUp: v + step, ArrowRight: v + step, ArrowDown: v - step, ArrowLeft: v - step, Home: 0, End: 100 }[e.key];
        if (next == null) return;
        e.preventDefault(); setB(el, next); clearTimeout(this.kt); this.kt = setTimeout(() => this.top(), 400);
      };
      $('#d-chg').onclick = (e) => { const b = e.target.closest('[data-u]'); if (!b) return; const c = this.changes()[+b.dataset.u]; if (c) { this.patch(c.d.key, c.undo); this.draw(); } };
      this.draw();
    },
    // Writes a device patch to the local copy and to main (main validates it again).
    patch(k, p) {
      const cur = S.devices[k] || (S.devices[k] = {});
      const { zones, ...rest } = p;
      Object.assign(cur, rest);
      if (zones) { cur.zones = { ...cur.zones }; for (const [z, v] of Object.entries(zones)) { if (v) cur.zones[z] = v; else delete cur.zones[z]; } }
      rgb.device(k, p);
    },
    resetDevice(d) {
      const dev = S.devices[d.key]; if (!dev) return;
      this.patch(d.key, { off: false, brightness: 100, gain: [1, 1, 1], gamma: 2.2, fanWhite: 240, zones: Object.fromEntries(Object.keys(dev.zones || {}).map((i) => [i, null])) });
    },
    // Every difference from the global look, one entry each, with the patch that undoes it.
    changes() {
      const out = [];
      for (const d of ST.devices) {
        const dev = S.devices[d.key] || {};
        if (dev.off) out.push({ d, t: 'off', undo: { off: false } });
        if (dev.brightness != null && dev.brightness !== 100) out.push({ d, t: `brightness ${dev.brightness}%`, undo: { brightness: 100 } });
        const own = Object.keys(dev.zones || {});
        if (own.length) out.push({ d, t: `own colour on ${own.length === d.zones.length ? 'every zone' : own.map((i) => (d.zones[i] ? d.zones[i].name : i)).join(', ')}`, undo: { zones: Object.fromEntries(own.map((i) => [i, null])) } });
        if ((dev.gain && dev.gain.some((g) => g !== 1)) || (dev.gamma != null && dev.gamma !== 2.2)) out.push({ d, t: 'colour tuned', undo: { gain: [1, 1, 1], gamma: 2.2 } });
        if (isWraith(d) && dev.fanWhite != null && dev.fanWhite !== 240) out.push({ d, t: `fan white ${dev.fanWhite}`, undo: { fanWhite: 240 } });
      }
      return out;
    },
    draw() { this.top(); this.editor(); },
    // Count, the changed list and the tiles. Skipped while a brightness bar is held so the drag isn't cut.
    top(force) {
      if (this.dragging || page !== 'devices' || !$('#d-bento')) return;
      if (!force && document.activeElement && document.activeElement.dataset.cw) return; // a colour picker is open
      const a = document.activeElement, fk = a && a.dataset && ['bright', 'on', 'u', 'k', 'cw'].find((x) => x in a.dataset), fv = fk && a.dataset[fk];
      const ch = this.changes(), changed = new Set(ch.map((c) => c.d.key)), L = S.lighting;
      $('#d-count').textContent = `${ST.devices.length} devices · ${changed.size ? `${changed.size} changed` : 'all on the global look'}`;
      $('#d-chg').innerHTML = ch.length
        ? `<span class="lbl">changed</span>${ch.map((c, i) => `<span class="pill"><b>${esc(c.d.name)}</b>${esc(c.t)}<button data-u="${i}" aria-label="Undo ${esc(c.t)} on ${esc(c.d.name)}">×</button></span>`).join('')}`
        : '<span class="helptext">Every device follows the global look from Lighting.</span>';
      const scrub = (k, v, label) => `<div class="scrub" data-bright="${esc(k)}" role="slider" tabindex="0" aria-label="${esc(label)} brightness" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v}" style="--p:${v}%"><i></i><span class="bv">${v}%</span></div>`;
      const all = `<div class="g bt all"><div class="top"><div class="grow"><div class="ty">every device</div><div class="nm">All</div></div><button class="tg" data-on="*" aria-pressed="${L.on}" aria-label="All lights on"></button></div>
        <div class="foot"><span class="cw" style="background:${lightsOn() ? L.color : '#1b1c1e'}" title="Global colour, set on Lighting"></span>${scrub('*', L.brightness, 'All devices')}</div></div>`;
      const SIZE = { cool: 112, board: 112, gpu: 150, hub: 104, desk: 84 };
      const tile = (g, area) => {
        const lt = pages.lighting, b = lt.dev(g.devs[0]).brightness ?? 100, on = lt.on(g), has = g.devs.some((d) => d.key === this.sel);
        const dim = (0.15 + 0.85 * (L.brightness / 100) * (b / 100)).toFixed(2), c = lt.current(g);
        const mix = `conic-gradient(${g.devs.flatMap((d) => d.zones.map((_z, i) => zoneColor(d, i))).join(',')})`;
        const art = g.devs.length > 1
          ? `<div class="sticks">${g.devs.map((d, i) => `<button class="st" data-k="${esc(d.key)}" aria-pressed="${d.key === this.sel}" aria-label="Edit ${esc(g.name)} stick ${i + 1}">${deviceIcon(g.type, 42, d.key === this.sel)}<i style="background:${d.zones.length ? zoneColor(d, 0) : '#1b1c1e'};opacity:${dim}"></i></button>`).join('')}</div>`
          : `<button class="art" data-k="${esc(g.devs[0].key)}" aria-pressed="${has}" aria-label="Edit ${esc(g.name)}">${deviceIcon(g.type, SIZE[area] || 96, has)}</button>`;
        return `<div class="g bt a-${area}${has ? ' sel' : ''}${on ? '' : ' off'}" data-g="${esc(g.key)}" role="group" aria-label="${esc(g.name)}">
          ${g.devs.some((d) => changed.has(d.key)) ? '<span class="chg" title="Changed from the global look"></span>' : ''}
          <div class="top"><div class="grow"><div class="ty">${esc(lt.sub(g))}</div><div class="nm" title="${esc(g.name)}">${esc(g.name)}</div></div>
            <button class="tg" data-on="${esc(g.key)}" aria-pressed="${on}" aria-label="${esc(g.name)} on"></button></div>
          ${art}${g.devs.length > 1 ? '' : lt.leds(g)}
          <div class="foot"><input type="color" class="cw${c.mixed ? ' mixed' : c.own ? '' : ' follow'}" data-cw="${esc(g.key)}" value="${c.hex}" style="${c.mixed ? `background:${mix}` : ''}" aria-label="${esc(g.name)} colour" title="${c.mixed ? 'Mixed zone colours' : c.own ? 'Own colour' : 'Follows the global colour'}">${scrub(g.key, b, g.name)}</div></div>`;
      };
      const seen = new Set(), tiles = this.groups().map((g) => [g, this.area(g, seen)]);
      const caseT = tiles.filter(([, ar]) => ar !== 'desk'), deskT = tiles.filter(([, ar]) => ar === 'desk');
      $('#d-bento').innerHTML = `<div><span class="lbl zl">inside the case</span><div class="case">${caseT.map(([g, ar]) => tile(g, ar)).join('')}</div></div>
        <div><span class="lbl zl">on the desk</span><div class="desk2">${all}${deskT.map(([g, ar]) => tile(g, ar)).join('')}</div></div>`;
      if (fk) { const el = [...main.querySelectorAll(`[data-${fk}]`)].find((x) => x.dataset[fk] === fv); if (el) el.focus(); }
    },
    // The selected device: zones and their colour on the left, colour tuning on the right.
    editor() {
      const d = ST.devices.find((x) => x.key === this.sel); if (!d) return;
      const k = d.key, cur = () => S.devices[k] || {}, ed = $('#d-ed');
      if (this.zone >= d.zones.length) this.zone = 0;
      const zi = this.zone, z = d.zones[zi], own = z && (cur().zones || {})[zi], g = cur().gain || [1, 1, 1], gm = cur().gamma || 2.2;
      const zoneUi = !z ? `<p class="helptext">${d.leds} LEDs, no zones reported.</p>`
        : isWraithFan(d, z) ? `<div class="row"><span class="sw" style="width:30px;height:30px;background:${zoneColor(d, zi)}"></span><span class="helptext">This LED only has a working blue input, so it goes from yellow to white. White from about 240.</span></div>
            ${slider('d-fanw', 'fan white', 160, 255, cur().fanWhite ?? 240)}`
        : `<div class="row">${seg('src', [['g', 'Global'], ['o', 'Own colour']], own ? 'o' : 'g')}<input type="color" id="d-zc" value="${own || S.lighting.color}" aria-label="${esc(z.name)} colour" ${own ? '' : 'disabled'}></div>
            <div class="pre" id="d-pre">${SWATCHES.map(([n, h]) => `<button data-c="${h}" aria-label="${n}" title="${n}" aria-pressed="${h === own}" style="background:${h}"></button>`).join('')}</div>
            ${d.zones.length > 1 ? '<button class="btn" id="d-whole">Use for every zone</button>' : ''}`;
      ed.innerHTML = `<div class="row dr-hd">${deviceIcon(typeLabel(d.type), 52, true)}<div class="grow"><div class="dr-name">${esc(d.name)}</div><div class="sub">${esc(typeLabel(d.type))} · ${d.leds} LEDs · ${d.zones.length} zone${d.zones.length === 1 ? '' : 's'}</div></div>
          <button class="btn" id="d-identify">Identify</button><button class="btn" id="d-reset">Reset this device</button></div>
        <div class="dr-body">
          <div class="dr-col"><span class="lbl">zones</span>
            <div class="chips" id="d-zones">${d.zones.map((zz, i) => { const o = isWraithFan(d, zz) || (cur().zones || {})[i];
              return `<button class="chip" data-z="${i}" aria-pressed="${i === zi}"><span class="sw${o ? '' : ' follow'}" style="background:${zoneColor(d, i)}"></span>${esc(zz.name)}</button>`; }).join('')}</div>
            ${z ? `<div class="sub">${esc(z.name)} · ${isWraithFan(d, z) ? 'fan white' : own ? `own colour ${own}` : 'follows the global colour'}</div>` : ''}
            ${zoneUi}</div>
          <div class="dr-col"><span class="lbl">colour tuning</span><p class="helptext">Scales red, green and blue so whites match across devices.</p>
            <div class="row"><div class="tw"><div style="background:#fff"></div><span class="lbl">sent</span></div><div class="tw"><div id="d-after"></div><span class="lbl">shown</span></div></div>
            ${slider('d-r', 'red', 0, 100, Math.round(g[0] * 100), g[0].toFixed(2))}
            ${slider('d-g', 'green', 0, 100, Math.round(g[1] * 100), g[1].toFixed(2))}
            ${slider('d-b', 'blue', 0, 100, Math.round(g[2] * 100), g[2].toFixed(2))}
            ${slider('d-gamma', 'gamma', 10, 30, Math.round(gm * 10), gm.toFixed(1))}
            <div class="row"><button class="btn" id="d-tune-reset">Reset tuning</button><button class="btn" id="d-copy">Copy tuning to every device</button></div></div>
        </div>`;
      const paintAfter = () => ($('#d-after').style.background = tune('#ffffff', cur()));
      paintAfter();
      $('#d-identify').onclick = () => rgb.identify(k);
      $('#d-reset').onclick = () => { this.resetDevice(d); this.draw(); };
      $('#d-zones').onclick = (e) => { const b = e.target.closest('[data-z]'); if (b) { this.zone = +b.dataset.z; this.editor(); } };
      const setZone = (hex) => { this.patch(k, { zones: { [zi]: hex } }); this.draw(); };
      if (z && isWraithFan(d, z)) $('#d-fanw').oninput = (e) => { $('#d-fanw-v').textContent = e.target.value; this.patch(k, { fanWhite: +e.target.value }); this.top(); };
      else if (z) {
        ed.querySelector('[data-seg]').onclick = (e) => { const b = e.target.closest('button'); if (b) setZone(b.dataset.v === 'o' ? (own || S.lighting.color) : null); };
        $('#d-zc').onchange = (e) => setZone(e.target.value);
        $('#d-pre').onclick = (e) => { const b = e.target.closest('[data-c]'); if (b) setZone(b.dataset.c); };
        if ($('#d-whole')) $('#d-whole').onclick = () => { const zones = {}; d.zones.forEach((zz, j) => { if (!isWraithFan(d, zz)) zones[j] = own || null; }); this.patch(k, { zones }); this.draw(); };
      }
      ['r', 'g', 'b'].forEach((ch, i) => ($(`#d-${ch}`).oninput = (e) => {
        const gain = [...(cur().gain || [1, 1, 1])]; gain[i] = e.target.value / 100;
        $(`#d-${ch}-v`).textContent = gain[i].toFixed(2); this.patch(k, { gain }); paintAfter(); this.top();
      }));
      $('#d-gamma').oninput = (e) => { const gamma = e.target.value / 10; $('#d-gamma-v').textContent = gamma.toFixed(1); this.patch(k, { gamma }); paintAfter(); this.top(); };
      $('#d-tune-reset').onclick = () => { this.patch(k, { gain: [1, 1, 1], gamma: 2.2 }); this.draw(); };
      $('#d-copy').onclick = () => { for (const x of ST.devices) this.patch(x.key, { gain: [...(cur().gain || [1, 1, 1])], gamma: cur().gamma || 2.2 }); this.draw(); };
    },
    live() {},
  },

  fans: {
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
      main.innerHTML = `<div class="hd"><h1>Fans</h1><span class="sub">Never below ${FLOOR}%. If KelvinRGB stops, the BIOS takes over.</span></div>
      <p class="helptext" id="c-unclean" hidden>The sensor service was force-killed earlier this boot, so fans left on BIOS are held at 100% until you reboot.</p>
      ${c ? `<div class="grid" style="grid-template-columns:270px minmax(0,1fr);align-items:start">
        <div class="g" style="padding:8px" id="c-list"></div>
        <div class="g" style="display:flex;flex-direction:column;gap:14px">
          <div class="row" style="flex-wrap:wrap"><div style="flex:1"><div style="font-size:16px;font-weight:500">${esc(fanName(c))}</div><div class="sub" id="c-sub"></div></div>${seg('mode', [['curve', 'Curve'], ['fixed', 'Fixed'], ['bios', 'BIOS']], f.mode)}</div>
          <svg class="curve" id="c-svg" viewBox="-36 -10 476 236" role="img" aria-label="Fan curve: temperature to fan speed"></svg>
          <span class="lbl">drag points · double click to add · right click to remove</span>
          <div id="c-fixed" ${f.mode === 'fixed' ? '' : 'hidden'}>${slider('c-fixed-r', 'fixed speed', FLOOR, 100, f.fixed ?? 50, `${f.fixed ?? 50}%`)}</div>
          <div class="row" style="flex-wrap:wrap;gap:14px">
            <label class="row"><span class="lbl">follows</span><select class="btn" id="c-sensor">${temps.map((s) => `<option value="${esc(s.id)}" ${s.id === f.sensor ? 'selected' : ''}>${esc(s.hwName)} · ${esc(s.name)}</option>`).join('')}</select></label>
            ${seg('shape', [['smooth', 'Smooth'], ['linear', 'Linear'], ['stepped', 'Steps']], f.shape)}
            <label class="row"><span class="lbl">preset</span><select class="btn" id="c-preset"><option value="">Choose</option>${Object.keys(PRESETS).map((p) => `<option>${p}</option>`).join('')}</select></label>
            <span class="grow"></span><span class="lbl" id="c-dirty"></span><button class="btn p" id="c-apply">Apply</button>
          </div>
        </div></div>` : `<div class="g"><p class="helptext">${esc(fanHelp())}</p></div>`}`;
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
      $('#c-list').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b && b.dataset.id !== this.sel) { this.sel = b.dataset.id; this.edit = null; this.build(); this.live(); } };
      this.bindCurve(); this.drawCurve(); this.dirty();
    },
    dirty() {
      const { id, ...cfg } = this.edit;
      $('#c-dirty').textContent = JSON.stringify(cfg) === JSON.stringify(S.fans[id] || null) ? 'applied' : 'not applied yet';
    },
    drawCurve() {
      const f = this.edit;
      const X = (t) => ((t - 20) / 80) * 400, Y = (d) => 200 - d * 2;
      const pts = [...f.points].sort((a, b) => a[0] - b[0]);
      const path = [];
      for (let t = 20; t <= 100; t += 0.5) path.push(`${X(t).toFixed(1)},${Y(curve(pts, t, f.shape)).toFixed(1)}`);
      const temp = sensorById(f.sensor);
      const now = temp ? Math.max(FLOOR, curve(pts, temp.value, f.shape)) : null;
      const grid = [0, 50, 100, 150, 200].map((y) => `<line x1="0" y1="${y}" x2="400" y2="${y}"/>`).join('') + [0, 100, 200, 300, 400].map((x) => `<line x1="${x}" y1="0" x2="${x}" y2="200"/>`).join('');
      const live = f.mode === 'curve';
      $('#c-svg').innerHTML = `<g stroke="rgba(255,255,255,.06)">${grid}</g>
        <rect x="0" y="${Y(FLOOR)}" width="400" height="${FLOOR * 2}" fill="rgba(240,163,94,.08)"/>
        <text x="396" y="${Y(FLOOR) + 14}" text-anchor="end" style="font-family:var(--mono)" font-size="9" fill="#f0a35e">FLOOR ${FLOOR}%</text>
        <polyline points="${path.join(' ')}" fill="none" stroke="${live ? '#8fd3e0' : '#6c7177'}" stroke-width="2"/>
        ${pts.map((p) => `<circle class="pt" data-i="${f.points.indexOf(p)}" cx="${X(p[0])}" cy="${Y(p[1])}" r="6" fill="#0b0c0d" stroke="${live ? '#8fd3e0' : '#6c7177'}" stroke-width="2"/>`).join('')}
        ${temp ? `<line x1="${X(temp.value)}" y1="0" x2="${X(temp.value)}" y2="200" stroke="#e6e7e8" stroke-dasharray="3 4" opacity=".5"/>
        <circle cx="${X(temp.value)}" cy="${Y(now)}" r="4" fill="#e6e7e8"/>
        <text x="${Math.min(X(temp.value) + 6, 320)}" y="${Y(now) - 8}" style="font-family:var(--mono)" font-size="10" fill="#e6e7e8">now ${Math.round(temp.value)}° · ${Math.round(now)}%</text>` : ''}
        <g style="font-family:var(--mono)" font-size="9" fill="#6c7177">${[20, 40, 60, 80, 100].map((t) => `<text x="${X(t)}" y="216" text-anchor="middle">${t}°</text>`).join('')}
        <text x="-8" y="3" text-anchor="end">100%</text><text x="-8" y="103" text-anchor="end">50%</text><text x="-8" y="203" text-anchor="end">0%</text></g>`;
      const c = ST.controls.find((x) => x.id === this.sel);
      if (c) $('#c-sub').textContent = temp ? `follows ${temp.name} · now ${Math.round(temp.value)}°C` : 'pick a sensor to follow';
    },
    bindCurve() {
      const svg = $('#c-svg'), f = this.edit;
      const toData = (e) => {
        const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
        const q = p.matrixTransform(svg.getScreenCTM().inverse());
        return [Math.round(Math.min(100, Math.max(20, 20 + (q.x / 400) * 80))), Math.round(Math.min(100, Math.max(FLOOR, (200 - q.y) / 2)))];
      };
      let drag = null;
      svg.onpointerdown = (e) => { if (e.target.classList.contains('pt') && e.button === 0) { drag = +e.target.dataset.i; svg.setPointerCapture(e.pointerId); } };
      svg.onpointermove = (e) => { if (drag == null) return; f.points[drag] = toData(e); this.drawCurve(); };
      svg.onpointerup = () => { if (drag != null) { drag = null; f.points.sort((a, b) => a[0] - b[0]); this.drawCurve(); this.dirty(); } };
      svg.ondblclick = (e) => { if (f.points.length < 16) { f.points.push(toData(e)); f.points.sort((a, b) => a[0] - b[0]); this.drawCurve(); this.dirty(); } };
      svg.oncontextmenu = (e) => { e.preventDefault(); if (e.target.classList.contains('pt') && f.points.length > 2) { f.points.splice(+e.target.dataset.i, 1); this.drawCurve(); this.dirty(); } };
    },
    live() {
      const box = $('#c-list'); if (!box) return;
      $('#c-unclean').hidden = !ST.sensors.unclean;
      box.innerHTML = ST.controls.map((c) => {
        const f = S.fans[c.id];
        const mode = !f || f.mode === 'bios' ? (c.ours ? 'held 100% until reboot' : 'BIOS') : f.mode === 'fixed' ? `Fixed ${f.fixed}%` : 'Curve';
        return `<button class="fan" data-id="${esc(c.id)}" aria-pressed="${c.id === this.sel}"><span>${esc(fanName(c))}</span><span class="mono">${fanRpm(c) ?? '-'} rpm</span><span class="m">${mode} · ${Math.round(c.value)}%</span></button>`;
      }).join('');
      if ($('#c-svg') && !document.querySelector('#c-svg:active')) this.drawCurve();
    },
  },

  system: {
    build() {
      main.innerHTML = `<div class="hd"><h1>System</h1><span class="sub">Live readings from LibreHardwareMonitor. The line is the last minute.</span></div>
      <div class="grid c4" id="y-tiles"></div>
      <div class="g"><details id="y-all"><summary class="lbl">all sensors</summary><table class="sensors" id="y-tbl"></table></details></div>`;
      $('#y-all').ontoggle = () => this.live();
    },
    live() {
      const T = [['CPU temperature', cpuTemp(), '°C', 100], ['CPU load', cpuLoad(), '%', 100], ['GPU temperature', gpuTemp(), '°C', 100], ['GPU load', gpuLoad(), '%', 100], ['GPU clock', gpuClock(), 'MHz', 0], ['Memory', memLoad(), '%', 100]];
      $('#y-tiles').innerHTML = T.map(([l, s, u, top]) => `<div class="g" style="padding:14px"><span class="lbl">${l}</span><div class="mono" style="font-size:26px;margin:8px 0 6px">${val(s)}<small style="font-size:12px;color:var(--soft);margin-left:3px">${u}</small></div><div class="sub" style="font-size:11.5px;margin-bottom:4px">${s ? esc(s.hwName) : 'no reading'}</div>${spark(s && s.id, top)}</div>`).join('');
      if ($('#y-all').open) $('#y-tbl').innerHTML = sensors().map((s) => `<tr><td class="lbl">${esc(s.hwName)}</td><td>${esc(s.name)}</td><td class="lbl">${esc(s.type)}</td><td>${Number(s.value).toFixed(1)}</td></tr>`).join('');
    },
  },

  settings: {
    build() {
      const tg = (id, on, label) => `<button class="tg" id="${id}" aria-pressed="${on}" aria-label="${label}"></button>`;
      main.innerHTML = `<div class="hd"><h1>Settings</h1></div>
      <div class="grid c2" style="align-items:start">
        <div class="g" style="padding:6px 16px"><div class="set">
          <div><span class="t"><span>Conflict check</span><span>Asks to close NZXT CAM and SteelSeries when they hold the same devices</span></span>${tg('s-conf', S.closeConflicts !== false, 'Conflict check')}</div>
          <div><span class="t"><span>Start with Windows</span><span id="s-auto-t">Opens in the tray when you sign in, without an admin prompt</span></span>${tg('s-auto', false, 'Start with Windows')}</div>
          <div><span class="t"><span>Glass background</span><span>Windows 11 acrylic behind the window</span></span>${tg('s-glass', S.glass !== false, 'Glass background')}</div>
          <div><span class="t"><span>Startup splash</span><span>Logo and start-up steps while KelvinRGB loads</span></span>${tg('s-splash', S.splash !== false, 'Startup splash')}</div>
          <div><span class="t"><span>Apex guard</span><span>Always on. Hands lights and fans back while Apex or Easy Anti-Cheat runs.</span></span><button class="tg" aria-pressed="true" disabled aria-label="Apex guard, always on" style="opacity:.45;cursor:default"></button></div>
        </div></div>
        <div class="g" style="padding:6px 16px"><div class="set">
          <div><span class="t"><span>OpenRGB server</span><span>127.0.0.1 : 6742</span></span><span class="mono sub" id="s-orgb"></span></div>
          <div><span class="t"><span>Sensors</span><span>LibreHardwareMonitor sidecar</span></span><span class="mono sub" id="s-sens"></span></div>
          <div><span class="t"><span>Fan floor</span><span>No fan goes below this</span></span><span class="mono">${FLOOR}%</span></div>
          <div><span class="t"><span>Setup</span><span>OpenRGB, the PawnIO driver and fan control: what each is and whether it runs</span></span><button class="btn" id="s-setup">Open</button></div>
          <div><span class="t"><span>Log file</span><span>%APPDATA%\\KelvinRGB\\log.txt, reset each launch</span></span><button class="btn" id="s-log">Open</button></div>
        </div></div>
        <div class="g" style="padding:6px 16px"><div class="set">
          <div><span class="t"><span>Updates</span><span id="s-upd-t">Checks GitHub quietly at start and every 6 hours</span></span><span class="row" style="gap:8px"><button class="btn" id="s-upd">Check</button><button class="btn" id="s-rel">Releases</button></span></div>
          <div><span class="t"><span>About</span><span class="mono">Made by Julian · Powered by <a href="#" id="s-orgb-link" style="color:var(--acc)">OpenRGB</a></span></span><span class="mono sub" id="s-ver"></span></div>
          <div><span class="t"><span>Quit KelvinRGB</span><span>Closing or minimizing the window keeps KelvinRGB in the tray. Quit stops it fully and hands the fans back to the BIOS.</span></span><button class="btn" id="s-quit">Quit</button></div>
        </div></div>
      </div>`;
      $('#s-quit').onclick = () => rgb.quit();
      $('#s-setup').onclick = openSetup;
      $('#s-auto').onclick = (e) => { if (ST?.autostart?.supported) rgb.autostart(e.currentTarget.getAttribute('aria-pressed') !== 'true'); };
      const flip = (b) => { const v = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', v); return v; };
      $('#s-conf').onclick = (e) => { S.closeConflicts = flip(e.currentTarget); rgb.closeConflicts(S.closeConflicts); };
      $('#s-glass').onclick = (e) => { S.glass = flip(e.currentTarget); rgb.glass(S.glass); applyGlass(); };
      $('#s-log').onclick = () => rgb.openLog();
      $('#s-upd').onclick = () => rgb.update(ST?.update?.action || 'check');
      $('#s-rel').onclick = () => rgb.update('releases');
      $('#s-orgb-link').onclick = (e) => { e.preventDefault(); rgb.update('openrgb'); };
      $('#s-splash').onclick = (e) => { S.splash = flip(e.currentTarget); rgb.splash(S.splash); };
    },
    live() {
      $('#s-orgb').textContent = ST.openrgb.msg; $('#s-sens').textContent = ST.sensors.msg;
      const a = ST.autostart || {}, b = $('#s-auto');
      b.setAttribute('aria-pressed', !!a.on); // the switch shows what Windows has, set by main after each change
      b.disabled = !a.supported; b.style.opacity = a.supported ? '' : '.45';
      if (!a.supported) $('#s-auto-t').textContent = 'Works in the installed app. Running from the code folder it stays off, for safety.';
      $('#s-ver').textContent = ST.version ? `v${ST.version}` : '';
      const u = ST.update || {};
      if (u.kind && u.kind !== 'idle') $('#s-upd-t').textContent = u.text;
      $('#s-upd').textContent = u.action === 'install' ? 'Update' : 'Check';
      $('#s-upd').disabled = !u.action;
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

// ---------- chrome ----------
function applyGlass() { document.documentElement.classList.toggle('flat', S.glass === false); }
function setLighting(patch, rebuild = true) {
  Object.assign(S.lighting, patch);
  rgb.lighting(patch);
  footer();
  if (page === 'lighting') { if (rebuild) pages.lighting.paint(); if (ST) pages.lighting.live(); }
  if (page === 'devices') pages.devices.top(); // the footer and tray change the All tile too
}
function footer() {
  const L = S.lighting;
  const c = lightsOn() ? L.color : '#1b1c1e';
  $('#ft-swatch').style.background = c;
  document.documentElement.style.setProperty('--glow', L.effect === 'spectrum' && L.on ? '#8a5cff' : c);
  document.documentElement.classList.toggle('dark-lights', !lightsOn());
  $('#ft-effect').textContent = L.on ? EFFECTS.find((e) => e[0] === L.effect)[1] : 'Lights off';
  $('#ft-sub').textContent = `${L.color} · all devices`;
  $('#ft-power').setAttribute('aria-pressed', L.on);
  $('#ft-bright').value = L.brightness;
  $('#ft-bright-v').textContent = L.brightness;
}
$('#ft-ver').onclick = () => rgb.update('install');
$('#ft-power').onclick = () => setLighting({ on: !S.lighting.on });
$('#ft-bright').oninput = (e) => setLighting({ brightness: +e.target.value }, false);
$$('nav [data-page]').forEach((b) => (b.onclick = () => go(b.dataset.page)));
document.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });

function go(p) {
  if (!pages[p]) return;
  page = p;
  $$('nav [data-page]').forEach((b) => (b.dataset.page === p ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  pages[p].build();
  if (ST) pages[p].live();
}

// ---------- conflict prompt: main sends state.conflicts and flips each row's running flag as apps close ----------
let cfLast = '';
let audio;
function tick() { // soft two-note chime when a row turns green
  audio ||= new AudioContext();
  const t0 = audio.currentTime;
  [[1318.5, 0], [1975.5, 0.11]].forEach(([f, d]) => {
    const t = t0 + d, o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + 0.5);
  });
}
const cfPending = new Map(); // name -> time Close all was pressed
let cfData = null;
const canClose = (x) => x.running && (x.closable || x.service);
// ---------- setup ----------
// Shown once on first run, and at start whenever a piece is missing. Settings opens it any time.
let suOpen = false, suMounted = false, suAuto = false;
const setupNeeds = (s) => !s.setup.openrgb || !s.setup.pawnio || s.sensors.admin === false;
function openSetup() {
  suOpen = true; $('#setup').hidden = false;
  rgb.setup('recheck');
  if (!suMounted) { suMounted = true; mountFigures(); }
  drawSetup(); $('#su-done').focus();
}
function closeSetup() {
  suOpen = false; $('#setup').hidden = true;
  if (!S.setupSeen) { S.setupSeen = true; rgb.setupSeen(); }
}
function mountFigures() {
  HL.inject(document);
  document.querySelectorAll('#setup [data-fig]').forEach((stage) => {
    const f = FIGURES[stage.dataset.fig], out = stage.querySelector('.su-read');
    stage.setAttribute('data-hairline', f.name); stage.setAttribute('role', 'img'); stage.setAttribute('aria-label', f.means);
    const svg = HL.mk('svg', { viewBox: '0 0 400 320', 'aria-hidden': 'true' }, stage);
    let t = null;
    const read = { get textContent() { return t; }, set textContent(v) { t = String(v ?? ''); out.textContent = t; } };
    f.mount({ stage, svg, read }, f.range[1]);
    if (t === null) read.textContent = 'rest';
  });
}
function drawSetup() {
  if (!suOpen || !ST || !ST.setup) return;
  const x = ST.setup, n = ST.controls.length;
  const rows = {
    openrgb: x.openrgb ? ['ok', 'Installed', ''] : ['need', 'Not found', 'Get OpenRGB'],
    pawnio: x.busy === 'pawnio' ? ['wait', 'Installing', ''] : x.pawnio ? ['ok', 'Running', ''] : ['need', 'Not installed', x.bundled ? 'Install' : 'Get PawnIO'],
    fans: n ? ['ok', 'Ready · ' + n + ' fan header' + (n === 1 ? '' : 's'), '']
      : ST.sensors.admin === false ? ['need', 'Start KelvinRGB as admin', '']
      : !x.pawnio ? ['wait', 'Waits for the driver', '']
      : ['need', ST.sensors.ok ? 'No fan headers found' : 'Sensor service: ' + ST.sensors.msg, ''],
  };
  for (const [k, [s, t, b]] of Object.entries(rows)) {
    const el = $('#setup [data-k=' + k + '] .su-status'), btn = el.querySelector('.btn');
    el.dataset.s = s; el.querySelector('.t').textContent = t;
    btn.textContent = b; btn.hidden = !b; btn.disabled = !!ST.guard; btn.classList.toggle('p', s === 'need');
  }
  $('#su-what-pawnio').textContent = 'Kernel driver from pawnio.eu · 3.4 MB · ' + (x.bundled ? 'ships with KelvinRGB' : 'opens the download page') + ' · GPL-2, source at github.com/namazso/PawnIO · asks Windows for admin once';
  const left = Object.values(rows).filter((r) => r[0] === 'need').length;
  $('#su-sub').textContent = ST.guard ? 'Apex or Easy Anti-Cheat is running. Setup waits until the game closes.'
    : left ? (left === 1 ? 'One needs' : left + ' need') + ' your attention on this PC. Each card says what it is and why KelvinRGB needs it.'
    : 'Everything is in place. You can open this again from Settings.';
}
$('#setup').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) rgb.setup(b.dataset.act); });
$('#su-done').onclick = closeSetup;
$('#setup').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSetup(); });
addEventListener('focus', () => { if (suOpen) rgb.setup('recheck'); }); // back from the browser after a download

function conflicts(c) {
  const el = $('#conflicts');
  if (!c) { el.hidden = true; cfLast = ''; cfData = null; cfPending.clear(); return; }
  const key = JSON.stringify(c);
  if (key === cfLast) return;
  const opening = !cfLast;
  const was = opening ? [] : JSON.parse(cfLast);
  if (c.some((x) => !x.running && was.find((w) => w.name === x.name)?.running)) tick();
  cfLast = key; cfData = c;
  drawConflicts(opening);
}
function drawConflicts(opening) {
  const c = cfData, now = Date.now();
  const left = c.filter((x) => x.running).length;
  const state = (x) => !x.running ? 'closed'
    : !(x.closable || x.service) ? 'close it yourself'
    : cfPending.has(x.name) ? (now - cfPending.get(x.name) < 8000 ? 'closing' : 'still running') : 'running';
  $('#cf-count').textContent = left ? `${left} of ${c.length} running` : `all ${c.length} closed`;
  $('#cf-list').innerHTML = c.map((x) => `<li class="${x.running ? 'on' : 'off'}"><span class="dot"></span>
    <span class="grow">${esc(x.label)}${x.note && x.note !== x.name ? `<small>${esc(x.note)}</small>` : ''}</span>
    <span class="lbl state">${state(x)}</span></li>`).join('');
  const closable = c.filter(canClose), busy = closable.some((x) => state(x) === 'closing');
  const all = $('#cf-all'), done = $('#cf-done');
  all.hidden = !closable.length;
  all.disabled = busy;
  all.textContent = busy ? 'Closing' : closable.some((x) => cfPending.has(x.name)) ? 'Try again' : 'Close all';
  done.textContent = left ? 'Continue anyway' : 'Continue';
  done.classList.toggle('p', !closable.length);
  $('#conflicts').hidden = false;
  if (opening || !left) (all.hidden ? done : all).focus();
}
$('#cf-all').onclick = () => {
  for (const x of cfData.filter(canClose)) { cfPending.set(x.name, Date.now()); rgb.conflictClose(x.name); }
  drawConflicts();
  setTimeout(() => cfData && drawConflicts(), 8100); // flip any that refused to "still running"
};
$('#cf-done').onclick = () => rgb.conflictDone();
document.addEventListener('keydown', (e) => { if (cfLast && e.key === 'Escape') rgb.conflictDone(); });

function health(id, ok, warn, text) {
  $(`#${id}`).textContent = text;
  $(`#${id}-d`).className = 'dot ' + (ok ? 'ok' : warn ? 'warn' : 'bad');
}
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
  health('st-openrgb', s.openrgb.ok, !s.guard, `OpenRGB ${s.openrgb.ok ? 'connected' : s.openrgb.msg}`);
  const sensorsFull = s.sensors.ok && s.sensors.admin !== false;
  health('st-sensors', sensorsFull, true, `Sensors ${sensorsFull ? 'live' : s.sensors.msg}`);
  const u = s.update || {}, fv = $('#ft-ver'), up = u.action === 'install';
  fv.textContent = `v${s.version || ''}` + (up || /^(Downloading|Installing)/.test(u.text || '') ? ` · ${u.text.toLowerCase()}` : '');
  fv.classList.toggle('up', up); fv.disabled = !up;
  if (!suAuto && s.setup && !s.conflicts && (!S.setupSeen || setupNeeds(s))) { suAuto = true; openSetup(); }
  drawSetup();
  health('st-guard', !s.guard, s.guard, s.guard ? 'Apex guard active' : 'Apex guard idle');
  if ((page === 'devices' && devicesChanged) || (page === 'fans' && fansChanged)) pages[page].build();
  pages[page].live();
}

rgb.get().then((r) => {
  if (!r) return;
  S = r.settings; FLOOR = r.floor;
  applyGlass();
  footer();
  go(page);
  onState(r.state);
  rgb.onState(onState);
  // the tray menu changed something: take main's copy and redraw
  rgb.onSettings((s) => { S = s; applyGlass(); footer(); if (page === 'lighting' || page === 'settings') go(page); if (page === 'devices') pages.devices.top(); });
});
