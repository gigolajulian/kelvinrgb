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
