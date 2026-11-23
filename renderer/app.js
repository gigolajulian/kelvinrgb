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

const EFFECTS = [['static', 'Static'], ['breathing', 'Breathing'], ['spectrum', 'Spectrum'], ['wave', 'Wave'], ['cycle', 'Colour cycle'], ['sweep', 'Sweep'], ['temp', 'Temperature'], ['off', 'Off']];
const TEMP_RANGE = [35, 85]; // lib/math.js maps these to the cool and warm colours
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
const memAvail = () => pick(/^Memory$/, 'Data', /Memory Available|Available Memory/);
const cpuPower = () => pick(/^Cpu$/, 'Power', /Package/);
function cpuClock() { // average of the per-core clocks, MHz
  const c = sensors().filter((s) => /^Cpu$/.test(s.hwType) && s.type === 'Clock' && /^Core #\d+$/.test(s.name) && s.value > 0);
  return c.length ? c.reduce((a, s) => a + s.value, 0) / c.length : null;
}
// What the Drivers page flags, shared so Home and Drivers never disagree.
function driverSummary() {
  const V = ST.drivers, u = ST.update || {};
  const missing = (V.windows || []).filter((w) => w.tone === 'bad').length + (V.pawnio?.tone === 'bad' ? 1 : 0);
  const ups = [u.kind === 'available', V.openrgb?.tone === 'warn', V.pawnio?.tone === 'warn', ...(V.windows || []).map((w) => w.tone === 'warn')].filter(Boolean).length;
  const text = [missing && `${missing} driver${missing > 1 ? 's' : ''} missing`, ups && `${ups} update${ups > 1 ? 's' : ''}`].filter(Boolean).join(' · ');
  return { missing, ups, n: missing + ups, text, checking: !!V.checking || !V.at };
}
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
// Who drives this fan now (#26): another fan app, KelvinRGB, the hub's own default, or the BIOS.
const fanApp = (c) => (ST.fanApps || []).find((a) => a.scope === 'all' || a.scope === (c.kind === 'hub' ? 'hub' : 'board'));
function fanOwner(c) {
  const f = S.fans[c.id], app = fanApp(c), mine = f && f.mode !== 'bios';
  if (app) return mine ? `${app.label} (your ${f.mode === 'fixed' ? 'setting' : 'curve'} waits)` : app.label;
  if (mine) return `KelvinRGB · ${f.mode === 'fixed' ? `Fixed ${f.fixed}%` : 'Curve'}`;
  return c.kind === 'hub' ? 'Hub default' : c.ours ? 'BIOS · held 100% until reboot' : 'BIOS';
}
// A header asked for 30% or more that reads 0 rpm has nothing plugged in.
const fanEmpty = (c) => fanRpm(c) === 0 && c.value >= 30;
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

// Writes a device patch to the local copy and to main (main validates it again).
function patchDev(k, p) {
  const cur = S.devices[k] || (S.devices[k] = {});
  const { zones, ...rest } = p;
  Object.assign(cur, rest);
  if (zones) { cur.zones = { ...cur.zones }; for (const [z, v] of Object.entries(zones)) { if (v) cur.zones[z] = v; else delete cur.zones[z]; } }
  rgb.device(k, p);
}

// ---------- pages ----------
const pages = {
  // One page: readouts with the last minute, quick lighting, fan presets with each fan, system and drivers.
  home: {
    build() {
      const ICON = {
        cpu: '<path d="M10 3 17 7 10 11 3 7Z"/><path d="M3 7v2l7 4 7-4V7"/><path d="M10 5.5 13 7 10 8.5 7 7Z"/>',
        gpu: '<path d="M2 8 12 3 18 6 8 11Z"/><path d="M2 8v2l6 3 10-5V6"/><circle cx="10" cy="7" r="1.6"/>',
        mem: '<path d="M2 10 14 4 18 6 6 12Z"/><path d="M2 10v2l4 2 12-6V6"/><path d="M6 9.5l1-.5M9 8l1-.5M12 6.5l1-.5"/>',
        fans: '<ellipse cx="10" cy="9" rx="7" ry="4"/><path d="M10 9c1.5-2.5 4-2.5 4-1M10 9c-1.5 2.5-4 2.5-4 1M10 9c-3-1-3-3-1.5-3M10 9c3 1 3 3 1.5 3"/>',
      };
      const tile = (k, l, u, sp) => `<div class="g ht-t"><div class="row"><svg class="h-ic" viewBox="0 0 20 16" aria-hidden="true">${ICON[k]}</svg><span class="lbl grow">${l}</span><span class="sub num" id="h-${k}-r"></span></div>
        <div class="big"><span id="h-${k}">-</span><small id="h-${k}-u">${u}</small></div><div class="sub num" id="h-${k}-s"></div>
        ${sp ? `<div id="h-${k}-sp">${spark()}</div>` : `<div class="meter"><i id="h-${k}-m" style="background:var(--ok)"></i></div>`}</div>`;
      main.innerHTML = `<div class="home">
      <div class="hd"><h1 id="h-title">KelvinRGB</h1><span class="sub" id="h-sub"></span></div>
      <div class="grid ht">${tile('cpu', 'cpu', '°C', 1)}${tile('gpu', 'gpu', '°C', 1)}${tile('mem', 'memory', '%', 1)}${tile('fans', 'fans', '')}</div>
      <div class="grid hc">
        <div class="g hq" id="h-light">
          <div class="row"><span class="lbl grow">lighting</span><button class="btn" data-go="lighting">Devices</button></div>
          <div class="row"><span class="sw" id="h-sw"></span><div class="grow"><div class="hq-n" id="h-fx"></div><div class="sub" id="h-fx-s"></div></div><button class="tg" id="h-on" aria-label="Lights on"></button></div>
          <div class="fx">${EFFECTS.map(([k, l]) => `<button data-fx="${k}">${l}</button>`).join('')}</div>
          <label class="ctl"><span class="lbl">brightness</span><input type="range" class="br" id="h-bright" min="0" max="100"><span class="v num" id="h-bright-v"></span></label>
          <div class="chips hd-dev" id="h-dev"></div>
        </div>
        <div class="g hq" id="h-fan">
          <div class="row"><span class="lbl grow">fans</span><button class="btn" data-go="fans">Curves</button></div>
          ${seg('preset', Object.keys(PRESETS).map((p) => [p, p]), '')}
          <div class="sub" id="h-fan-s"></div>
          <div class="hl" id="h-fan-l"></div>
        </div>
      </div>
      <div class="grid hc2">
        <div class="g hq"><div class="row"><span class="lbl grow">drivers</span><span class="sub" id="h-drv-at"></span><button class="btn" data-go="drivers">Drivers</button></div><div class="hl" id="h-drv"></div></div>
        <div class="g hq"><div class="row"><span class="lbl grow">system</span><button class="btn" data-go="system">Sensors</button></div><div class="hl" id="h-sys"></div></div>
      </div></div>`;
      $('#h-light').onclick = (e) => {
        if (e.target.id === 'h-on') return setLighting({ on: !S.lighting.on });
        const b = e.target.closest('[data-fx]'); if (b) setLighting({ effect: b.dataset.fx, on: true });
      };
      $('#h-bright').oninput = (e) => setLighting({ brightness: +e.target.value }, false);
      $('#h-fan').onclick = (e) => { const b = e.target.closest('[data-v]'); if (b && !b.disabled) this.preset(b.dataset.v); };
      $('#h-drv').onclick = (e) => { if (e.target.closest('[data-upd]')) rgb.update('install'); };
      if (ST && !ST.drivers.at && !ST.drivers.checking) rgb.drivers('check'); // once per run, same as the Drivers page
    },
    // Every fan gets the preset curve; label, sensor and shape stay. Main clamps to the floor again.
    preset(name) {
      for (const c of ST.controls) {
        const cur = S.fans[c.id] || {};
        S.fans[c.id] = { fixed: 50, ...cur, mode: 'curve', shape: cur.shape || 'smooth', points: structuredClone(PRESETS[name]), sensor: cur.sensor || (cpuTemp() && cpuTemp().id) };
        rgb.fan(c.id, S.fans[c.id]);
      }
      pages.fans.edit = null; // the Fans page reloads from settings
      this.live();
    },
    live() {
      if (!$('#h-light')) return;
      const ct = cpuTemp(), gt = gpuTemp(), ml = memLoad(), mu = memUsed(), ma = memAvail(), cl = cpuLoad(), gl = gpuLoad(), gc = gpuClock(), cp = cpuPower(), cc = cpuClock();
      const hot = (ct && ct.value >= 85) || (gt && gt.value >= 85);
      const fans = ST.controls, rpms = fans.map(fanRpm), spinning = rpms.filter((r) => r > 0).length;
      const ram = mu && ma ? `${Math.round(mu.value + ma.value)} GB` : '';
      const join = (...a) => a.filter(Boolean).join(' · ');
      const line = (k, v, dot, act = '') => `<div><span class="k">${dot ? `<span class="dot ${dot}"></span>` : ''}${esc(k)}</span><span class="v">${esc(v)}</span>${act}</div>`;
      $('#h-title').textContent = !ST.sensors.ok ? 'Starting up' : hot ? 'Running hot' : 'All good';
      $('#h-sub').textContent = ST.guard ? 'Apex is running, so lights and fans are handed back.'
        : !ST.sensors.ok ? `Waiting for sensors (${ST.sensors.msg}) and OpenRGB (${ST.openrgb.msg}).`
        : hot ? 'A temperature is over 85 °C.' : 'Nothing over limit. The lines show the last minute.';

      $('#h-cpu').textContent = val(ct); $('#h-cpu-r').textContent = cp ? `${val(cp)} W` : '';
      $('#h-cpu-s').textContent = join(cl && `${val(cl)}% load`, cc && `${(cc / 1000).toFixed(2)} GHz`);
      $('#h-cpu-sp').innerHTML = spark(ct && ct.id, 100);
      $('#h-gpu').textContent = val(gt); $('#h-gpu-r').textContent = gc ? `${val(gc)} MHz` : '';
      $('#h-gpu-s').textContent = gl ? `${val(gl)}% load` : '';
      $('#h-gpu-sp').innerHTML = spark(gt && gt.id, 100);
      $('#h-mem').textContent = val(ml); $('#h-mem-r').textContent = ram;
      $('#h-mem-s').textContent = mu ? `${val(mu, 1)} GB used` : '';
      $('#h-mem-sp').innerHTML = spark(ml && ml.id, 100);
      $('#h-fans').textContent = fans.length ? spinning : '-'; $('#h-fans-u').textContent = fans.length ? `of ${fans.length}` : '';
      const on = rpms.filter((r) => r > 0);
      $('#h-fans-r').textContent = on.length ? `${Math.round(on.reduce((a, r) => a + r, 0) / on.length)} rpm avg` : '';
      $('#h-fans-s').textContent = `spinning · ${FLOOR}% floor`;
      $('#h-fans-m').style.width = fans.length ? (spinning / fans.length) * 100 + '%' : '0';

      const L = S.lighting;
      $('#h-sw').style.background = lightsOn() ? L.color : '#1b1c1e';
      $('#h-fx').textContent = L.on ? EFFECTS.find((e) => e[0] === L.effect)[1] : 'Lights off';
      const own = ST.devices.reduce((a, d) => a + Object.keys((S.devices[d.key] || {}).zones || {}).length, 0);
      $('#h-fx-s').textContent = `${L.color} · ${ST.devices.length} devices${own ? ` · ${own} zones with their own colour` : ''}`;
      $('#h-on').setAttribute('aria-pressed', L.on);
      $$('#h-light [data-fx]').forEach((b) => b.setAttribute('aria-pressed', L.on && b.dataset.fx === L.effect));
      const br = $('#h-bright');
      if (document.activeElement !== br) br.value = L.brightness;
      br.style.setProperty('--p', br.value + '%'); $('#h-bright-v').textContent = br.value + '%';
      // Rows with buttons only rebuild when their content changes, so focus and clicks survive state ticks.
      const put = (sel, html) => { const el = $(sel); if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; } };
      put('#h-dev', (ST.devices.length ? pages.lighting.groups() : []).map((g) => {
        const d = g.devs[0], z = pages.lighting.colourZones(d)[0] ?? 0;
        return `<button class="chip" data-go="lighting"><span class="sw" style="background:${zoneColor(d, z)}"></span>${esc(g.name)}${g.devs.length > 1 ? ` × ${g.devs.length}` : ''}</button>`;
      }).join(''));

      const cur = fans.length ? Object.keys(PRESETS).find((p) => fans.every((c) => S.fans[c.id]?.mode === 'curve' && JSON.stringify(S.fans[c.id].points) === JSON.stringify(PRESETS[p]))) : null;
      $$('#h-fan [data-v]').forEach((b) => { b.setAttribute('aria-pressed', b.dataset.v === cur); b.disabled = !fans.length || !!ST.guard; });
      const set = fans.filter((c) => S.fans[c.id] && S.fans[c.id].mode !== 'bios' && !fanApp(c)).length;
      const apps = [...new Set((ST.fanApps || []).map((a) => a.label))].join(', ');
      $('#h-fan-s').textContent = !fans.length || ST.guard ? fanHelp()
        : !set ? `No curves set: ${apps || 'BIOS'} in control`
        : `${cur && !apps ? `${cur} on all ${fans.length} fans` : `KelvinRGB drives ${set} of ${fans.length} fans`}${apps ? ` · ${apps} running` : ''} · never below ${FLOOR}%`;
      $('#h-fan-l').innerHTML = fans.map((c, i) => {
        const duty = c.value >= 0 ? Math.round(c.value) : null;
        return `<div class="${fanEmpty(c) ? 'empty' : ''}" title="${esc(fanOwner(c))}"><span class="k">${esc(fanName(c))}</span><span class="v">${fanEmpty(c) ? 'empty' : rpms[i] != null ? `${rpms[i]} rpm` : ''}</span><span class="meter"><i style="width:${duty ?? 0}%"></i></span><span class="v p">${duty != null ? duty + '%' : '-'}</span></div>`;
      }).join('');

      const hw = (re) => (ST.hw.find((h) => re.test(h.type)) || {}).name;
      $('#h-sys').innerHTML = [['Board', hw(/^Motherboard$/)], ['CPU', hw(/^Cpu$/)], ['Graphics', hw(/^Gpu/)], ['Memory', ram]]
        .filter((r) => r[1]).map(([k, v]) => line(k, v)).join('');

      const V = ST.drivers, u = ST.update || {}, d = driverSummary();
      const tag = (v) => String(v || '').replace(/^(release_|v)/i, '').replace(/^(\d+\.\d+\.\d+)\.0$/, '$1');
      const part = (x) => (!x?.installed ? ['not installed', 'bad'] : x.tone === 'warn' || x.tone === 'bad' ? [`${tag(x.installed)} · ${tag(x.latest)} out`, x.tone] : [`${tag(x.installed)} · ${x.tone === 'ok' ? 'up to date' : 'installed'}`, x.tone || 'dim']);
      const win = V.windows || [], wbad = win.filter((w) => w.tone === 'bad').length, wup = win.filter((w) => w.tone === 'warn').length, up = u.kind === 'available';
      $('#h-drv-at').textContent = d.checking ? 'checking' : `checked ${new Date(V.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      const head = (t) => `<div class="hh"><span class="lbl">${t}</span></div>`;
      put('#h-drv', !V.at ? line('Reading drivers from Windows', '', 'acc') : [
        head('windows'),
        line('Drivers', [wbad && `${wbad} missing`, wup && `${wup} update${wup > 1 ? 's' : ''} out`].filter(Boolean).join(' · ') || `${win.length} of ${win.length} in place`, wbad ? 'bad' : wup ? 'warn' : 'ok'),
        line('PawnIO', ...part(V.pawnio)),
        head('kelvinrgb'),
        line('KelvinRGB', up ? `${ST.version} · ${u.v} ready` : `${ST.version} · up to date`, up ? 'warn' : 'ok', up && !ST.guard ? '<button class="btn p" data-upd="1">Update</button>' : ''),
        line('OpenRGB', ...part(V.openrgb)),
      ].join(''));
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
      main.innerHTML = `<div class="g lg-all" id="l-all"></div><div class="g lg-pal" id="l-pal"></div><div class="g" id="l-strips"></div><div class="lgrid" id="l-grid"></div>`;
      this.strips();
      $('#l-pal').onclick = (e) => this.palClick(e);
      $('#l-pal').onkeydown = (e) => { if (e.key === 'Enter' && e.target.id === 'l-tname') this.saveTheme(); };
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
    tempText() {
      const t = ST && cpuTemp();
      return `${t ? `CPU <span class="num">${Math.round(t.value)} °C</span>` : 'CPU temperature unavailable: sensors need admin'} · bluest colour at ${TEMP_RANGE[0]} °C, reddest at ${TEMP_RANGE[1]} °C`;
    },
    // ---- effect colours and themes (#27) ----
    palette() {
      const L = S.lighting, pal = L.palette || [];
      const cands = [...new Set([L.color, ...quick, ...pal].map((c) => c.toLowerCase()))];
      const bar = pal.length >= 2 ? `linear-gradient(90deg,${[...pal, pal[0]].join(',')})` : 'linear-gradient(90deg,#c8323c,#ff6a1a,#13a3a3,#2f5bff,#8a5cff,#c8323c)';
      const same = (t) => JSON.stringify(t.lighting.palette || []) === JSON.stringify(pal) && t.lighting.effect === L.effect && t.lighting.color === L.color;
      const a = document.activeElement, keep = a && a.id;
      $('#l-pal').innerHTML = `<div class="row"><span class="lbl">effect colours</span>
          <span class="row pal" role="group" aria-label="Effect colours, pick 2 or 3">${cands.map((c) => `<button class="sw" data-pc="${c}" style="background:${c}" aria-pressed="${pal.includes(c)}" aria-label="${c}"></button>`).join('')}</span>
          <button class="btn" data-rainbow="1" aria-pressed="${pal.length < 2}">Rainbow</button><span class="palbar" style="background:${bar}"></span></div>
        <div class="row"><span class="lbl">themes</span><span class="themes">${S.themes.map((t, i) => {
          const p = t.lighting.palette && t.lighting.palette.length >= 2 ? t.lighting.palette : [t.lighting.color || '#888888'];
          return `<span class="theme" data-on="${same(t)}"><button data-tapply="${i}">${esc(t.name)}<i style="background:linear-gradient(90deg,${p.join(',')}${p.length < 2 ? ',' + p[0] : ''})"></i></button><button class="x" data-tdel="${i}" aria-label="Delete ${esc(t.name)}">&times;</button></span>`;
        }).join('')}</span>
          <input type="text" id="l-tname" maxlength="40" placeholder="Name this look" aria-label="Theme name"><button class="btn" data-tsave="1">Save</button></div>`;
      if (keep && $('#' + keep)) $('#' + keep).focus();
    },
    palClick(e) {
      const b = e.target.closest('button'); if (!b) return;
      const L = S.lighting, pal = (L.palette || []).slice();
      if (b.dataset.pc) {
        const c = b.dataset.pc;
        const next = pal.length < 2 ? [L.color.toLowerCase(), c].filter((x, i, arr) => arr.indexOf(x) === i) : pal.includes(c) ? pal.filter((x) => x !== c) : pal.length < 3 ? [...pal, c] : [...pal.slice(1), c];
        if (next.length < 2) return; // 2 or 3 colours, or Rainbow
        setLighting({ palette: next });
      } else if (b.dataset.rainbow) setLighting({ palette: [] });
      else if (b.dataset.tapply) rgb.theme('apply', +b.dataset.tapply);
      else if (b.dataset.tdel) rgb.theme('delete', +b.dataset.tdel);
      else if (b.dataset.tsave) this.saveTheme();
    },
    saveTheme() {
      const n = $('#l-tname').value.trim();
      if (n) rgb.theme('save', n); else $('#l-tname').focus();
    },
    // ---- live LED strips (#27): one row per device, every LED in order ----
    strips() {
      const el = $('#l-strips'); if (!el) return;
      const rows = ST ? ST.devices.map((d) => {
        const empty = d.zones.filter((z) => !z.leds).map((z) => z.name);
        return `<div class="srow"><span class="n" title="${esc(d.name)}">${esc(d.name)}</span><span class="ls" data-k="${esc(d.key)}">${'<b></b>'.repeat(d.leds)}${empty.length ? `<em>${esc(empty.join(', '))}: 0 LEDs, size not set</em>` : ''}</span><span class="c">${d.leds}</span></div>`;
      }) : [];
      this.stripSig = ST ? ST.devices.map((d) => d.key + d.leds).join() : '';
      el.innerHTML = `<span class="lbl">live</span><div class="strips">${rows.join('') || '<span class="sub">Waiting for OpenRGB.</span>'}</div>`;
    },
    paintStrips(m) {
      for (const [k, cs] of Object.entries(m)) {
        const row = $(`#l-strips .ls[data-k="${CSS.escape(k)}"]`); if (!row) continue;
        const bs = row.querySelectorAll('b');
        for (let i = 0; i < cs.length && i < bs.length; i++) bs[i].style.background = '#' + cs[i].toString(16).padStart(6, '0');
      }
    },
    // The global bar. Rebuilt on effect or colour changes from here, the footer or the tray.
    paint() {
      const L = S.lighting, c = L.color, anim = ['breathing', 'spectrum', 'wave', 'cycle', 'sweep'].includes(L.effect);
      // Previews follow the effect colours when they are set, like the lights do.
      const own = (L.palette || []).length >= 2, p = own ? L.palette : null;
      const warmth = (h) => parseInt(h.slice(1, 3), 16) - parseInt(h.slice(5, 7), 16); // same rule as lib/math.js temp
      const ends = own ? [...p].sort((a, b) => warmth(a) - warmth(b)).filter((_, i, a) => i === 0 || i === a.length - 1) : ['#3b4fd8', '#c8323c'];
      const FX = {
        static: c, breathing: `linear-gradient(90deg,#111,${c},#111)`,
        spectrum: own ? `linear-gradient(90deg,${p.join(',')})` : 'linear-gradient(90deg,#c8323c,#ff6a1a,#13a3a3,#2f5bff,#8a5cff)',
        wave: own ? `repeating-linear-gradient(90deg,${p.map((x, i) => `${x} ${i * 5}px ${(i + 1) * 5}px`).join(',')})` : `repeating-linear-gradient(90deg,${c} 0 5px,#111 5px 10px)`,
        cycle: `linear-gradient(90deg,${own ? p[0] : c} 0 40%,${own ? p[1] : '#3b4fd8'} 60% 100%)`,
        sweep: `linear-gradient(90deg,#111 0 20%,${own ? p[0] : c} 50%,#111 80%)`,
        temp: `linear-gradient(90deg,${ends[0]},${ends[1]})`, off: '#111',
      };
      const a = document.activeElement, keep = a && (a.id ? '#' + a.id : a.dataset.fx ? `[data-fx="${a.dataset.fx}"]` : null);
      this.palette();
      $('#l-all').innerHTML = `<span class="lbl">every device</span>
        <div class="fx">${EFFECTS.map(([k, l]) => `<button data-fx="${k}" aria-pressed="${k === L.effect}"><span class="pv" style="background:${FX[k]}"></span>${l}</button>`).join('')}</div>
        <div class="lg-col"><input type="color" id="l-color" class="cdot" value="${c}" aria-label="Colour"><input type="text" id="l-hex" class="num" value="${c}" aria-label="Hex colour"></div>
        <div class="lg-sl">${anim ? `<label class="ctl"><span class="lbl">speed</span><input type="range" id="l-speed" min="0" max="100" value="${L.speed}"><span class="v num" id="l-speed-v">${L.speed}</span></label>` : ''}
          ${L.effect === 'temp' ? `<div class="ctl"><span class="lbl">follows</span><span class="sub" id="l-temp">${this.tempText()}</span><span></span></div>` : ''}
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
        patchDev(d.key, { zones });
      }
      if (page === 'lighting' && ST) this.refresh();
    },
    setBright(g, v) {
      v = Math.max(0, Math.min(100, Math.round(v)));
      for (const d of g.devs) patchDev(d.key, { brightness: v });
      for (const el of main.querySelectorAll(`[data-bright="${CSS.escape(g.key)}"]`)) {
        el.style.setProperty('--p', v + '%'); el.setAttribute('aria-valuenow', v);
        if (el.value != null) el.value = v;
        const out = el.parentElement.querySelector('.bv'); if (out) out.textContent = v + '%';
      }
      this.refresh();
    },
    changed(g) {
      return g.devs.some((d) => { const x = this.dev(d); return x.off || (x.brightness ?? 100) !== 100 || Object.keys(x.zones || {}).length || (isWraith(d) && (x.fanWhite ?? 240) !== 240) || (x.gain || []).some((v) => v !== 1) || (x.gamma ?? 2.2) !== 2.2; });
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
        <div class="body2${canColour ? '' : ' nocol'}">${canColour || fan ? picker : `<div class="col">${this.brightRow(g, b)}${this.resetRow(g)}</div>`}</div>
        ${canColour ? this.tuning(g) : ''}</div>`;
    },
    // Colour tuning (moved from the old Devices page): scales red, green and blue so whites match across devices.
    // Applies to the chosen stick or zone's device, else to every device in the tile.
    tuneDevs(g) { const k = this.zone && zsplit(this.zone)[0]; return g.devs.filter((d) => !k || d.key === k); },
    tuning(g) {
      const x = this.dev(this.tuneDevs(g)[0]), gn = x.gain || [1, 1, 1], gm = x.gamma || 2.2;
      return `<div class="tune"><div class="col"><span class="lbl">colour tuning</span>
          <div class="row"><div class="tw"><div style="background:#fff"></div><span class="lbl">sent</span></div><div class="tw"><div id="l-after" style="background:${tune('#ffffff', x)}"></div><span class="lbl">shown</span></div></div>
          <p class="helptext">Scales red, green and blue so whites match across devices.</p>
          <div class="row" style="flex-wrap:wrap"><button class="btn" data-tune-reset="1">Reset tuning</button><button class="btn" data-copy="1">Copy to every device</button><button class="btn" data-identify="1">Identify</button></div></div>
        <div class="col">${['red', 'green', 'blue'].map((n, i) => slider(`l-${n[0]}`, n, 0, 100, Math.round(gn[i] * 100), gn[i].toFixed(2))).join('')}
          ${slider('l-gamma', 'gamma', 10, 30, Math.round(gm * 10), gm.toFixed(1))}</div></div>`;
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
        for (const d of g.devs) patchDev(d.key, { off });
      } else if (ds.reset) {
        for (const d of g.devs) patchDev(d.key, { off: false, brightness: 100, fanWhite: 240, gain: [1, 1, 1], gamma: 2.2, zones: Object.fromEntries(Object.keys(this.dev(d).zones || {}).map((i) => [i, null])) });
      } else if (ds.identify) { for (const d of this.tuneDevs(g)) rgb.identify(d.key); return; }
      else if (ds.tuneReset) { for (const d of this.tuneDevs(g)) patchDev(d.key, { gain: [1, 1, 1], gamma: 2.2 }); }
      else if (ds.copy) { const x = this.dev(this.tuneDevs(g)[0]); for (const d of ST.devices) patchDev(d.key, { gain: [...(x.gain || [1, 1, 1])], gamma: x.gamma || 2.2 }); }
      else if (ds.c) { this.setColour(g, ds.c); }
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
      } else if (/^l-([rgb]|gamma)$/.test(t.id)) {
        for (const d of this.tuneDevs(g)) {
          if (t.id === 'l-gamma') { patchDev(d.key, { gamma: t.value / 10 }); continue; }
          const gain = [...(this.dev(d).gain || [1, 1, 1])]; gain['rgb'.indexOf(t.id[2])] = t.value / 100;
          patchDev(d.key, { gain });
        }
        $(`#${t.id}-v`).textContent = t.id === 'l-gamma' ? (t.value / 10).toFixed(1) : (t.value / 100).toFixed(2);
        $('#l-after').style.background = tune('#ffffff', this.dev(this.tuneDevs(g)[0]));
        this.refresh();
      } else if (t.id === 'l-fanw') {
        const d = g.devs.find((x) => x.key === zsplit(this.zone)[0]);
        $('#l-fanw-v').textContent = t.value; patchDev(d.key, { fanWhite: +t.value }); this.refresh();
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
      if ($('#l-temp')) $('#l-temp').innerHTML = this.tempText(); // fixed text plus a number, nothing from outside
      if (this.dragging || !$('#l-grid')) return;
      if (ST.devices.map((d) => d.key).join() !== this.sig) this.draw(); else this.refresh();
    },
  },

  // Drivers: what this PC runs on, hardware first. Windows drivers come from a vendor catalog in main, so the list
  // also works after a Windows reset. Only KelvinRGB, OpenRGB and PawnIO install in place; the rest open the maker's page.
  drivers: {
    sig: '',
    build() {
      this.sig = '';
      main.innerHTML = `<div id="v" style="display:contents"><div class="hd"><h1>Drivers</h1><span class="sub" id="v-sub"></span><span class="grow"></span><button class="btn" id="v-check">Check now</button></div>
        <div class="g guard" id="v-guard" hidden><span class="dot warn"></span>Apex is running. Installs wait until the game closes.</div>
        <div class="g" id="v-hw"></div><div class="g" id="v-win"></div><div class="g" id="v-app"></div></div>`;
      $('#v-check').onclick = () => rgb.drivers('check');
      $('#v').onclick = (e) => {
        const b = e.target.closest('button'); if (!b || b.disabled) return;
        if (b.dataset.drv) rgb.drivers(b.dataset.drv);
        else if (b.dataset.upd) rgb.update('install');
        else if (b.dataset.rescan) rgb.rescan();
      };
      if (!ST.drivers.at && !ST.drivers.checking) rgb.drivers('check');
      this.live();
    },
    live() {
      if (page !== 'drivers' || !$('#v-hw')) return;
      const V = ST.drivers, u = ST.update || {}, g = !!ST.guard;
      const sig = JSON.stringify([V, u, g, ST.version, ST.setup, ST.sensors.ok, ST.openrgb.ok, ST.devices.map((d) => [d.key, d.firmware])]);
      if (sig === this.sig) return;
      this.sig = sig;
      const a = document.activeElement, fk = a && a.dataset && ['drv', 'upd', 'rescan'].find((x) => x in a.dataset), fv = fk && a.dataset[fk];
      const tag = (v) => String(v || '').replace(/^(release_|v)/i, '').replace(/^(\d+\.\d+\.\d+)\.0$/, '$1');
      const btn = (attr, label, primary) => `<button class="btn${primary ? ' p' : ''}" ${attr} ${g ? 'disabled' : ''}>${label}</button>`;
      const row = (n, what, inst, latest, dot, status, act, busy) => `<div class="r"><div><span class="nm">${esc(n)}</span><span class="what">${esc(what)}</span></div>
        <div class="v${inst ? '' : ' dim'}">${esc(inst || 'none')}</div><div class="v${!latest || latest === inst ? ' dim' : ''}">${esc(latest || 'not checked')}</div>
        <div><div class="st t-${busy ? 'acc' : dot}"><span class="dot ${busy ? 'acc' : dot}"></span>${esc(busy ? 'Installing' : status)}</div></div>
        <div class="act">${busy ? '' : act}</div></div>`;
      const head = (a1, b1, c1) => `<div class="hrow"><span class="lbl">${a1}</span><span class="lbl">${b1}</span><span class="lbl">${c1}</span><span class="lbl">status</span><span class="lbl act"></span></div>`;
      const sec = (lbl, right, body, note) => `<div class="row"><span class="lbl grow">${lbl}</span>${right}</div><div class="drv">${body}</div>${note ? `<p class="helptext">${note}</p>` : ''}`;

      // hardware: OpenRGB's devices, same-name sticks on one row
      const gs = ST.devices.length ? pages.lighting.groups() : [];
      const hw = gs.map((x) => {
        const fw = [...new Set(x.devs.map((d) => d.firmware).filter(Boolean))].join(', ');
        return `<div class="r"><div><span class="nm">${esc(x.name)}${x.devs.length > 1 ? ` × ${x.devs.length}` : ''}</span><span class="what">${esc(pages.lighting.sub(x))}</span></div>
          <div class="v span2${fw ? '' : ' dim'}">${esc(fw || 'not reported')}</div><div><div class="st"><span class="dot ok"></span>Seen by OpenRGB</div></div><div class="act"></div></div>`;
      }).join('');
      $('#v-hw').innerHTML = sec('hardware', `<button class="btn" data-rescan="1">Rescan</button>`,
        `<div class="hrow"><span class="lbl">device</span><span class="lbl span2">firmware</span><span class="lbl">status</span><span class="lbl act"></span></div>${hw}`,
        gs.length ? "Firmware is what each device reports to OpenRGB. No maker publishes firmware versions KelvinRGB can check, so firmware gets no update colour. Updates come from the maker's own tool." : `${esc(ST.openrgb.msg)}. Devices show once OpenRGB runs.`);

      // windows drivers, PawnIO first since KelvinRGB can install it
      const P = V.pawnio || {}, pBusy = ST.setup && ST.setup.busy === 'pawnio';
      const pAct = { install: btn('data-drv="pawnio"', 'Install', 1), update: btn('data-drv="pawnio"', 'Update', 1), page: btn('data-drv="pawnio-page"', 'Get', !P.installed) }[P.act] || '';
      const pawn = row('PawnIO', 'Kernel driver the sensor service uses for fan headers.', tag(P.installed), tag(P.latest), P.tone || 'dim',
        !P.installed ? 'Not installed' : P.tone === 'ok' ? (ST.setup && ST.setup.pawnio ? 'Running' : 'Installed, not running') : P.tone === 'dim' ? 'Installed' : 'Update available', pAct, pBusy);
      const win = (V.windows || []).map((w) => {
        const status = w.state === 'none' ? 'No driver' : w.state === 'inbox' && !w.inboxOk ? "On Windows' basic driver" : w.wu ? 'Update on Windows Update' : w.state === 'inbox' ? 'Windows driver, works' : 'Installed';
        const inst = w.installed || (w.state === 'inbox' ? 'Windows' : '');
        const latest = w.wu == null || w.state === 'none' ? '' : w.wu ? 'newer out' : 'nothing newer';
        return row(w.name, `${w.what} ${w.device}`, inst, latest, w.tone || 'dim', status, btn(`data-drv="${esc(w.id)}"`, w.state === 'ok' || w.inboxOk ? 'Open site' : 'Get driver', w.state !== 'ok' && !w.inboxOk));
      }).join('');
      $('#v-win').innerHTML = sec('windows drivers', '', head('driver', 'installed', 'latest') + pawn + win,
        V.at ? "Everything this PC's hardware needs after a Windows reset. Latest is what Windows Update offers; the maker's site can be newer. Green: up to date. Orange: an update is out. Red: missing, or on Windows' basic driver." : 'Reading drivers from Windows.');

      // KelvinRGB and what it runs
      const up = u.kind === 'available', uBusy = u.kind === 'downloading' || u.kind === 'installing';
      const kLatest = up ? u.v : u.kind === 'current' ? ST.version : '';
      const major = (v) => parseInt(String(v || '0'), 10) || 0;
      const kelvin = row('KelvinRGB', 'This app. Updates from GitHub releases.', ST.version, kLatest, up ? (major(u.v) > major(ST.version) ? 'bad' : 'warn') : u.kind === 'failed' ? 'bad' : kLatest ? 'ok' : 'dim',
        up ? 'Update available' : uBusy ? u.text : u.kind === 'failed' ? u.text : u.kind === 'checking' ? 'Checking' : 'Up to date', up ? btn('data-upd="1"', 'Update', 1) : '', false);
      const O = V.openrgb || {}, oBusy = V.busy === 'openrgb';
      const oAct = { install: btn('data-drv="openrgb"', 'Install', 1), update: btn('data-drv="openrgb"', 'Update', 1), page: btn('data-drv="openrgb-page"', 'Get', !O.installed) }[O.act] || '';
      const orgb = row('OpenRGB', 'Talks to the lights. Server on 127.0.0.1:6742.', tag(O.installed), tag(O.latest), O.tone || 'dim',
        !O.installed ? 'Not installed' : O.tone === 'warn' || O.tone === 'bad' ? 'Update available' : ST.openrgb.ok ? 'Running' : ST.openrgb.msg, oAct, oBusy);
      const lhm = V.lhm ? V.lhm.replace(/\.0$/, '') : '';
      const sens = row('Sensor service', 'KelvinRGB sidecar on LibreHardwareMonitorLib. Updates with KelvinRGB.', lhm, lhm, ST.sensors.ok ? 'ok' : 'warn', ST.sensors.ok ? 'Live' : ST.sensors.msg, '', false);
      $('#v-app').innerHTML = sec('kelvinrgb', '', head('part', 'installed', 'latest') + kelvin + orgb + sens,
        (V.msg ? `<span style="color:var(--bad)">${esc(V.msg)}.</span> ` : '') + 'Each download is checked against its pinned hash, runs once, then gets deleted.');

      const { missing, ups } = driverSummary();
      $('#v-sub').textContent = `${gs.length} devices · ${(V.windows || []).length + 1} drivers · ${[missing && `${missing} missing`, ups && `${ups} update${ups > 1 ? 's' : ''}`].filter(Boolean).join(' · ') || 'all set'}`
        + (V.checking ? ' · checking' : V.at ? ` · checked ${new Date(V.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '');
      $('#v-check').disabled = !!V.checking;
      $('#v-guard').hidden = !g;
      if (fk) { const el = [...main.querySelectorAll(`[data-${fk}]`)].find((x) => x.dataset[fk] === fv); if (el) el.focus(); }
    },
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
      main.innerHTML = `<div class="hd"><h1>Fans</h1><span class="sub">Never below ${FLOOR}%. If KelvinRGB stops, board fans go back to the BIOS and hub fans to 100%.</span></div>
      <p class="helptext" id="c-busy" hidden></p>
      <p class="helptext" id="c-unclean" hidden>The sensor service was force-killed earlier this boot, so fans left on BIOS are held at 100% until you reboot.</p>
      ${c ? `<div class="grid" style="grid-template-columns:270px minmax(0,1fr);align-items:start">
        <div class="g" style="padding:8px" id="c-list"></div>
        <div class="g" style="display:flex;flex-direction:column;gap:14px">
          <div class="row" style="flex-wrap:wrap"><div style="flex:1"><div style="font-size:16px;font-weight:500">${esc(fanName(c))}</div><div class="sub" id="c-sub"></div></div>${seg('mode', [['curve', 'Curve'], ['fixed', 'Fixed'], ['bios', c.kind === 'hub' ? 'Hub 100%' : 'BIOS']], f.mode)}</div>
          <svg class="curve" id="c-svg" viewBox="-36 -10 476 236" role="img" aria-label="Fan curve: temperature to fan speed"></svg>
          <span class="lbl">drag points · double click to add · right click to remove</span>
          <div id="c-fixed" ${f.mode === 'fixed' ? '' : 'hidden'}>${slider('c-fixed-r', 'fixed speed', FLOOR, 100, f.fixed ?? 50, `${f.fixed ?? 50}%`)}</div>
          <div class="row" style="flex-wrap:wrap;gap:14px">
            <label class="row"><span class="lbl">follows</span><select class="btn" id="c-sensor">${temps.map((s) => `<option value="${esc(s.id)}" ${s.id === f.sensor ? 'selected' : ''}>${esc(s.hwName)} · ${esc(s.name)}</option>`).join('')}</select></label>
            ${seg('shape', [['smooth', 'Smooth'], ['linear', 'Linear'], ['stepped', 'Steps']], f.shape)}
            <label class="row"><span class="lbl">preset</span><select class="btn" id="c-preset"><option value="">Choose</option>${Object.keys(PRESETS).map((p) => `<option>${p}</option>`).join('')}</select></label>
            <span class="grow"></span><span class="lbl" id="c-dirty"></span><button class="btn" id="c-apply-all">Apply to all fans</button><button class="btn p" id="c-apply">Apply</button>
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
      $('#c-apply-all').onclick = () => { const { id: _, ...cfg } = f; for (const x of ST.controls) { const keep = S.fans[x.id]?.label; S.fans[x.id] = { ...structuredClone(cfg), ...(keep ? { label: keep } : {}) }; rgb.fan(x.id, S.fans[x.id]); } this.dirty(); this.live(); };
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
        const empty = fanEmpty(c);
        return `<button class="fan${empty ? ' empty' : ''}" data-id="${esc(c.id)}" aria-pressed="${c.id === this.sel}"><span>${esc(fanName(c))}</span><span class="mono">${empty ? 'empty' : `${fanRpm(c) ?? '-'} rpm`}</span><span class="m">${esc(fanOwner(c))} · ${Math.round(c.value)}%</span><span class="m">${esc(c.hw)}</span></button>`;
      }).join('');
      // Two apps on one header make the fan hunt, so Apply waits until the other app closes (main enforces it too).
      const sel = ST.controls.find((x) => x.id === this.sel), app = sel && fanApp(sel), any = ST.controls.some(fanApp);
      if ($('#c-apply')) { $('#c-apply').disabled = !!app; $('#c-apply-all').disabled = any; }
      if ($('#c-busy')) { $('#c-busy').hidden = !app; $('#c-busy').textContent = app ? `${app.label} is driving this fan. Close it to let KelvinRGB take over.` : ''; }
      if ($('#c-svg') && !document.querySelector('#c-svg:active')) this.drawCurve();
    },
  },

  system: {
    build() {
      main.innerHTML = `<div class="hd"><h1>System</h1><span class="sub">Live readings from LibreHardwareMonitor. The line is the last minute.</span></div>
      <div class="grid c4" id="y-tiles"></div>
      <div class="g"><details id="y-all" open><summary class="lbl">all sensors</summary><table class="sensors" id="y-tbl"></table></details></div>`;
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
          <div><span class="t"><span>Settings backup</span><span>Colours, devices and fan curves in one file</span></span><span class="row" style="gap:8px"><button class="btn" id="s-exp">Export</button><button class="btn" id="s-imp">Import</button></span></div>
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
      $('#s-exp').onclick = () => rgb.backup('export');
      $('#s-imp').onclick = () => rgb.backup('import');
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
  if (page === 'home' && ST) pages.home.live();
}
function footer() {
  const L = S.lighting;
  const c = lightsOn() ? L.color : '#1b1c1e';
  document.documentElement.style.setProperty('--glow', L.effect === 'spectrum' && L.on ? '#8a5cff' : c);
  document.documentElement.classList.toggle('dark-lights', !lightsOn());
  $$('#ft-dots button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.c === L.color));
  $('#ft-power').setAttribute('aria-pressed', L.on);
  $('#ft-bright').value = L.brightness;
  $('#ft-bright-v').textContent = L.brightness;
}
$('#ft-ver').onclick = () => rgb.update('install');
// Footer quick colours: six slots from my gel set. Right-click a slot to pick its colour; kept in this PC's localStorage.
const QUICK = ['#ffe2bf', '#b3121f', '#e0561b', '#2448ff', '#0b7f7a', '#7a4dff'];
let quick = QUICK;
try { const q = JSON.parse(localStorage.getItem('quickColours')); if (Array.isArray(q) && q.length === 6 && q.every((h) => /^#[0-9a-f]{6}$/i.test(h))) quick = q; } catch { /* first run */ }
function drawQuick() {
  $('#ft-dots').innerHTML = quick.map((h, i) => `<button data-c="${h}" data-i="${i}" aria-label="Colour ${h}" title="${h} · right-click to change" style="background:${h}"></button>`).join('') + '<input type="color" id="ft-pick" tabindex="-1" aria-hidden="true">';
  if (S) footer();
}
drawQuick();
$('#ft-dots').onclick = (e) => { const b = e.target.closest('[data-c]'); if (b) setLighting({ color: b.dataset.c, on: true }); };
$('#ft-dots').oncontextmenu = (e) => {
  const b = e.target.closest('[data-c]'); if (!b) return;
  e.preventDefault();
  const pk = $('#ft-pick'), i = +b.dataset.i;
  pk.value = quick[i];
  pk.oninput = () => { b.style.background = pk.value; setLighting({ color: pk.value, on: true }, false); };
  pk.onchange = () => { quick = quick.map((h, j) => (j === i ? pk.value : h)); try { localStorage.setItem('quickColours', JSON.stringify(quick)); } catch { /* not saved */ } drawQuick(); };
  pk.click();
};
$('#ft-power').onclick = () => setLighting({ on: !S.lighting.on });
$('#ft-bright').oninput = (e) => setLighting({ brightness: +e.target.value }, false);
$$('nav [data-page]').forEach((b) => (b.onclick = () => go(b.dataset.page)));
document.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });

function go(p) {
  if (!pages[p]) return;
  page = p;
  rgb.leds(p === 'lighting'); // the live strips only cost frames while they are on screen
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
    openrgb: x.openrgb ? ['ok', 'Installed', ''] : ST.drivers.busy === 'openrgb' ? ['wait', 'Installing', ''] : ['need', 'Not found', 'Install'],
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
  const au = ST.autostart || {};
  $('#su-auto').hidden = !au.supported; // installed app only, like Settings
  $('#su-auto-tg').setAttribute('aria-pressed', !!au.on);
  $('#su-what-pawnio').textContent = 'Kernel driver from pawnio.eu · 3.4 MB · ' + (x.bundled ? 'ships with KelvinRGB' : 'opens the download page') + ' · GPL-2, source at github.com/namazso/PawnIO · asks Windows for admin once';
  const left = Object.values(rows).filter((r) => r[0] === 'need').length;
  $('#su-sub').textContent = ST.guard ? 'Apex or Easy Anti-Cheat is running. Setup waits until the game closes.'
    : left ? (left === 1 ? 'One needs' : left + ' need') + ' your attention on this PC. Each card says what it is and why KelvinRGB needs it.'
    : 'Everything is in place. You can open this again from Settings.';
}
$('#setup').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) rgb.setup(b.dataset.act); });
$('#su-done').onclick = closeSetup;
$('#su-auto-tg').onclick = (e) => rgb.autostart(e.currentTarget.getAttribute('aria-pressed') !== 'true');
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
    <span class="grow">${esc(x.label)}${x.note && x.note !== x.name ? `<small>${esc(x.note)}</small>` : ''}${x.holds ? `<small>${esc(x.holds)}</small>` : ''}</span>
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
  if (page === 'fans' && fansChanged) pages[page].build();
  if (page === 'lighting' && pages.lighting.stripSig !== s.devices.map((d) => d.key + d.leds).join()) pages.lighting.strips();
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
  rgb.onLeds((m) => { if (page === 'lighting') pages.lighting.paintStrips(m); });
  // the tray menu changed something: take main's copy and redraw
  rgb.onSettings((s) => { S = s; applyGlass(); footer(); if (page === 'lighting' || page === 'settings') go(page); if (page === 'home') pages.home.live(); });
});
