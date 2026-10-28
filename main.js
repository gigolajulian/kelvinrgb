// KelvinRGB: one window for lighting (OpenRGB SDK), sensors and fans (LibreHardwareMonitor sidecar).
const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn, execFile, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { Client } = require('openrgb-sdk');
const M = require('./lib/math');

const FLOOR = 25;
const GUARD_PROCS = ['r5apex.exe', 'r5apex_dx12.exe', 'easyanticheat.exe', 'easyanticheat_eos.exe'];
const OPENRGB_EXE = ['C:\\Program Files\\OpenRGB\\OpenRGB.exe', path.join(process.env.LOCALAPPDATA || '', 'Programs', 'OpenRGB', 'OpenRGB.exe')];

// LibreHardwareMonitor and OpenRGB need admin to reach SMBus / Super I/O. Relaunch elevated once.
function isAdmin() {
  try { execFileSync('net', ['session'], { stdio: 'ignore' }); return true; } catch { return false; }
}
if (!isAdmin() && !process.env.RGB_NO_ELEVATE) {
  const ps = `Start-Process -FilePath '${process.execPath}' -ArgumentList '"${app.getAppPath()}"' -WorkingDirectory '${app.getAppPath()}' -Verb RunAs`;
  spawn('powershell', ['-NoProfile', '-Command', ps], { detached: true, stdio: 'ignore' }).unref();
  app.exit(0);
}

// ---------- settings ----------
const settingsFile = path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  lighting: { effect: 'static', color: '#c8323c', speed: 40, brightness: 80, on: true },
  devices: {}, // key -> { brightness, gain: [r,g,b], gamma }
  fans: {},    // control id -> { mode: bios|curve|fixed, sensor, points, shape, fixed }
};
let settings = structuredClone(DEFAULTS);
try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8').replace(/^﻿/, '')) }; } catch (e) { console.log(`settings: ${e.message}`); }
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2)), 300);
}

// ---------- shared state pushed to the window ----------
const state = {
  openrgb: { ok: false, msg: 'connecting' },
  sensors: { ok: false, msg: 'starting', admin: isAdmin(), unclean: false },
  guard: false,
  devices: [], // { key, id, name, type, leds, zones: [{name, leds}] }
  hw: [],
  controls: [],
  log: [],
};
let win;
function push() { if (win && !win.isDestroyed()) win.webContents.send('state', state); }
function log(msg) {
  state.log = [...state.log.slice(-49), `${new Date().toLocaleTimeString()} ${msg}`];
  console.log(msg);
}

// ---------- lighting ----------
let client = null;
let renderTimer = null;
const identify = new Map(); // device key -> until (ms)

function findOpenRgb() { return OPENRGB_EXE.find((p) => fs.existsSync(p)); }

let launchedOpenRgb = false;
async function connectOpenRgb() {
  if (client || state.guard) return;
  const c = new Client('KelvinRGB', 6742, '127.0.0.1');
  try {
    await c.connect(1500);
  } catch {
    const exe = findOpenRgb();
    state.openrgb = { ok: false, msg: exe ? 'starting openrgb' : 'openrgb not installed' };
    if (exe && !launchedOpenRgb) {
      launchedOpenRgb = true;
      spawn(exe, ['--server', '--startminimized'], { detached: true, stdio: 'ignore' }).unref();
      log('launched OpenRGB SDK server');
    }
    push();
    return;
  }
  client = c;
  c.on('disconnect', () => { client = null; state.openrgb = { ok: false, msg: 'disconnected' }; push(); });
  await loadDevices();
}

async function loadDevices() {
  const devs = await client.getAllControllerData();
  state.devices = devs.map((d) => ({
    key: `${d.name}|${d.location}`, id: d.deviceId, name: d.name, type: d.type,
    leds: d.colors.length, zones: d.zones.map((z) => ({ name: z.name, leds: z.ledsCount })),
  }));
  for (const d of state.devices) if (d.leds) client.setCustomMode(d.id);
  state.openrgb = { ok: true, msg: `${state.devices.length} devices` };
  log(`OpenRGB: ${state.devices.map((d) => d.name).join(', ')}`);
  push();
  startRender();
}

function startRender() {
  clearInterval(renderTimer);
  const animated = ['breathing', 'spectrum', 'wave'].includes(settings.lighting.effect) || identify.size;
  renderTimer = setInterval(render, animated ? 33 : 1000); // static repaints once a second in case a device drifts
  render();
}

function render() {
  if (!client || state.guard) return;
  const L = settings.lighting;
  const base = M.hexToRgb(L.color);
  const t = Date.now() / 1000;
  const now = Date.now();
  for (const d of state.devices) {
    if (!d.leds) continue;
    const dev = settings.devices[d.key] || {};
    const bright = (L.on ? L.brightness / 100 : 0) * ((dev.brightness ?? 100) / 100);
    const flashing = (identify.get(d.key) || 0) > now;
    const colors = [];
    for (let i = 0; i < d.leds; i++) {
      const c = flashing ? (Math.floor(now / 250) % 2 ? { red: 255, green: 255, blue: 255 } : { red: 0, green: 0, blue: 0 })
        : M.frame(L.effect, base, t, L.speed, i, d.leds);
      colors.push(M.tune(c, dev, flashing ? 1 : bright));
    }
    try { client.updateLeds(d.id, colors); } catch (e) { log(`updateLeds ${d.name}: ${e.message}`); }
  }
  for (const [k, until] of identify) if (until <= now) { identify.delete(k); startRender(); }
}

// ---------- sensors + fans ----------
let sidecar = null;
let sidecarStopping = false;
const SIDECAR = path.join(__dirname, 'sidecar', 'sidecar.exe');

function startSidecar() {
  if (sidecar || state.guard) return;
  if (!fs.existsSync(SIDECAR)) { state.sensors = { ...state.sensors, ok: false, msg: 'run npm run build:sidecar' }; push(); return; }
  sidecarStopping = false;
  const p = spawn(SIDECAR, ['--floor', String(FLOOR)], { cwd: path.dirname(SIDECAR), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  sidecar = p;
  readline.createInterface({ input: p.stdout }).on('line', onSidecarLine);
  p.stderr.on('data', (b) => log(`sidecar: ${b}`));
  p.stdin.on('error', () => {});
  p.on('exit', (code) => {
    sidecar = null;
    state.sensors = { ...state.sensors, ok: false, msg: sidecarStopping ? 'stopped' : `exited (${code}), restarting` };
    push();
    if (!sidecarStopping) { log(`sidecar exited unexpectedly (${code}), restarting`); setTimeout(startSidecar, 1500); }
  });
}

function send(msg) { if (sidecar) sidecar.stdin.write(JSON.stringify(msg) + '\n'); }

function stopSidecar() {
  return new Promise((resolve) => {
    if (!sidecar) return resolve();
    sidecarStopping = true;
    const p = sidecar;
    const t = setTimeout(() => { p.kill(); resolve(); }, 4000);
    p.once('exit', () => { clearTimeout(t); resolve(); });
    p.stdin.end(); // sidecar hands every fan back to BIOS on EOF
  });
}

function onSidecarLine(line) {
  let m;
  try { m = JSON.parse(line); } catch { return log(`sidecar: ${line}`); }
  if (m.type === 'log') return log(`sidecar: ${m.msg}`);
  if (m.type === 'ready') {
    state.sensors = { ok: true, msg: m.admin ? 'ok' : 'no admin', admin: m.admin, unclean: m.unclean };
    log(`sidecar ready: ${m.controls} fan controls, admin ${m.admin}`);
  }
  if (m.type === 'tick') {
    state.hw = m.hw;
    state.controls = m.controls;
    state.sensors.unclean = m.unclean;
    driveFans();
  }
  push();
}

function sensorValue(id) {
  for (const h of state.hw) for (const s of h.sensors) if (s.id === id) return s.value;
  return null;
}

function driveFans() {
  for (const c of state.controls) {
    const f = settings.fans[c.id];
    if (!f || f.mode === 'bios') { if (c.ours) send({ cmd: 'auto', id: c.id }); continue; }
    if (f.mode === 'fixed') { send({ cmd: 'set', id: c.id, duty: f.fixed ?? 50 }); continue; }
    const temp = sensorValue(f.sensor);
    // Lost the sensor: run the fan hard rather than guess.
    const duty = temp == null ? 100 : M.curveDuty(f.points, temp, f.shape);
    send({ cmd: 'set', id: c.id, duty: Math.max(FLOOR, duty) });
  }
}
setInterval(() => send({ cmd: 'ping' }), 1000); // keeps the sidecar watchdog fed

// ---------- Apex / Easy Anti-Cheat guard ----------
function checkGuard() {
  execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true }, async (err, out) => {
    if (err) return;
    const names = out.toLowerCase();
    const active = GUARD_PROCS.some((p) => names.includes(`"${p}"`));
    if (active === state.guard) return;
    state.guard = active;
    if (active) {
      log('apex guard: game running, releasing fans and lighting');
      clearInterval(renderTimer);
      await stopSidecar();
      if (client) { client.disconnect(); client = null; }
      state.openrgb = { ok: false, msg: 'paused for apex' };
      state.sensors = { ...state.sensors, ok: false, msg: 'paused for apex' };
    } else {
      log('apex guard: game closed, resuming');
      startSidecar();
      connectOpenRgb();
    }
    push();
  });
}

// ---------- IPC ----------
ipcMain.handle('get', () => ({ settings, state, floor: FLOOR }));
ipcMain.on('lighting', (_e, patch) => { Object.assign(settings.lighting, patch); save(); startRender(); });
ipcMain.on('device', (_e, key, patch) => { settings.devices[key] = { ...settings.devices[key], ...patch }; save(); render(); });
ipcMain.on('identify', (_e, key) => { identify.set(key, Date.now() + 2000); startRender(); });
ipcMain.on('fan', (_e, id, cfg) => { settings.fans[id] = cfg; save(); driveFans(); });
ipcMain.on('rescan', async () => { if (client) { client.requestRescan(); setTimeout(() => loadDevices().catch((e) => log(e.message)), 3000); } });

// ---------- app ----------
app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 900, minHeight: 600, backgroundColor: '#0d0e0f', autoHideMenuBar: true, title: 'KelvinRGB',
    // Screenshot mode runs behind other windows, where Chromium would otherwise stop painting.
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: !process.env.RGB_SHOT },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Dev aid: RGB_SHOT=<folder> writes fans.txt and a screenshot of each page, starting at 10 s.
  if (process.env.RGB_SHOT) setTimeout(async () => {
    for (const p of ['monitoring', 'lighting', 'devices', 'cooling']) {
      await win.webContents.executeJavaScript(`go(${JSON.stringify(p)})`);
      await new Promise((r) => setTimeout(r, 1500));
      fs.writeFileSync(path.join(process.env.RGB_SHOT, `${p}.png`), (await win.webContents.capturePage()).toPNG());
    }
    // after the screenshots, so the sidecar has ticked at least once
    const rpm = (c) => (state.hw.find((h) => h.name === c.hw)?.sensors.find((s) => s.type === 'Fan' && s.index === c.index) || {}).value;
    fs.writeFileSync(path.join(process.env.RGB_SHOT, 'fans.txt'), state.controls.map((c) => `${c.name}: ${Math.round(rpm(c) ?? -1)} rpm, ${c.value}%, ours ${c.ours}, cfg ${JSON.stringify(settings.fans[c.id] || null)}`).join('\n'));
  }, 10000);
  checkGuard();
  setInterval(checkGuard, 4000);
  // Give the guard its first look before touching any device.
  setTimeout(() => { startSidecar(); connectOpenRgb(); }, 1500);
  setInterval(connectOpenRgb, 3000);
});

let quitting = false;
app.on('before-quit', async (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  clearInterval(renderTimer);
  await stopSidecar();
  if (client) client.disconnect();
  app.quit();
});
app.on('window-all-closed', () => app.quit());
