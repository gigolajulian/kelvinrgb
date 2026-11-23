// Apex / Easy Anti-Cheat guard steps. main.js passes the real actions in; tests pass fakes.
// The OpenRGB server touches SMBus (RAM lighting), so it is stopped for the whole game, not only disconnected.

// Game started: stop painting first so the lights hold their last colours, then let go of every device.
async function enter(d) {
  d.stopRender();
  await d.stopSidecar();
  d.disconnect();
  await d.wait(500); // let the last SDK packet land before the server goes away
  await d.killOpenRgb();
}

// Game closed: fans back first, then allow a fresh OpenRGB launch. The 3 s connect loop starts the
// server, reconnects and repaints the saved lighting.
function leave(d) {
  d.startSidecar();
  d.allowRelaunch();
  d.connect();
}

// Quit: save, rest the lights on the chosen colour, hand the fans back, then stop the OpenRGB server only if
// KelvinRGB started it (one the user runs, such as a service, keeps running). A failed step never blocks the rest.
async function quit(d) {
  for (const step of [d.flush, d.restLights, d.stopSidecar]) { try { await step(); } catch (e) { d.log(`quit: ${e.message}`); } }
  const pid = d.ourOpenRgb();
  if (pid) { try { await d.killOpenRgb(pid); } catch (e) { d.log(`quit: ${e.message}`); } }
}

module.exports = { enter, leave, quit };
