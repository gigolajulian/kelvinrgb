const test = require('node:test');
const assert = require('node:assert');
const V = require('../lib/validate');

test('lighting keeps only known keys and types', () => {
  assert.deepStrictEqual(V.lighting({ effect: 'wave', color: '#ABCDEF', speed: 500, on: 'yes', evil: 1 }), { effect: 'wave', color: '#abcdef', speed: 100 });
  assert.deepStrictEqual(V.lighting({ effect: 'rm -rf', color: 'red', brightness: NaN }), {});
  assert.strictEqual(V.lighting(null), null);
});

test('fan rejects NaN points and clamps to the floor', () => {
  const f = V.fan({ mode: 'curve', points: [[30, 5], [NaN, 50], [90, 100], 'x'], fixed: 3 }, 25);
  assert.deepStrictEqual(f.points, [[30, 25], [90, 100]]);
  assert.strictEqual(f.fixed, 25);
  assert.strictEqual(V.fan({ mode: 'curve', points: [[30, 30]] }, 25), null);
  assert.strictEqual(V.fan({ mode: 'turbo' }, 25), null);
});

test('device zones accept hex or null only', () => {
  assert.deepStrictEqual(V.device({ zones: { 0: '#FF0000', 1: null, x: '#000000', 2: 'red' }, gain: [2, 0.5, 1] }), { zones: { 0: '#ff0000', 1: null }, gain: [1, 0.5, 1] });
});

test('settings from disk fall back to defaults', () => {
  const D = { lighting: { effect: 'static', color: '#c8323c', speed: 40, brightness: 80, on: true }, devices: {}, fans: {}, closeConflicts: true, glass: true };
  const s = V.settings({ lighting: { color: 'nope' }, fans: { a: { mode: 'x' }, b: { mode: 'fixed', fixed: 60 } }, closeConflicts: 'no' }, D, 25);
  assert.strictEqual(s.lighting.color, '#c8323c');
  assert.deepStrictEqual(Object.keys(s.fans), ['b']);
  assert.strictEqual(s.closeConflicts, true);
});

test('device off switch', () => {
  assert.deepStrictEqual(V.device({ off: true }), { off: true });
  assert.deepStrictEqual(V.device({ off: 'yes' }), {}); // only a real boolean
});

test('palette and themes (#27)', () => {
  assert.deepStrictEqual(V.lighting({ palette: ['#C8323C', '#3b4fd8'] }).palette, ['#c8323c', '#3b4fd8']);
  assert.deepStrictEqual(V.lighting({ palette: [] }).palette, []);
  assert.strictEqual(V.lighting({ palette: ['#c8323c'] }).palette, undefined);
  assert.strictEqual(V.lighting({ palette: ['#c8323c', 'red'] }).palette, undefined);
  assert.strictEqual(V.lighting({ palette: ['#111111', '#222222', '#333333', '#444444'] }).palette, undefined);
  const t = V.theme({ name: ' Ember ', lighting: { effect: 'wave', palette: ['#c8323c', '#f0a35e'], bogus: 1 }, zones: { 'dev|x': { 0: '#FFFFFF', bad: '#000000' } } });
  assert.deepStrictEqual(t, { name: 'Ember', lighting: { effect: 'wave', palette: ['#c8323c', '#f0a35e'] }, zones: { 'dev|x': { 0: '#ffffff' } } });
  assert.strictEqual(V.theme({ name: '' }), null);
  assert.strictEqual(V.theme({ name: 'x'.repeat(41) }), null);
});

test('a settings.json from the first release (0.1, no version) still opens with the user\'s choices', () => {
  // The shape main.js wrote before effect colours, themes, layout and the version field existed.
  const old = { lighting: { effect: 'breathing', color: '#3B4FD8', speed: 55, brightness: 60, on: true }, devices: { 'Corsair Vengeance:0': { brightness: 70, gain: [1, 0.9, 0.8], gamma: 2.2 } }, fans: { '/lpc/nct6798d/0/control/1': { mode: 'curve', sensor: '/amdcpu/0/temperature/2', points: [[40, 30], [80, 90]], shape: 'linear' } }, closeConflicts: false, glass: true };
  const D = { lighting: { effect: 'static', color: '#c8323c', speed: 40, brightness: 80, on: true, palette: ['#c8323c', '#3b4fd8'], across: true, dir: 'x', desk: true }, themes: [], devices: {}, layout: {}, fans: {}, closeConflicts: true, glass: true, splash: true, setupSeen: false, version: V.VERSION };
  const s = V.settings(old, D, 25);
  assert.strictEqual(s.version, V.VERSION);
  assert.deepStrictEqual(s.lighting, { effect: 'breathing', color: '#3b4fd8', speed: 55, brightness: 60, on: true, palette: ['#c8323c', '#3b4fd8'], across: true, dir: 'x', desk: true });
  assert.deepStrictEqual(s.devices['Corsair Vengeance:0'], { brightness: 70, gain: [1, 0.9, 0.8], gamma: 2.2 });
  assert.deepStrictEqual(s.fans['/lpc/nct6798d/0/control/1'].points, [[40, 30], [80, 90]]);
  assert.strictEqual(s.closeConflicts, false);
  assert.strictEqual(s.splash, true); // new keys take their defaults
  // a file from a newer version opens too: what this version knows is kept, the rest dropped
  const newer = V.settings({ ...old, version: V.VERSION + 1, somethingNew: 1 }, D, 25);
  assert.strictEqual(newer.lighting.color, '#3b4fd8');
  assert.ok(!('somethingNew' in newer));
});
