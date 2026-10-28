const test = require('node:test');
const assert = require('node:assert');
const { tune, frame, curveDuty, hexToRgb } = require('../lib/math');

test('tune: identity at gain 1, gamma 2.2, full brightness', () => {
  assert.deepStrictEqual(tune({ red: 200, green: 50, blue: 10 }), { red: 200, green: 50, blue: 10 });
});

test('tune: gain and brightness scale channels', () => {
  assert.deepStrictEqual(tune({ red: 255, green: 255, blue: 255 }, { gain: [1, 0.5, 0] }, 0.5), { red: 128, green: 64, blue: 0 });
});

test('frame: static returns base, off is black', () => {
  const c = hexToRgb('#c8323c');
  assert.deepStrictEqual(frame('static', c, 3, 50), c);
  assert.deepStrictEqual(frame('off', c, 3, 50), { red: 0, green: 0, blue: 0 });
});

test('curveDuty: clamps ends, interpolates, steps', () => {
  const pts = [[30, 25], [50, 35], [80, 85]];
  assert.strictEqual(curveDuty(pts, 10), 25);
  assert.strictEqual(curveDuty(pts, 95), 85);
  assert.strictEqual(curveDuty(pts, 40), 30);
  assert.strictEqual(curveDuty(pts, 40, 'stepped'), 25);
  assert.strictEqual(curveDuty(pts, 40, 'smooth'), 30);
});
