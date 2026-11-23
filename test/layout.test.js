const test = require('node:test');
const assert = require('node:assert');
const L = require('../lib/layout');
const V = require('../lib/validate');

// Julian's PC on 2026-11-23, as OpenRGB lists it
const devs = [
  ...[0, 1, 2, 3].map((k) => ({ key: `ram${k}`, name: 'ENE DRAM', type: 1, leds: 5, zones: [{ name: 'Unknown', leds: 5 }] })),
  { key: 'gpu', name: 'Sapphire', type: 2, leds: 1, zones: [{ name: 'GPU Zone', leds: 1 }] },
  { key: 'hue', name: 'NZXT Smart Device V2', type: 4, leds: 28, zones: [{ name: 'Hue 2 Channel 1', leds: 28 }, { name: 'Hue 2 Channel 2', leds: 0 }] },
  { key: 'prism', name: 'AMD Wraith Prism', type: 3, leds: 17, zones: [{ name: 'Logo', leds: 1 }, { name: 'Fan', leds: 1 }, { name: 'Ring', leds: 15 }] },
  { key: 'mouse', name: 'Aerox 3', type: 6, leds: 3, zones: [] },
  { key: 'mb', name: 'ASUS', type: 0, leds: 5, zones: [] },
  { key: 'empty', name: 'nothing', type: 4, leds: 0, zones: [] },
];

test('every LED gets a point, devices without LEDs are left out', () => {
  const p = L.place(devs);
  assert.strictEqual(p.length, devs.length - 1);
  for (const d of p) assert.strictEqual(d.pts.length, devs.find((x) => x.key === d.key).leds);
  for (const d of p) for (const [x, y] of d.pts) assert.ok(x >= 0 && x <= L.W && y >= 0 && y <= L.H);
});

test('RAM sticks sit side by side, the mouse on the desk, the Prism logo and fan in its middle', () => {
  const p = Object.fromEntries(L.place(devs).map((d) => [d.key, d]));
  assert.ok(p.ram1.x > p.ram0.x && p.ram2.x > p.ram1.x);
  assert.ok(p.mouse.desk && p.mouse.x >= L.DESK_X);
  const mid = [p.prism.x + 60, p.prism.y + 60];
  assert.deepStrictEqual(p.prism.pts[0], mid);
  assert.deepStrictEqual(p.prism.pts[1], mid);
  assert.notDeepStrictEqual(p.prism.pts[2], mid);
});

test('a saved spot wins and stays inside the view', () => {
  const p = L.place(devs, { gpu: [100, 120], mb: [9999, -5] });
  const gpu = p.find((d) => d.key === 'gpu'), mb = p.find((d) => d.key === 'mb');
  assert.deepStrictEqual([gpu.x, gpu.y], [100, 120]);
  assert.deepStrictEqual([mb.x, mb.y], [L.W - 150, 0]);
});

test('along: left to right, bottom to top, out from the cooler', () => {
  const c = [300, 200];
  assert.ok(L.along([700, 0], 'x', c) > L.along([10, 0], 'x', c));
  assert.ok(L.along([0, 10], 'y', c) > L.along([0, 500], 'y', c));
  assert.strictEqual(L.along(c, 'r', c), 0);
  assert.deepStrictEqual(L.centre(L.place(devs)), [290, 145]);
});

test('validation: across, dir, desk and layout spots', () => {
  assert.deepStrictEqual(V.lighting({ across: true, dir: 'r', desk: false }), { across: true, dir: 'r', desk: false });
  assert.deepStrictEqual(V.lighting({ across: 'yes', dir: 'z' }), {});
  assert.deepStrictEqual(V.spot([10.4, 20.6]), [10, 21]);
  assert.strictEqual(V.spot([1]), null);
  assert.strictEqual(V.spot(['a', 2]), null);
});
