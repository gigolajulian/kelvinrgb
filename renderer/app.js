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

  lighting: {
    build() {
      const L = S.lighting;
      main.innerHTML = `<div class="hd"><h1>Lighting</h1><span class="sub">One look for every light. Single zones are set in Devices.</span></div>
      <div class="g"><span class="lbl">effect</span><div class="fx" id="l-fx" style="margin-top:10px"></div></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
        <div class="g" style="display:flex;flex-direction:column;gap:14px">
          <div class="row"><span class="lbl">colour</span><span class="grow"></span><input type="text" id="l-hex" class="num" value="${L.color}" aria-label="Hex colour" style="width:100px"></div>
          <input type="color" id="l-color" value="${L.color}" aria-label="Colour">
          <div class="pre" id="l-pre"></div>
        </div>
        <div class="g" style="display:flex;flex-direction:column;gap:16px">
          ${slider('l-speed', 'speed', 0, 100, L.speed)}
          ${slider('l-bright', 'brightness', 0, 100, L.brightness)}
          <div><span class="lbl">what's lit</span><div class="list" style="margin-top:6px" id="l-lit"></div></div>
        </div>
      </div>`;
      $('#l-fx').onclick = (e) => { const b = e.target.closest('[data-fx]'); if (b) setLighting({ effect: b.dataset.fx }); };
      $('#l-color').oninput = (e) => setLighting({ color: e.target.value }, false);
      $('#l-hex').onchange = (e) => { const v = e.target.value.trim(); if (/^#[0-9a-f]{6}$/i.test(v)) setLighting({ color: v.toLowerCase() }); else e.target.value = S.lighting.color; };
      $('#l-pre').onclick = (e) => { const b = e.target.closest('[data-c]'); if (b) setLighting({ color: b.dataset.c }); };
      $('#l-speed').oninput = (e) => { $('#l-speed-v').textContent = e.target.value; setLighting({ speed: +e.target.value }, false); };
      $('#l-bright').oninput = (e) => { $('#l-bright-v').textContent = e.target.value; setLighting({ brightness: +e.target.value }, false); };
      this.paint();
    },
    paint() {
      const c = S.lighting.color;
      const FX = { static: c, breathing: `linear-gradient(90deg,#111,${c},#111)`, spectrum: 'linear-gradient(90deg,#c8323c,#ff6a1a,#13a3a3,#2f5bff,#8a5cff)', wave: `repeating-linear-gradient(90deg,${c} 0 14px,#111 14px 28px)`, off: '#111' };
      $('#l-fx').innerHTML = EFFECTS.map(([k, l]) => `<button data-fx="${k}" aria-pressed="${k === S.lighting.effect}"><span class="pv" style="background:${FX[k]}"></span>${l}</button>`).join('');
      $('#l-pre').innerHTML = SWATCHES.map(([n, h]) => `<button data-c="${h}" aria-label="${n}" title="${n}" aria-pressed="${h === c}" style="background:${h}"></button>`).join('');
      if (document.activeElement !== $('#l-hex')) $('#l-hex').value = c;
    },
    live() {
      $('#l-lit').innerHTML = ST.devices.length ? ST.devices.map((d) => `<div><span class="tag">${typeLabel(d.type)}</span><span class="grow">${esc(d.name)}</span>${d.zones.map((_z, zi) => `<span class="sw" style="width:14px;height:14px;background:${zoneColor(d, zi)}"></span>`).join('')}</div>`).join('')
        : `<span class="helptext">${esc(ST.openrgb.msg)}. Waiting for OpenRGB.</span>`;
    },
  },

  // Mixer: an All strip and one channel strip per device (icon, live zone colours, brightness fader, on/off).
  // The selected device's zones, colour and tuning sit in the panel below. Everything that differs from the
  // global look is listed at the top with an undo.
  devices: {
    sel: null, // device key
    zone: 0,
    dragging: false,
    build() {
      const devs = ST.devices;
      if (!devs.find((d) => d.key === this.sel)) { this.sel = devs[0] ? devs[0].key : null; this.zone = 0; }
      main.innerHTML = `<div class="hd"><h1>Devices</h1><span class="sub" id="d-count"></span><span class="grow"></span><button class="btn" id="d-reset-all">Reset all to the global look</button><button class="btn" id="d-rescan">Rescan</button></div>
      ${devs.length ? '<div class="changes" id="d-chg"></div><div class="desk" id="d-desk"></div><div class="g drawer" id="d-ed"></div>'
        : `<div class="g"><p class="helptext">${esc(ST.openrgb.msg)}. No devices yet. Is OpenRGB installed, with its SDK server on?</p></div>`}`;
      $('#d-rescan').onclick = () => rgb.rescan();
      $('#d-reset-all').onclick = () => { for (const d of devs) this.resetDevice(d); this.draw(); };
      if (!devs.length) return;
      const desk = $('#d-desk');
      desk.onclick = (e) => {
        const t = e.target.closest('[data-on]');
        if (t) {
          if (t.dataset.on === '*') setLighting({ on: !S.lighting.on }, false);
          else this.patch(t.dataset.on, { off: !(S.devices[t.dataset.on] || {}).off });
          this.draw(); return;
        }
        const s = e.target.closest('.strip[data-k]');
        if (s && !e.target.closest('.fd') && s.dataset.k !== this.sel) { this.sel = s.dataset.k; this.zone = 0; this.draw(); }
      };
      // Faders: drag, or arrow keys (Shift for 1%), Home and End.
      const setFader = (fd, v) => {
        v = Math.max(0, Math.min(100, Math.round(v)));
        fd.style.setProperty('--p', v + '%'); fd.setAttribute('aria-valuenow', v);
        const out = fd.closest('.strip').querySelector('.val'); out.textContent = v + '%';
        if (fd.dataset.f === '*') setLighting({ brightness: v }, false);
        else { out.classList.toggle('moved', v !== 100); this.patch(fd.dataset.f, { brightness: v }); }
      };
      desk.onpointerdown = (e) => {
        const fd = e.target.closest('.fd'); if (!fd) return;
        e.preventDefault(); fd.setPointerCapture(e.pointerId); fd.focus(); this.dragging = true;
        const at = (ev) => { const r = fd.getBoundingClientRect(); setFader(fd, ((r.bottom - ev.clientY) / r.height) * 100); };
        at(e);
        fd.onpointermove = at;
        fd.onpointerup = fd.onpointercancel = () => { fd.onpointermove = fd.onpointerup = fd.onpointercancel = null; this.dragging = false; this.top(); };
      };
      desk.onkeydown = (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.strip[data-k]')) { e.preventDefault(); e.target.click(); return; }
        const fd = e.target.closest('.fd'); if (!fd) return;
        const v = +fd.getAttribute('aria-valuenow'), step = e.shiftKey ? 1 : 5;
        const next = { ArrowUp: v + step, ArrowRight: v + step, ArrowDown: v - step, ArrowLeft: v - step, Home: 0, End: 100 }[e.key];
        if (next == null) return;
        e.preventDefault(); setFader(fd, next); clearTimeout(this.kt); this.kt = setTimeout(() => this.top(), 400);
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
    // Count, the changed list and the desk. Skipped while a fader is held so the drag isn't cut.
    top() {
      if (this.dragging || page !== 'devices' || !$('#d-desk')) return;
      const a = document.activeElement, fk = a && a.dataset && ['f', 'on', 'u', 'k'].find((x) => x in a.dataset), fv = fk && a.dataset[fk];
      const ch = this.changes(), changed = new Set(ch.map((c) => c.d.key)), L = S.lighting;
      $('#d-count').textContent = `${ST.devices.length} devices · ${changed.size ? `${changed.size} changed` : 'all on the global look'}`;
      $('#d-chg').innerHTML = ch.length
        ? `<span class="lbl">changed</span>${ch.map((c, i) => `<span class="pill"><b>${esc(c.d.name)}</b>${esc(c.t)}<button data-u="${i}" aria-label="Undo ${esc(c.t)} on ${esc(c.d.name)}">×</button></span>`).join('')}`
        : '<span class="helptext">Every device follows the global look from Lighting.</span>';
      const fader = (k, v, label) => `<div class="fd" data-f="${esc(k)}" role="slider" tabindex="0" aria-label="${esc(label)} brightness" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v}" style="--p:${v}%"><i></i><b></b></div>`;
      const all = `<div class="strip all"><div class="ty">every device</div><div class="nm">All</div>
        <div class="ch"><span class="allsw" style="background:${lightsOn() ? L.color : '#1b1c1e'}"></span>${fader('*', L.brightness, 'All devices')}</div>
        <div class="val num">${L.brightness}%</div><button class="tg" data-on="*" aria-pressed="${L.on}" aria-label="All lights on"></button></div>`;
      const strip = (d) => {
        const dev = S.devices[d.key] || {}, b = dev.brightness ?? 100, sel = d.key === this.sel;
        const dim = (0.15 + 0.85 * (L.brightness / 100) * (b / 100)).toFixed(2);
        const leds = d.zones.length ? d.zones.flatMap((z, zi) => Array(Math.max(1, Math.min(4, z.leds))).fill(zi)).slice(0, 12) : [0];
        return `<div class="strip${sel ? ' sel' : ''}${dev.off ? ' off' : ''}" data-k="${esc(d.key)}" role="button" tabindex="0" aria-pressed="${sel}" aria-label="Edit ${esc(d.name)}">${changed.has(d.key) ? '<span class="chg" title="Changed from the global look"></span>' : ''}
          ${deviceIcon(typeLabel(d.type), 40, sel)}<div class="ty">${esc(typeLabel(d.type))}</div><div class="nm" title="${esc(d.name)}">${esc(d.name)}</div>
          <div class="ch"><div class="leds" style="opacity:${dim}">${leds.map((zi) => `<i style="background:${d.zones.length ? zoneColor(d, zi) : '#1b1c1e'}"></i>`).join('')}</div>${fader(d.key, b, d.name)}</div>
          <div class="val num${b !== 100 ? ' moved' : ''}">${b}%</div>
          <button class="tg" data-on="${esc(d.key)}" aria-pressed="${!dev.off}" aria-label="${esc(d.name)} on"></button></div>`;
      };
      $('#d-desk').innerHTML = all + ST.devices.map(strip).join('');
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
  if (page === 'devices') pages.devices.top(); // the footer and tray change the All strip too
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
  $('#su-what-pawnio').textContent = 'Kernel driver from pawnio.eu · 3.4 MB · ' + (x.bundled ? 'ships with KelvinRGB' : 'opens the download page') + ' · asks Windows for admin once';
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
