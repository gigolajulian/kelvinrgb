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

function quitFakes(pid, failing) {
  const calls = [];
  const f = (name) => async (arg) => { calls.push(arg ? `${name} ${arg}` : name); if (name === failing) throw new Error(`${name} failed`); };
  return { calls, d: { flush: f('flush'), restLights: f('restLights'), stopSidecar: f('stopSidecar'), killOpenRgb: f('killOpenRgb'), ourOpenRgb: () => pid, log: () => {} } };
}

test('quit stops the OpenRGB server KelvinRGB started, after the lights rest and the fans go back', async () => {
  const { d, calls } = quitFakes(4242);
  await G.quit(d);
  assert.deepStrictEqual(calls, ['flush', 'restLights', 'stopSidecar', 'killOpenRgb 4242']);
});

test('quit leaves an OpenRGB the user started alone', async () => {
  const { d, calls } = quitFakes(0);
  await G.quit(d);
  assert.ok(!calls.some((c) => c.startsWith('killOpenRgb')));
});

test('a failed quit step still hands the fans back and stops our server', async () => {
  const { d, calls } = quitFakes(7, 'restLights');
  await G.quit(d);
  assert.deepStrictEqual(calls, ['flush', 'restLights', 'stopSidecar', 'killOpenRgb 7']);
});
