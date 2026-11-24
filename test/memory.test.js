// Memory ceiling: the lighting maths runs 30 times a second for every LED, forever. A cache or log that grows per
// frame would show up here long before it fills a PC.
const test = require('node:test');
const assert = require('node:assert');
const v8 = require('node:v8');
const vm = require('node:vm');
const M = require('../lib/math');
const S = require('../lib/store');

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');
const heap = () => { gc(); gc(); return process.memoryUsage().heapUsed; };

test('memory: 3000 frames of 10 devices stay under a 4 MB heap ceiling', () => {
  const base = M.hexToRgb('#c8323c'), pal = ['#c8323c', '#3b4fd8'].map(M.hexToRgb), dev = { gain: [1, 0.9, 0.8], gamma: 2.2 };
  let log = [];
  const frames = (n, from) => {
    for (let f = from; f < from + n; f++) {
      for (let d = 0; d < 10; d++) for (let i = 0; i < 60; i++) M.tune(M.frame(['wave', 'breathing', 'spectrum', 'temp'][d % 4], base, f / 30, 40, i, 60, pal, 55), dev, 0.8);
      log = S.ring(log, `frame ${f}`, 50);
    }
  };
  frames(300, 0); // warm up: JIT and the first allocations settle
  const before = heap();
  frames(3000, 300); // 100 s of lighting
  const grew = heap() - before;
  assert.ok(grew < 4 * 1024 * 1024, `heap grew ${(grew / 1048576).toFixed(1)} MB over 3000 frames`);
  assert.strictEqual(log.length, 50);
});
