const test = require('node:test');
const assert = require('node:assert');
const G = require('../lib/guard');

function fakes() {
  const calls = [];
  const f = (name) => async () => { calls.push(name); };
  const d = {
    stopRender: f('stopRender'), stopSidecar: f('stopSidecar'), disconnect: f('disconnect'),
    wait: f('wait'), killOpenRgb: f('killOpenRgb'),
    startSidecar: f('startSidecar'), allowRelaunch: f('allowRelaunch'), connect: f('connect'),
  };
  return { d, calls };
}

test('game start: stop painting, release fans, disconnect, then kill the server', async () => {
  const { d, calls } = fakes();
  await G.enter(d);
  assert.deepStrictEqual(calls, ['stopRender', 'stopSidecar', 'disconnect', 'wait', 'killOpenRgb']);
});

test('game exit: fans back, allow relaunch, reconnect', async () => {
  const { d, calls } = fakes();
  G.leave(d);
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(calls, ['startSidecar', 'allowRelaunch', 'connect']);
});
