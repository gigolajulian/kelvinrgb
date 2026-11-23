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

test('frame: a palette keeps every effect inside its colours (#27)', () => {
  const red = hexToRgb('#c8323c'), blue = hexToRgb('#3b4fd8'), pal = [red, blue];
  const inside = (c) => [0, 0.1, 0.25, 0.5, 0.75, 1].some((k) => {
    const m = { red: red.red + (blue.red - red.red) * k, green: red.green + (blue.green - red.green) * k, blue: red.blue + (blue.blue - red.blue) * k };
    return Math.abs(m.red - c.red) < 30 && Math.abs(m.green - c.green) < 30 && Math.abs(m.blue - c.blue) < 30;
  });
  for (let t = 0; t < 20; t += 0.37) {
    assert.ok(inside(frame('spectrum', red, t, 40, 0, 1, pal)), `spectrum at ${t}`);
    for (let i = 0; i < 10; i++) assert.ok(inside(frame('wave', red, t, 40, i, 10, pal)), `wave at ${t} led ${i}`);
  }
  // breathing: full colour mid-breath, black at the ends, next colour on the next breath
  const rate = 0.05 + 0.4 * 0.95, breath = 2 / rate;
  assert.deepStrictEqual(frame('breathing', red, breath / 2, 40, 0, 1, pal), red);
  assert.deepStrictEqual(frame('breathing', red, breath * 1.5, 40, 0, 1, pal), blue);
  assert.deepStrictEqual(frame('breathing', red, 0, 40, 0, 1, pal), { red: 0, green: 0, blue: 0 });
  // under two colours: the old rainbow
  assert.deepStrictEqual(frame('spectrum', red, 1, 40, 0, 1, [red]), frame('spectrum', red, 1, 40));
});
