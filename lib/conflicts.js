// Apps that hold the same RGB devices as KelvinRGB. CLOSE matches what SignalRGB's ConflictMitigator closes on this PC.
// L-Connect, G HUB and iCUE added for #23: each holds its own brand's lights.
const CLOSE = ['NZXT CAM.exe', 'SteelSeriesGG.exe', 'SteelSeriesEngine.exe', 'SteelSeriesPrism.exe',
  'L-Connect 3.exe', 'lghub.exe', 'lghub_agent.exe', 'lghub_system_tray.exe', 'iCUE.exe'];
// Dev aid: RGB_CONFLICT_TEST=notepad.exe adds a stand-in, since SignalRGB closes the real ones within 2 s.
// Dev aid only: process.defaultApp is set when run as `electron .`, never in the installed build.
if (process.defaultApp && process.env.RGB_CONFLICT_TEST) CLOSE.push(process.env.RGB_CONFLICT_TEST);
// Services or rival lighting apps: killing them fights the service manager or Julian's choice, so only warn.
const WARN = {
  'ArmouryCrate.Service.exe': 'Armoury Crate hides the ASUS Aura USB device. Turn off its lighting or uninstall it.',
  'SignalRgb.exe': 'SignalRGB is running and fights KelvinRGB for the same lights.',
  'SignalRgbService.exe': 'The SignalRGB service keeps hold of devices even with SignalRGB closed.',
  'LightingService.exe': 'ASUS Aura lighting service. It drives the board and RAM lights.',
};

// Warn-only apps that run as a Windows service: "Stop service" stops it until reboot, never changes its startup type.
const SERVICES = { 'armourycrate.service.exe': 'ArmouryCrateService', 'signalrgbservice.exe': 'SignalRgb.Service', 'lightingservice.exe': 'LightingService' };
const service = (name) => SERVICES[String(name).toLowerCase()];

const LABELS = {
  'nzxt cam.exe': 'NZXT CAM', 'steelseriesgg.exe': 'SteelSeries GG', 'steelseriesengine.exe': 'SteelSeries Engine',
  'steelseriesprism.exe': 'SteelSeries Prism', 'armourycrate.service.exe': 'Armoury Crate', 'signalrgb.exe': 'SignalRGB',
  'signalrgbservice.exe': 'SignalRGB service', 'lightingservice.exe': 'ASUS Aura service', 'l-connect 3.exe': 'L-Connect 3',
  'lghub.exe': 'Logitech G HUB', 'lghub_agent.exe': 'Logitech G HUB', 'lghub_system_tray.exe': 'Logitech G HUB', 'icue.exe': 'Corsair iCUE',
};

// Which OpenRGB devices each app holds, by device name. SignalRGB drives every brand.
const HOLDS = [
  [/^signalrgb/i, /./, 'all your'], [/nzxt/i, /nzxt/i, 'NZXT'], [/steelseries/i, /steelseries/i, 'SteelSeries'],
  [/armoury|lightingservice/i, /asus|aura|ene dram/i, 'ASUS board and RAM'], [/l-connect/i, /lian li|strimer/i, 'Lian Li'],
  [/lghub/i, /logitech/i, 'Logitech'], [/icue/i, /corsair/i, 'Corsair'],
];
// device names this app may be holding, from the devices OpenRGB lists now
function holds(name, deviceNames) {
  const h = HOLDS.find(([app]) => app.test(name));
  return h ? [...new Set(deviceNames.filter((d) => h[1].test(d)))] : [];
}
// One line for the conflict row: the devices it holds, or the brand when OpenRGB can't see them yet.
function holdsText(name, deviceNames) {
  const h = HOLDS.find(([app]) => app.test(name));
  if (!h) return '';
  const d = holds(name, deviceNames);
  return d.length ? `Holds ${d.slice(0, 3).join(', ')}${d.length > 3 ? ` and ${d.length - 3} more` : ''}` : `Can hide ${h[2]} lights from KelvinRGB`;
}
const label = (name) => LABELS[name.toLowerCase()] || name.replace(/\.exe$/i, '');

// tasklist /FO CSV /NH output -> [{ name, pid }]
function parse(csv) {
  return csv.split(/\r?\n/).map((l) => l.match(/^"([^"]+)","(\d+)"/)).filter(Boolean).map((m) => ({ name: m[1], pid: Number(m[2]) }));
}

const lower = (list) => list.map((n) => n.toLowerCase());
const closeSet = new Set(lower(CLOSE));
const closable = (name) => closeSet.has(String(name).toLowerCase());
function toClose(procs) { return procs.filter((p) => closeSet.has(p.name.toLowerCase())); }
function toWarn(procs) {
  const running = new Set(lower(procs.map((p) => p.name)));
  return Object.keys(WARN).filter((n) => running.has(n.toLowerCase()));
}

// Same wording as SignalRGB's toast: two names, then "and N other processes".
function message(names) {
  const u = [...new Set(names)];
  if (u.length === 1) return `KelvinRGB closed ${u[0]}.`;
  if (u.length <= 3) return `KelvinRGB closed ${u.slice(0, -1).join(', ')} and ${u.at(-1)}.`;
  return `KelvinRGB closed ${u[0]}, ${u[1]} and ${u.length - 2} other processes.`;
}

module.exports = { CLOSE, WARN, parse, toClose, toWarn, message, label, closable, service, holds, holdsText };
