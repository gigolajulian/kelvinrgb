const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const S = require('../lib/store');
const V = require('../lib/validate');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'krgb-store-'));

test('a crash mid-save leaves the old settings whole', () => {
  const dir = tmp(), file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{"old":true}');
  // the disk fills (or the app dies) halfway through writing the new copy
  const crashing = { ...fs, writeFileSync: (f, t) => { fs.writeFileSync(f, String(t).slice(0, 5)); throw new Error('ENOSPC'); } };
  assert.throws(() => S.writeAtomic(file, '{"new":true,"lots":"of data"}', crashing), /ENOSPC/);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{"old":true}');
  S.writeAtomic(file, '{"new":true}');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{"new":true}');
  assert.ok(!fs.existsSync(`${file}.tmp`));
});

test('a save survives a file held for a moment by antivirus', () => {
  const dir = tmp(), file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{"old":true}');
  let busy = 2;
  const held = { ...fs, renameSync: (a, b) => { if (busy-- > 0) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); return fs.renameSync(a, b); } };
  S.writeAtomic(file, '{"new":true}', held);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{"new":true}');
  const stuck = { ...fs, renameSync: () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); } };
  assert.throws(() => S.writeAtomic(file, '{"lost":true}', stuck), /EPERM/);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{"new":true}');
  assert.ok(!fs.existsSync(`${file}.tmp`));
});

test('the in-memory log keeps only the last 50 lines', () => {
  let log = [];
  for (let i = 0; i < 500; i++) log = S.ring(log, `line ${i}`, 50);
  assert.strictEqual(log.length, 50);
  assert.strictEqual(log[0], 'line 450');
  assert.strictEqual(log[49], 'line 499');
});

test('log.txt never grows past its cap', () => {
  const file = path.join(tmp(), 'log.txt');
  const line = `${'x'.repeat(99)}\n`;
  for (let i = 0; i < 1000; i++) S.appendCapped(file, line, 10000);
  const size = fs.statSync(file).size;
  assert.ok(size <= 10000 + 100, `log is ${size} bytes`);
  assert.ok(fs.readFileSync(file, 'utf8').endsWith(line));
});

const DEFAULTS = { lighting: { effect: 'static', color: '#c8323c', speed: 40, brightness: 80, on: true }, devices: {}, fans: {}, closeConflicts: true, glass: true, splash: true, setupSeen: false };
const gate = (raw) => V.settings(raw, DEFAULTS, 25);

test('a settings backup restores what was exported', () => {
  const mine = gate({ lighting: { effect: 'wave', color: '#112233', on: false }, devices: { 'ENE DRAM|i2c': { brightness: 40, zones: { 0: '#ffffff' } } }, fans: { '/lpc/0/control/1': { mode: 'curve', sensor: 'cpu', points: [[30, 30], [80, 100]] } }, glass: false });
  assert.deepStrictEqual(S.parseBackup(JSON.stringify(mine, null, 2), gate), mine);
});

test('an imported backup goes through the same gates as settings.json', () => {
  const evil = JSON.stringify({ lighting: { effect: 'static', color: 'red; rm -rf' }, fans: { x: { mode: 'fixed', fixed: 0 }, y: { mode: 'curve', points: [[30, 0], [90, 5]] } } });
  const s = S.parseBackup(evil, gate);
  assert.strictEqual(s.lighting.color, '#c8323c');
  assert.strictEqual(s.fans.x.fixed, 25); // never below the floor
  assert.ok(s.fans.y.points.every(([, d]) => d >= 25));
  assert.throws(() => S.parseBackup('not json', gate));
  assert.throws(() => S.parseBackup('{"hello":1}', gate), /not a KelvinRGB backup/);
  assert.throws(() => S.parseBackup(' '.repeat(2 * 1024 * 1024), gate), /too big/);
});

test('a pending settings save is written on quit, and a burst of changes writes once', () => {
  const dir = tmp(), file = path.join(dir, 'settings.json');
  const timers = { pending: null, setTimeout(fn) { this.pending = fn; return 1; }, clearTimeout() { this.pending = null; } };
  let settings = { color: '#000000' }, writes = 0;
  const s = S.saver(() => { writes++; S.writeAtomic(file, JSON.stringify(settings)); }, 300, timers);
  settings = { color: '#c8323c' }; s.save(); s.save(); s.save();
  assert.strictEqual(writes, 0); // still waiting out the burst
  s.flush(); // quit before the 300 ms ran out
  assert.strictEqual(writes, 1);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { color: '#c8323c' }); // what the next start reads
  s.flush();
  assert.strictEqual(writes, 1); // nothing pending, nothing written
  s.save(); timers.pending();
  assert.strictEqual(writes, 2); // the timer path writes too
});

test('an uncaught error in the main process reaches the log', async () => {
  const proc = new (require('node:events'))(), lines = [];
  S.catchCrashes(proc, (m) => lines.push(m));
  proc.emit('uncaughtException', new Error('device list went away'));
  proc.emit('unhandledRejection', new Error('sidecar pipe closed'));
  assert.match(lines[0], /^crash: Error: device list went away\n\s+at /);
  assert.match(lines[1], /^crash \(promise\): Error: sidecar pipe closed/);
});

test('paths: the page URL matches what Chromium reports for odd install folders', () => {
  const { pathToFileURL } = require('node:url');
  const dirs = ['C:\Program Files\KelvinRGB', 'C:\Users\Jülian Ğ\AppData\Local\Programs\KelvinRGB', 'D:\Apps\C# tools\KelvinRGB', `C:\${'long folder name '.repeat(20)}\KelvinRGB`];
  for (const d of dirs) {
    const file = path.win32.join(d, 'resources', 'app.asar', 'renderer', 'index.html');
    // Electron's loadFile escapes # and ?, and Chromium percent-encodes spaces and non-ASCII: the same as pathToFileURL
    assert.strictEqual(S.pageUrl(file), pathToFileURL(file).href.toLowerCase(), d);
  }
});

test('paths: saves, logs and the installer sweep work in folders with spaces, non-ASCII and over 260 characters', () => {
  const U = require('../lib/update');
  let dir = path.join(tmp(), 'Jülian Ğ space');
  while (dir.length < 300) dir = path.join(dir, 'a long folder name');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'settings.json');
  S.writeAtomic(file, '{"ok":true}');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{"ok":true}');
  S.appendCapped(path.join(dir, 'log.txt'), 'line\n', 1024);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'log.txt'), 'utf8'), 'line\n');
  fs.writeFileSync(path.join(dir, `KelvinRGB-${require('node:crypto').randomUUID()}.exe`), 'x');
  assert.strictEqual(U.sweep(dir), 1);
});

// DATA-1 restore drill: export, lose settings.json, import, and the next start reads back the same settings.
// Same steps as main.js: writeSettings/export use writeAtomic, import uses parseBackup, start-up re-reads through the gate.
test('restore drill: export, wipe settings.json, import, the next start has the same settings', () => {
  const dir = tmp(), file = path.join(dir, 'settings.json'), backup = path.join(dir, 'KelvinRGB settings.json');
  const defaults = { ...DEFAULTS, lighting: { ...DEFAULTS.lighting, palette: ['#c8323c', '#3b4fd8'], across: true, dir: 'x', desk: true }, themes: [{ name: 'Ember', lighting: { effect: 'spectrum' }, zones: {} }], layout: {}, version: V.VERSION };
  const start = (text) => V.settings(JSON.parse(text), defaults, 25); // main.js start-up read
  const mine = start(JSON.stringify({
    lighting: { effect: 'wave', color: '#112233', speed: 70, brightness: 55, on: true, palette: ['#ff0000', '#00ff00', '#0000ff'], across: false, dir: 'r', desk: false },
    themes: [{ name: 'Night', lighting: { effect: 'breathing', color: '#4fc1c6' }, zones: { 'NZXT|hid': { 0: '#ffffff' } } }],
    devices: { 'ENE DRAM|i2c': { off: false, brightness: 40, gamma: 2.2, fanWhite: 200, gain: [1, 0.8, 0.6], label: 'RAM', zones: { 0: '#ffffff', 3: '#000000' } } },
    layout: { 'ENE DRAM|i2c': [120, 300] },
    fans: { '/lpc/0/control/1': { mode: 'curve', sensor: 'cpu', shape: 'linear', points: [[30, 30], [80, 100]] }, '/lpc/0/control/2': { mode: 'fixed', fixed: 60 } },
    closeConflicts: false, glass: false, splash: false, setupSeen: true,
  }));
  assert.strictEqual(mine.themes[0].name, 'Night'); // the user's own values got through, not just defaults
  assert.deepStrictEqual(mine.devices['ENE DRAM|i2c'].gain, [1, 0.8, 0.6]);
  S.writeAtomic(file, JSON.stringify(mine, null, 2));
  S.writeAtomic(backup, fs.readFileSync(file, 'utf8')); // Export
  fs.rmSync(file); // settings.json lost
  assert.deepStrictEqual(start(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{}'), defaults); // a bare start: defaults only
  const back = S.parseBackup(fs.readFileSync(backup, 'utf8'), (raw) => V.settings(raw, defaults, 25)); // Import
  S.writeAtomic(file, JSON.stringify(back, null, 2));
  assert.deepStrictEqual(start(fs.readFileSync(file, 'utf8')), mine);
});
