// KelvinRGB: one window for lighting (OpenRGB SDK), sensors and fans (LibreHardwareMonitor sidecar).
const { app, BrowserWindow, ipcMain, Notification, session, shell, Tray, Menu, nativeImage } = require('electron');
const { spawn, execFile, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { Client } = require('openrgb-sdk');
const M = require('./lib/math');
const C = require('./lib/conflicts');
const V = require('./lib/validate');
const U = require('./lib/update');

const FLOOR = 25;
const GUARD_PROCS = ['r5apex.exe', 'r5apex_dx12.exe', 'easyanticheat.exe', 'easyanticheat_eos.exe'];
// Only the admin-owned install: an elevated app must never launch an exe from a user-writable folder.
const OPENRGB_EXE = [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'OpenRGB', 'OpenRGB.exe')];
// System tools by absolute path, so a planted tasklist.exe can't run elevated.
const SYS = (exe) => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', exe);
const DEV = !app.isPackaged; // dev switches (RGB_*) only work from source

// LibreHardwareMonitor and OpenRGB need admin to reach SMBus / Super I/O. Relaunch elevated once.
function isAdmin() {
  try { execFileSync(SYS('net.exe'), ['session'], { stdio: 'ignore' }); return true; } catch { return false; }
}
if (!isAdmin() && !(DEV && process.env.RGB_NO_ELEVATE)) {
  const q = (s) => s.replace(/'/g, "''"); // PowerShell single-quote escape
  const ps = `Start-Process -FilePath '${q(process.execPath)}' -ArgumentList '"${q(app.getAppPath())}"' -WorkingDirectory '${q(app.getAppPath())}' -Verb RunAs`;
  spawn(SYS('WindowsPowerShell\\v1.0\\powershell.exe'), ['-NoProfile', '-Command', ps], { detached: true, stdio: 'ignore' }).unref();
  app.exit(0);
} else if (!app.requestSingleInstanceLock()) {
  // One copy only: two elevated instances would fight over the fan headers. Taken after the relaunch,
  // so the short-lived non-admin parent never holds it.
  app.exit(0);
}

// ---------- settings ----------
const settingsFile = path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  lighting: { effect: 'static', color: '#c8323c', speed: 40, brightness: 80, on: true },
  devices: {}, // key -> { brightness, gain: [r,g,b], gamma }
  fans: {},    // control id -> { mode: bios|curve|fixed, sensor, points, shape, fixed }
  closeConflicts: true, // show the conflict list when RGB apps that fight us run (lib/conflicts.js)
  glass: true, // Windows 11 acrylic behind the window
};
let settings = structuredClone(DEFAULTS);
try { settings = V.settings(JSON.parse(fs.readFileSync(settingsFile, 'utf8').replace(/^﻿/, '')), DEFAULTS, FLOOR); } catch (e) { console.log(`settings: ${e.message}`); }
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
  conflicts: null, // [{ name, label, note, closable, service, running }] while the in-app prompt is open
  devices: [], // { key, id, name, type, leds, zones: [{name, leds}] }
  hw: [],
  controls: [],
  log: [],
};
let win;
// A hidden window gets nothing: it would only redraw for nobody. showWindow() sends the latest state.
function push() { if (win && !win.isDestroyed() && win.isVisible()) win.webContents.send('state', state); updateTray(); }
// The installed app has no console, so the log also goes to %APPDATA%\KelvinRGB\log.txt (reset each launch).
const logFile = path.join(app.getPath('userData'), 'log.txt');
try { fs.writeFileSync(logFile, ''); } catch {}
function log(msg) {
  const line = `${new Date().toLocaleTimeString()} ${msg}`;
  state.log = [...state.log.slice(-49), line];
  console.log(msg);
  fs.appendFile(logFile, line + '\n', () => {});
}

// ---------- lighting ----------
let client = null;
let renderTimer = null;
const identify = new Map(); // device key -> until (ms)

function findOpenRgb() { return OPENRGB_EXE.find((p) => fs.existsSync(p)); }

let launchedOpenRgb = false;
let started = false; // set once the startup conflict prompt is answered
async function connectOpenRgb() {
  if (client || state.guard || !started) return;
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
  // A rescan (ours or OpenRGB's) renumbers devices; stale ids would paint the wrong device.
  c.on('deviceListUpdated', () => loadDevices().catch((e) => log(`reload devices: ${e.message}`)));
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
    // Per-zone colour overrides paint that zone's LEDs a fixed colour instead of the effect.
    if (dev.zones && !flashing) {
      let start = 0;
      d.zones.forEach((z, zi) => {
        const hex = dev.zones[zi];
        if (hex) { const rgb = M.hexToRgb(hex); for (let i = start; i < start + z.leds && i < colors.length; i++) colors[i] = M.tune(rgb, dev, bright); }
        start += z.leds;
      });
    }
    // Wraith Prism fan blade: only its blue input works (red + green stay on as warm yellow), so blue sets yellow..white.
    // Measured 2026-11-20: visible from ~192, midpoint ~224, white from ~240. See HANDOFF.
    if (d.name === 'AMD Wraith Prism' && !flashing && colors[1]) colors[1] = { red: 255, green: 255, blue: L.on ? (dev.fanWhite ?? 240) : 0 };
    try { client.updateLeds(d.id, colors); } catch (e) { log(`updateLeds ${d.name}: ${e.message}`); }
  }
  for (const [k, until] of identify) if (until <= now) { identify.delete(k); startRender(); }
}

// ---------- sensors + fans ----------
let sidecar = null;
let sidecarStopping = false;
// Packaged builds ship the sidecar under resources/ (an exe can't run from inside app.asar).
const SIDECAR = path.join(app.isPackaged ? process.resourcesPath : __dirname, 'sidecar', 'sidecar.exe');

function startSidecar() {
  if (sidecar || state.guard || !started) return;
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
  execFile(SYS('tasklist.exe'), ['/FO', 'CSV', '/NH'], { windowsHide: true }, async (err, out) => {
    if (err) return;
    const names = out.toLowerCase();
    const active = GUARD_PROCS.some((p) => names.includes(`"${p}"`));
    if (active) firstCheckDone(); else handleConflicts(out); // never prompt or kill while the game runs
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

// ---------- conflicting RGB apps (like SignalRGB's ConflictMitigator) ----------
const declined = new Set(); // names left running after "Continue" this session
let lastProcs = [];
let firstCheckDone;
const firstCheck = new Promise((r) => { firstCheckDone = r; });
function notify(body) {
  log(`conflicts: ${body}`);
  if (!Notification.isSupported()) return log('conflicts: notifications not supported');
  const n = new Notification({ title: 'KelvinRGB', body, silent: true }); // no Windows chime: the row turning green is the feedback
  n.on('failed', (_e, err) => log(`conflicts: toast failed: ${err}`));
  n.show();
}
// Shows conflicting apps in the window (red = running, green = closed). Hardware waits for "Continue" at startup.
function handleConflicts(tasklistCsv) {
  lastProcs = C.parse(tasklistCsv);
  if (state.conflicts) {
    const running = new Set(lastProcs.map((p) => p.name.toLowerCase()));
    let changed = false;
    for (const c of state.conflicts) {
      const r = running.has(c.name.toLowerCase());
      if (r !== c.running) { c.running = r; changed = true; }
    }
    if (changed) push();
    return;
  }
  if (settings.closeConflicts === false) return firstCheckDone();
  const names = [...new Set([...C.toClose(lastProcs).map((p) => p.name), ...C.toWarn(lastProcs)])].filter((n) => !declined.has(n.toLowerCase()));
  if (!names.length) return firstCheckDone();
  state.conflicts = names.map((n) => ({ name: n, label: C.label(n), note: C.WARN[n] || n, closable: C.closable(n), service: !!C.service(n), running: true }));
  if (win && !win.isVisible()) showWindow(); // the prompt needs a visible window (hidden ones get no state)
  push();
}
function stopConflictService(name) {
  const svc = C.service(name);
  execFile(SYS('sc.exe'), ['stop', svc], { windowsHide: true }, (err, stdout) => {
    if (err && !/1062/.test(stdout)) { // 1062 = already stopped
      log(`conflicts: sc stop ${svc} failed: ${stdout.trim() || err.message}`);
      const c = state.conflicts?.find((x) => x.name === name);
      if (c) { c.note = 'Could not stop the service. KelvinRGB needs to run as admin.'; c.service = false; push(); }
    } else notify(`KelvinRGB stopped ${svc} until the next restart.`);
    setTimeout(checkGuard, 1500); // the service process takes a moment to exit
  });
}
function closeConflict(name) {
  if (state.guard) return;
  if (C.service(name)) return stopConflictService(name);
  if (!C.closable(name)) return; // only the known list, never SignalRGB / OpenRGB / services
  const pids = lastProcs.filter((p) => p.name.toLowerCase() === name.toLowerCase()).map((p) => String(p.pid));
  if (!pids.length) return checkGuard();
  execFile(SYS('taskkill.exe'), ['/F', '/T', ...pids.flatMap((p) => ['/PID', p])], { windowsHide: true }, (err, stdout, stderr) => {
    if (err && !/SUCCESS/i.test(stdout)) log(`conflicts: taskkill ${name} failed: ${(stderr || err.message).trim()}`);
    else notify(C.message([name]));
    checkGuard(); // re-read the process list now so the row turns green without waiting for the poll
  });
}
function finishConflicts() {
  if (!state.conflicts) return;
  const left = state.conflicts.filter((c) => c.running).map((c) => c.name);
  left.forEach((n) => declined.add(n.toLowerCase()));
  if (left.length) log(`conflicts: left running ${left.join(', ')}`);
  state.conflicts = null;
  push();
  firstCheckDone();
}

// ---------- IPC ----------
// Main runs elevated, so every message is checked: it must come from our own page, and its data goes through lib/validate.
const PAGE = new URL('file:///' + path.join(__dirname, 'renderer', 'index.html').replace(/\\/g, '/')).href.toLowerCase();
const ours = (e) => !!win && e.sender === win.webContents && (e.senderFrame?.url || '').split('#')[0].toLowerCase() === PAGE;
const on = (ch, fn) => ipcMain.on(ch, (e, ...a) => { if (ours(e)) fn(...a); else log(`ipc: dropped ${ch}`); });
const hasDevice = (k) => state.devices.some((d) => d.key === k);
const hasFan = (id) => state.controls.some((c) => c.id === id);
ipcMain.handle('get', (e) => (ours(e) ? { settings, state, floor: FLOOR } : null));
on('lighting', (patch) => { const p = V.lighting(patch); if (!p) return; Object.assign(settings.lighting, p); save(); startRender(); updateTray(); });
on('device', (key, patch) => {
  const p = V.device(patch); if (!p || !hasDevice(key)) return;
  const cur = settings.devices[key] || {};
  if (p.zones) { p.zones = { ...cur.zones, ...p.zones }; for (const z in p.zones) if (!p.zones[z]) delete p.zones[z]; }
  settings.devices[key] = { ...cur, ...p }; save(); render();
});
on('identify', (key) => { if (hasDevice(key)) { identify.set(key, Date.now() + 2000); startRender(); } });
on('fan', (id, cfg) => { const f = V.fan(cfg, FLOOR); if (f && hasFan(id)) { settings.fans[id] = f; save(); driveFans(); } });
on('closeConflicts', (v) => { settings.closeConflicts = v === true; save(); declined.clear(); log(`conflicts: check ${settings.closeConflicts ? 'on' : 'off'}`); });
on('conflictClose', (name) => { if (state.conflicts?.some((c) => c.name === name)) closeConflict(name); });
on('conflictDone', finishConflicts);
on('rescan', () => { if (client) { client.requestRescan(); setTimeout(() => loadDevices().catch((e) => log(e.message)), 3000); } });
on('glass', (v) => { settings.glass = v === true; save(); applyGlass(); });
on('openLog', () => shell.openPath(logFile)); // fixed path, nothing taken from the renderer
on('quit', () => app.quit());
on('autostart', (v) => setAutostart(v === true));
on('update', (a) => { if (a === 'check') updater.check(true); else if (a === 'install') updater.install(); else if (a === 'releases') shell.openExternal(U.RELEASES); });

// ---------- updates ----------
const updater = U.create({
  version: app.getVersion(), log, packaged: app.isPackaged,
  onChange: () => { state.update = { ...updater.view(), kind: updater.state.kind }; push(); updateTray(true); },
  beforeInstall: async () => { quitting = true; clearInterval(renderTimer); await stopSidecar(); if (client) client.disconnect(); },
  spawn: (file, args) => spawn(file, args, { detached: true, stdio: 'ignore' }).unref(),
  quit: () => app.quit(),
});
state.update = { ...updater.view(), kind: 'idle' };
function updateItem() { const v = updater.view(); return { label: v.text, enabled: !!v.action, click: () => (v.action === 'install' ? updater.install() : updater.check(true)) }; }

// ---------- start with Windows ----------
// A scheduled task at logon with highest privileges, so there is no admin prompt every login.
// Installed build only: an elevated task must never point at an exe in a user-writable folder (dev runs from Documents).
const TASK = 'KelvinRGB';
const autostartSupported = () => app.isPackaged && process.execPath.toLowerCase().startsWith((process.env.ProgramFiles || 'C:\\Program Files').toLowerCase() + '\\');
function readAutostart() {
  state.autostart = { supported: autostartSupported(), on: false };
  if (!state.autostart.supported) return;
  execFile(SYS('schtasks.exe'), ['/Query', '/TN', TASK], { windowsHide: true }, (err) => { state.autostart.on = !err; push(); updateTray(true); });
}
function setAutostart(on) {
  if (!autostartSupported()) return;
  const args = on ? ['/Create', '/TN', TASK, '/TR', `"${process.execPath}" --hidden`, '/SC', 'ONLOGON', '/RL', 'HIGHEST', '/F'] : ['/Delete', '/TN', TASK, '/F'];
  execFile(SYS('schtasks.exe'), args, { windowsHide: true }, (err, _out, se) => {
    if (err) log(`autostart: ${(se || err.message).trim()}`); else log(`autostart: ${on ? 'on' : 'off'}`);
    readAutostart();
  });
}
function applyGlass() { if (win && process.platform === 'win32') win.setBackgroundMaterial(settings.glass ? 'acrylic' : 'none'); }

// ---------- tray helper: status at a glance, click opens the app, right click for quick settings ----------
const ICON = path.join(__dirname, 'renderer', 'icon.png');
const ICO = path.join(__dirname, 'renderer', 'icon.ico');
let tray = null;
let trayKey = '', trayStatus = '', trayAt = 0;
const EFFECT_NAMES = { static: 'Static', breathing: 'Breathing', spectrum: 'Spectrum', wave: 'Wave', off: 'Off' };
function showWindow() { if (!win) return; win.setSkipTaskbar(false); if (win.isMinimized()) win.restore(); win.show(); win.focus(); push(); }
function hideWindow() { if (win) { win.hide(); win.setSkipTaskbar(true); } }
function temp(re, hwRe) {
  for (const h of state.hw) if (hwRe.test(h.type)) { const s = h.sensors.find((x) => x.type === 'Temperature' && re.test(x.name)) || h.sensors.find((x) => x.type === 'Temperature'); if (s) return Math.round(s.value); }
  return null;
}
// Changes the app makes from the tray are sent to the window so its copy of settings stays in step.
function trayChange(fn) { fn(); save(); if (win && !win.isDestroyed()) win.webContents.send('settings', settings); updateTray(true); }
function updateTray(force) {
  if (!tray) return;
  const L = settings.lighting, cpu = temp(/Tctl|Package|Tdie/, /^Cpu$/), gpu = temp(/GPU Core|Edge/, /^Gpu/);
  const lights = state.guard ? 'paused for Apex' : L.on ? EFFECT_NAMES[L.effect] : 'off';
  const temps = [cpu != null && `CPU ${cpu} °C`, gpu != null && `GPU ${gpu} °C`].filter(Boolean).join(' · ') || 'sensors starting';
  const status = JSON.stringify([lights, state.openrgb.msg, state.sensors.msg, state.guard, settings.glass, settings.closeConflicts, L.effect, L.on]);
  tray.setToolTip(`KelvinRGB\nLights ${lights}\n${temps}`.slice(0, 127)); // cheap, every tick
  // Rebuilding the menu is not: only when status or settings change, temps at most every 10 s.
  if (!force && status === trayStatus && (temps === trayKey || Date.now() - trayAt < 10000)) return;
  trayKey = temps; trayStatus = status; trayAt = Date.now();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Lights ${lights}`, enabled: false },
    { label: temps, enabled: false },
    { label: `OpenRGB ${state.openrgb.ok ? 'connected' : state.openrgb.msg} · Sensors ${state.sensors.ok ? 'live' : state.sensors.msg}`, enabled: false },
    { type: 'separator' },
    { label: 'Open KelvinRGB', click: showWindow },
    { type: 'separator' },
    { label: 'Lights on', type: 'checkbox', checked: L.on, enabled: !state.guard, click: (m) => trayChange(() => { L.on = m.checked; startRender(); }) },
    { label: 'Effect', enabled: !state.guard, submenu: Object.entries(EFFECT_NAMES).map(([k, n]) => ({ label: n, type: 'radio', checked: L.effect === k, click: () => trayChange(() => { L.effect = k; startRender(); }) })) },
    { label: state.autostart?.supported ? 'Start with Windows' : 'Start with Windows (installed app only)', type: 'checkbox', checked: !!state.autostart?.on, enabled: !!state.autostart?.supported, click: (m) => setAutostart(m.checked) },
    { label: 'Glass background', type: 'checkbox', checked: settings.glass !== false, click: (m) => trayChange(() => { settings.glass = m.checked; applyGlass(); }) },
    { label: 'Conflict check', type: 'checkbox', checked: settings.closeConflicts !== false, click: (m) => trayChange(() => { settings.closeConflicts = m.checked; declined.clear(); }) },
    { type: 'separator' },
    updateItem(),
    { label: 'Releases on GitHub', click: () => shell.openExternal(U.RELEASES) },
    { type: 'separator' },
    { label: 'Quit KelvinRGB', click: () => app.quit() },
  ]));
}

// ---------- app ----------
// One app id in dev and installed, so Windows shows KelvinRGB's icon in the taskbar, never Electron's.
app.setAppUserModelId('com.juliangigola.kelvinrgb');
app.whenReady().then(() => {
  // Deny anything a page could ask for (camera, mic, clipboard reads, ...).
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  win = new BrowserWindow({
    width: 1360, height: 880, minWidth: 900, minHeight: 600, autoHideMenuBar: true, title: 'KelvinRGB',
    icon: ICO, show: !process.argv.includes('--hidden'),
    backgroundColor: '#00000000', backgroundMaterial: settings.glass ? 'acrylic' : 'none', // transparent so acrylic shows through
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false, spellcheck: false,
      // Screenshot mode runs behind other windows, where Chromium would otherwise stop painting.
      backgroundThrottling: !(DEV && process.env.RGB_SHOT),
    },
  });
  // The window only ever shows our own file: no navigation, no popups.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('will-redirect', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Taskbar icon and id for this window (dev runs as electron.exe, which would otherwise lend its own icon).
  if (process.platform === 'win32') win.setAppDetails({ appId: 'com.juliangigola.kelvinrgb', appIconPath: ICO, appIconIndex: 0 });
  // Close and minimize hide to the tray. Quit from the tray menu or Settings.
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); hideWindow(); } });
  win.on('minimize', (e) => { e.preventDefault(); hideWindow(); });
  tray = new Tray(ICO);
  tray.on('click', showWindow);
  readAutostart();
  updateTray(true);
  app.on('second-instance', showWindow);
  // Dev aid: RGB_SHOT=<folder> writes fans.txt and a screenshot of each page, starting at 10 s.
  if (DEV && process.env.RGB_SHOT) setTimeout(async () => {
    for (const p of ['home', 'lighting', 'devices', 'fans', 'system', 'settings']) {
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
  setTimeout(() => firstCheck.then(() => { started = true; startSidecar(); connectOpenRgb(); setInterval(connectOpenRgb, 3000); }), 1500);
  // Quiet update check a little after start, then every 6 hours. Nothing shows unless one is available.
  setTimeout(() => updater.check(false), 20000);
  setInterval(() => updater.check(false), 6 * 3600e3);
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
app.on('window-all-closed', () => {}); // the tray keeps KelvinRGB running
