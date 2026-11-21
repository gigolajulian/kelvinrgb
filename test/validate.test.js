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
