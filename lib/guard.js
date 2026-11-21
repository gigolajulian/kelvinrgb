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

module.exports = { enter, leave };
