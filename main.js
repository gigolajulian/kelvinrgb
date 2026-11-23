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
const G = require('./lib/guard');
const U = require('./lib/update');
const D = require('./lib/drivers');

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
// --quit is for the running copy (the installer sends it): asking for the lock passes it on, then this copy exits.
if (process.argv.includes('--quit')) { app.requestSingleInstanceLock(); app.exit(0); }
else if (!isAdmin() && !(DEV && process.env.RGB_NO_ELEVATE)) {
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
  devices: {}, // key -> { off, brightness, gain: [r,g,b], gamma, fanWhite, zones }
  fans: {},    // control id -> { mode: bios|curve|fixed, sensor, points, shape, fixed }
  closeConflicts: true, // show the conflict list when RGB apps that fight us run (lib/conflicts.js)
  glass: true, // Windows 11 acrylic behind the window
  splash: true, // start-up splash (renderer/splash.html)
  setupSeen: false, // the first-run Setup sheet was shown once
};
let settings = structuredClone(DEFAULTS);
try { settings = V.settings(JSON.parse(fs.readFileSync(settingsFile, 'utf8').replace(/^﻿/, '')), DEFAULTS, FLOOR); } catch (e) { console.log(`settings: ${e.message}`); }
let saveTimer;
const writeSettings = () => { saveTimer = null; fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2)); };
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeSettings, 300);
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
  if (client || state.guard || !started || driversBusy === 'openrgb') return; // not while its installer runs
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
    key: `${d.name}|${d.location}`, id: d.deviceId, name: d.name, type: d.type, firmware: String(d.version || '').trim(),
    leds: d.colors.length, zones: d.zones.map((z) => ({ name: z.name, leds: z.ledsCount })),
  }));
  for (const d of state.devices) if (d.leds) client.setCustomMode(d.id);
  state.openrgb = { ok: true, msg: `${state.devices.length} devices` };
  stepSplash(3);
  log(`OpenRGB: ${state.devices.map((d) => d.name).join(', ')}`);
  push();
  startRender();
  stepSplash(4); // lighting painted
}

function startRender() {
  clearInterval(renderTimer);
  const animated = ['breathing', 'spectrum', 'wave'].includes(settings.lighting.effect) || identify.size;
  renderTimer = setInterval(render, animated ? 33 : 1000); // static repaints once a second in case a device drifts
  render();
}

// effect: override for one frame ('static' paints the resting state on quit or before Apex, #25).
function render(effect) {
  if (!client || (state.guard && !effect)) return; // the guard paints one resting frame before letting go
  const L = settings.lighting;
  const fx = effect || L.effect;
  const base = M.hexToRgb(L.color);
  const t = Date.now() / 1000;
  const now = Date.now();
  for (const d of state.devices) {
    if (!d.leds) continue;
    const dev = settings.devices[d.key] || {};
    const bright = (L.on && !dev.off ? L.brightness / 100 : 0) * ((dev.brightness ?? 100) / 100);
    const flashing = (identify.get(d.key) || 0) > now;
    const colors = [];
    for (let i = 0; i < d.leds; i++) {
      const c = flashing ? (Math.floor(now / 250) % 2 ? { red: 255, green: 255, blue: 255 } : { red: 0, green: 0, blue: 0 })
        : M.frame(fx, base, t, L.speed, i, d.leds);
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
    if (d.name === 'AMD Wraith Prism' && !flashing && colors[1]) colors[1] = { red: 255, green: 255, blue: L.on && !dev.off ? (dev.fanWhite ?? 240) : 0 };
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
  if (!fs.existsSync(path.join(path.dirname(SIDECAR), 'lib', 'LibreHardwareMonitorLib.dll'))) { state.sensors = { ...state.sensors, ok: false, msg: 'sensor files missing, reinstall KelvinRGB' }; push(); return; }
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
    stepSplash(2);
    log(`sidecar ready:${m.controls} fan controls, admin ${m.admin}`);
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
      log('apex guard: game running, releasing fans and lighting, stopping OpenRGB');
      endSplash(); // sensors and lighting wait for the game, so don't hold the splash for them
      state.openrgb = { ok: false, msg: 'paused for apex' };
      state.sensors = { ...state.sensors, ok: false, msg: 'paused for apex' };
      push();
      await G.enter({
        stopRender: () => { clearInterval(renderTimer); identify.clear(); render('static'); }, // hold a calm colour, not a frozen frame
        stopSidecar,
        disconnect: () => { if (client) { client.removeAllListeners('disconnect'); client.disconnect(); client = null; } },
        wait: (ms) => new Promise((r) => setTimeout(r, ms)),
        killOpenRgb: () => new Promise((r) => {
          if (!names.includes('"openrgb.exe"')) return r();
          if (!launchedOpenRgb) log('apex guard: OpenRGB was already running before KelvinRGB, stopping it anyway');
          execFile(SYS('taskkill.exe'), ['/F', '/T', '/IM', 'OpenRGB.exe'], { windowsHide: true }, (e) => {
            log(e ? `apex guard: could not stop OpenRGB: ${e.message.trim()}` : 'apex guard: OpenRGB server stopped');
            r();
          });
        }),
      });
    } else {
      log('apex guard: game closed, restarting OpenRGB and resuming');
      G.leave({ startSidecar, allowRelaunch: () => { launchedOpenRgb = false; }, connect: connectOpenRgb });
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
on('splash', (v) => { settings.splash = v === true; save(); });
on('openLog', () => shell.openPath(logFile)); // fixed path, nothing taken from the renderer
on('quit', () => app.quit());
on('autostart', (v) => setAutostart(v === true));
on('update', (a) => { if (a === 'check') updater.check(true); else if (a === 'install') updater.install(); else if (a === 'releases') shell.openExternal(U.RELEASES); else if (a === 'openrgb') shell.openExternal('https://openrgb.org'); });
on('setupSeen', () => { settings.setupSeen = true; save(); });
on('drivers', (a) => {
  if (a === 'check') return checkDrivers();
  if (a === 'openrgb-page') return shell.openExternal(D.OPENRGB.page);
  if (a === 'pawnio-page') return shell.openExternal('https://github.com/namazso/PawnIO.Setup/releases');
  if (state.guard || driversBusy) return; // nothing installs while Apex or EAC runs
  if (a === 'openrgb') return installOpenRgb();
  if (a === 'pawnio') return installPawnio();
  const row = state.drivers.windows.find((w) => w.id === a);
  if (row) shell.openExternal(row.url); // catalog URLs only, never one from the renderer
});
on('setup', (a) => {
  if (state.guard || setupBusy) return; // nothing installs while Apex or EAC runs
  if (a === 'recheck') return checkSetup();
  if (a === 'openrgb') return installOpenRgb();
  if (a === 'pawnio') installPawnio();
});
function installPawnio() {
  if (state.guard || setupBusy || driversBusy) return;
  if (!fs.existsSync(PAWNIO_SETUP)) return shell.openExternal('https://pawnio.eu');
  setupBusy = 'pawnio'; checkSetup();
  execFile(PAWNIO_SETUP, ['-install'], (e) => {
    log(e ? `setup: PawnIO installer: ${e.message.trim()}` : 'setup: PawnIO installer finished');
    setupBusy = '';
    checkSetup(() => { if (pawnio) stopSidecar().then(startSidecar); }); // the sidecar only finds fan headers once the driver runs
    if (state.drivers.at) checkDrivers();
  });
}
state.version = app.getVersion();

// ---------- setup ----------
// The bundled PawnIO installer sits under resources/, admin-owned, like the sidecar. Without it, Install opens the download page.
const PAWNIO_SETUP = path.join(app.isPackaged ? process.resourcesPath : __dirname, 'setup', 'PawnIO_setup.exe');
let pawnio = false, setupBusy = '';
function checkSetup(then) {
  execFile(SYS('sc.exe'), ['query', 'PawnIO'], { windowsHide: true }, (e, out) => {
    pawnio = !e && /RUNNING/.test(out);
    state.setup = { openrgb: !!findOpenRgb(), pawnio, busy: setupBusy, bundled: fs.existsSync(PAWNIO_SETUP) };
    push();
    if (then) then();
  });
}
checkSetup();

// ---------- drivers page ----------
// One PowerShell call: every signed driver, devices with no driver (code 28) and the Uninstall entries. Takes a few
// seconds, so it runs when the Drivers page opens and on Check now, never on the tick. LHM's path comes in by env.
const DRIVER_QUERY = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$d=@(Get-CimInstance Win32_PnPSignedDriver | ?{$_.DeviceID} | %{@{id=$_.DeviceID;name=$_.DeviceName;cls=[string]$_.DeviceClass;prov=[string]$_.DriverProviderName;ver=[string]$_.DriverVersion;err=0}})",
  "$d+=@(Get-CimInstance Win32_PnPEntity -Filter 'ConfigManagerErrorCode=28' | %{@{id=$_.DeviceID;name=$_.Name;cls=[string]$_.PNPClass;prov='';ver='';err=28}})",
  "$p=@(Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' | ?{$_.DisplayName} | %{@{name=[string]$_.DisplayName;ver=[string]$_.DisplayVersion}})",
  "@{devices=$d;packages=$p;lhm=[string](Get-Item -LiteralPath $env:KRGB_LHM).VersionInfo.FileVersion} | ConvertTo-Json -Depth 3 -Compress",
].join(';');
const PAWNIO_V = '2.2.0'; // the bundled installer, pinned in scripts/fetch-pawnio.js
let driversBusy = '';
state.drivers = { checking: false, at: 0, windows: [], openrgb: {}, pawnio: {}, lhm: '', busy: '', msg: '' };
async function latestTag(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'KelvinRGB', Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    return r.ok ? String((await r.json()).tag_name || '') : '';
  } catch { return ''; }
}
// installed, latest, and what KelvinRGB can do about it: install (missing), update (older), page (newer than our pin).
function drv(installed, latest, pinned) {
  const older = !!installed && !!latest && D.cmp(latest, installed) > 0;
  const beyond = !!latest && (!pinned || D.cmp(latest, pinned) > 0);
  return { installed, latest, pinned, tone: D.tone({ installed, latest }), act: !installed ? (pinned && !beyond ? 'install' : 'page') : older ? (beyond ? 'page' : 'update') : '' };
}
// Driver updates Windows Update offers for this PC: the one official "latest" for makers' drivers. About 15 s.
// Resolves null when the search fails, so rows say "not checked" instead of a false green.
const WU_QUERY = "$r=(New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher().Search(\"IsInstalled=0 and Type='Driver'\"); ConvertTo-Json -Compress -InputObject @($r.Updates | %{@{provider=[string]$_.DriverProvider;model=[string]$_.DriverModel;title=[string]$_.Title}})";
function wuDrivers() {
  return new Promise((res) => execFile(SYS('WindowsPowerShell\\v1.0\\powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', WU_QUERY], { windowsHide: true, timeout: 90000 }, (e, out) => {
    if (e) { log(`drivers: Windows Update search failed: ${e.message.trim()}`); return res(null); }
    try { const j = JSON.parse(out || '[]'); res(Array.isArray(j) ? j : [j]); } catch { res(null); }
  }));
}
function checkDrivers() {
  if (state.drivers.checking) return;
  state.drivers = { ...state.drivers, checking: true, msg: driversBusy ? state.drivers.msg : '' }; push();
  updater.check(true);
  const env = { ...process.env, KRGB_LHM: path.join(path.dirname(SIDECAR), 'lib', 'LibreHardwareMonitorLib.dll') };
  execFile(SYS('WindowsPowerShell\\v1.0\\powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', DRIVER_QUERY], { windowsHide: true, env, maxBuffer: 32 * 1024 * 1024, timeout: 60000 }, async (e, out) => {
    let raw = { devices: [], packages: [] };
    if (e) log(`drivers: query failed: ${e.message.trim()}`);
    else try { raw = JSON.parse(out); } catch (x) { log(`drivers: ${x.message}`); }
    const [orgb, pawn, wu] = await Promise.all([latestTag(D.OPENRGB.api), latestTag('https://api.github.com/repos/namazso/PawnIO.Setup/releases/latest'), wuDrivers()]);
    state.drivers = {
      ...state.drivers, checking: false, at: Date.now(), windows: D.windowsRows(raw, wu), lhm: raw.lhm || '',
      openrgb: drv(D.pkgVer(raw, /^OpenRGB$/i), orgb, D.OPENRGB.v),
      pawnio: drv(D.pkgVer(raw, /^PawnIO$/i), pawn, fs.existsSync(PAWNIO_SETUP) ? PAWNIO_V : ''),
    };
    push();
  });
}
// OpenRGB from its pinned MSI. The server holds OpenRGB.exe, so it stops first; the connect loop starts the new one.
async function installOpenRgb() {
  if (state.guard || driversBusy || setupBusy) return;
  const o = state.drivers.openrgb;
  if (o.latest && D.cmp(o.latest, D.OPENRGB.v) > 0) return shell.openExternal(D.OPENRGB.page); // newer than we can verify
  if (o.installed && D.cmp(o.installed, D.OPENRGB.v) >= 0) return; // never downgrade
  driversBusy = 'openrgb'; state.drivers = { ...state.drivers, busy: 'openrgb', msg: '' }; push();
  try {
    await D.installPinned(D.OPENRGB, (file) => new Promise((res, rej) => {
      execFile(SYS('msiexec.exe'), ['/i', file, '/qn', '/norestart'], { windowsHide: true }, (e) => (!e || e.code === 3010 || e.code === 1641 ? res() : rej(new Error(`installer exit ${e.code}`))));
    }), {
      fetch, guard: () => !!state.guard, log,
      tempDir: path.join(process.env.SystemRoot || 'C:\\Windows', 'Temp'), // admin-owned
      write: (f, b) => fs.writeFileSync(f, b, { flag: 'wx' }),
      remove: (f) => fs.unlinkSync(f),
      before: () => new Promise((r) => {
        clearInterval(renderTimer);
        state.openrgb = { ok: false, msg: 'updating openrgb' }; push();
        if (client) { client.removeAllListeners('disconnect'); client.disconnect(); client = null; }
        execFile(SYS('taskkill.exe'), ['/F', '/T', '/IM', 'OpenRGB.exe'], { windowsHide: true }, () => r());
      }),
      after: async () => { launchedOpenRgb = false; },
    });
    log(`drivers: OpenRGB ${D.OPENRGB.v} installed, installer deleted`);
  } catch (e) {
    log(`drivers: OpenRGB install: ${e.message}`);
    state.drivers = { ...state.drivers, msg: `OpenRGB: ${e.message}` };
  }
  driversBusy = ''; state.drivers = { ...state.drivers, busy: '' };
  checkSetup(); checkDrivers();
}

// ---------- updates ----------
const updater = U.create({
  version: app.getVersion(), log, packaged: app.isPackaged,
  onChange: () => { state.update = { ...updater.view(), kind: updater.state.kind, v: updater.state.v }; push(); updateTray(true); },
  beforeInstall: async () => { quitting = true; await restLights(); await stopSidecar(); },
  spawn: (file, args) => spawn(file, args, { detached: true, stdio: 'ignore' }).unref(),
  quit: () => app.quit(),
});
state.update = { ...updater.view(), kind: 'idle' };
if (app.isPackaged) U.sweep(path.join(process.env.SystemRoot || 'C:\\Windows', 'Temp')); // installers left from the last update
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
function showWindow() { if (!win) return; if (splash) return endSplash();win.setSkipTaskbar(false); if (win.isMinimized()) win.restore(); win.show(); win.focus(); push(); }
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

// ---------- splash (D: logo ring + steps) ----------
// A small glass tile centred where the window will open. The logo's own ring fills as start-up steps finish
// (Game check: Apex or EAC, sensors, OpenRGB, lighting), each row ticks off with its time, then the tile fades and the window shows.
const SPLASH_W = 340, SPLASH_H = 440;
let splash = null, splashStep = 0, splashAt = 0, splashEnding = false, splashTicking = false;
const splashDone = new Map(); // point (1..4) -> when it finished
const SPLASH_POINTS = ['game check', 'sensors', 'openrgb', 'lighting'];
function openSplash() {
  const b = win.getBounds();
  splash = new BrowserWindow({
    x: Math.round(b.x + (b.width - SPLASH_W) / 2), y: Math.round(b.y + (b.height - SPLASH_H) / 2), width: SPLASH_W, height: SPLASH_H, transparent: true, frame: false, resizable: false, movable: false, skipTaskbar: true, alwaysOnTop: true,
    focusable: false, hasShadow: false, show: false, backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  splash.setIgnoreMouseEvents(true);
  splash.webContents.on('will-navigate', (e) => e.preventDefault());
  splash.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  splash.loadFile(path.join(__dirname, 'renderer', 'splash.html'));
  splash.once('ready-to-show', () => splash && splash.showInactive());
  splashAt = Date.now();
  setTimeout(endSplash, 15000); // a point that never finishes (no OpenRGB, no admin) shows as skipped
}
function stepSplash(i) {
  if (!splash || splashEnding || splashDone.has(i)) return;
  splashDone.set(i, Date.now());
  log(`splash: ${SPLASH_POINTS[i - 1]} done at ${((Date.now() - splashAt) / 1000).toFixed(1)}s`);
  advanceSplash();
}
// Points tick strictly in order, one at a time so each is seen. One that finished early (OpenRGB is often ready
// before the sensors) waits for the ones before it. The window opens only after the 4th.
function advanceSplash() {
  if (splashTicking || !splash || splashEnding || !splashDone.has(splashStep + 1)) return;
  splashTicking = true;
  const i = ++splashStep, secs = (Math.max(0, splashDone.get(i) - (splashDone.get(i - 1) ?? splashAt)) / 1000).toFixed(1);
  splash.webContents.executeJavaScript(`step(${i}, ${JSON.stringify(secs)})`).catch(() => {});
  setTimeout(() => { splashTicking = false; if (splashStep >= 4) endSplash(); else advanceSplash(); }, 300);
}
function endSplash() {
  if (!splash || splashEnding) return;
  splashEnding = true;
  log(`splash: closing at ${((Date.now() - splashAt) / 1000).toFixed(1)}s, ${splashStep} of 4 points ticked`);
  const wait = Math.max(0, 1600 - (Date.now() - splashAt)); // long enough to read the steps, not a flicker
  setTimeout(() => {
    splash.webContents.executeJavaScript(`done(${splashStep})`).catch(() => {}); // points after splashStep show as skipped
    // the ring is full and the tile fades: show the real window, drop the splash just after
    setTimeout(() => { const s = splash; splash = null; showWindow(); setTimeout(() => s.destroy(), 200); }, splashStep >= 4 ? 450 : 1650);
  }, wait);
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
    icon: ICO, show: false,
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
  // Hidden start (logon task) shows nothing; otherwise the splash, or the window straight away.
  if (!process.argv.includes('--hidden')) { if (settings.splash !== false) openSplash(); else win.once('ready-to-show', showWindow); }
  firstCheck.then(() => stepSplash(1));
  tray = new Tray(ICO);
  tray.on('click', showWindow);
  readAutostart();
  updateTray(true);
  // A second launch shows the window; the installer's `KelvinRGB.exe --quit` closes this copy cleanly before an update.
  app.on('second-instance', (_e, argv) => (argv.includes('--quit') ? app.quit() : showWindow()));
  // Dev aid: RGB_SHOT=<folder> writes fans.txt and a screenshot of each page, starting at 10 s.
  if (DEV && process.env.RGB_SHOT) setTimeout(async () => {
    for (const p of ['home', 'lighting', 'drivers', 'fans', 'system', 'settings']) {
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

// Stop the effect on a resting frame (the chosen colour, static; black if lights are off), then let go of OpenRGB (#25).
async function restLights() {
  clearInterval(renderTimer);
  identify.clear();
  if (!client) return;
  try { render('static'); } catch (e) { log(`rest: ${e.message}`); }
  await new Promise((r) => setTimeout(r, 150)); // let the server apply it before the socket closes
  try { client.removeAllListeners('disconnect'); client.disconnect(); } catch {}
  client = null;
}

let quitting = false;
app.on('before-quit', async (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  setTimeout(() => app.exit(0), 8000); // a stuck step must never leave a windowless copy running (#23)
  try { if (saveTimer) { clearTimeout(saveTimer); writeSettings(); } await restLights(); await stopSidecar(); } catch (x) { log(`quit: ${x.message}`); }
  app.exit(0);
});
app.on('window-all-closed', () => {}); // the tray keeps KelvinRGB running
