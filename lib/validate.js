// Validation for everything that crosses from the renderer (or settings.json) into the elevated main process.
// Pure functions: each returns a clean copy or null, never throws.
const HEX = /^#[0-9a-f]{6}$/i;
const EFFECTS = ['static', 'breathing', 'spectrum', 'wave', 'off'];
const MODES = ['bios', 'curve', 'fixed'];
const SHAPES = ['smooth', 'linear', 'stepped'];

const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
const str = (v, max = 200) => (typeof v === 'string' && v.length <= max ? v : null);

function lighting(p) {
  if (!p || typeof p !== 'object') return null;
  const out = {};
  if ('effect' in p && EFFECTS.includes(p.effect)) out.effect = p.effect;
  if ('color' in p && HEX.test(p.color)) out.color = p.color.toLowerCase();
  if ('speed' in p && num(p.speed, 0, 100) != null) out.speed = num(p.speed, 0, 100);
  if ('brightness' in p && num(p.brightness, 0, 100) != null) out.brightness = num(p.brightness, 0, 100);
  if ('on' in p && typeof p.on === 'boolean') out.on = p.on;
  return out;
}

function device(p) {
  if (!p || typeof p !== 'object') return null;
  const out = {};
  if ('off' in p && typeof p.off === 'boolean') out.off = p.off;
  if ('brightness' in p && num(p.brightness, 0, 100) != null) out.brightness = num(p.brightness, 0, 100);
  if ('gamma' in p && num(p.gamma, 1, 3) != null) out.gamma = num(p.gamma, 1, 3);
  if ('fanWhite' in p && num(p.fanWhite, 0, 255) != null) out.fanWhite = Math.round(num(p.fanWhite, 0, 255));
  if ('gain' in p && Array.isArray(p.gain) && p.gain.length === 3 && p.gain.every((g) => num(g, 0, 1) != null)) out.gain = p.gain.map((g) => num(g, 0, 1));
  if ('label' in p && str(p.label, 60) != null) out.label = p.label.trim();
  // per-zone colour overrides: { "<zone index>": "#rrggbb" }, null clears one
  if ('zones' in p && p.zones && typeof p.zones === 'object' && !Array.isArray(p.zones)) {
    const z = {};
    for (const [k, v] of Object.entries(p.zones)) if (/^\d{1,3}$/.test(k) && (v === null || HEX.test(v))) z[k] = v && v.toLowerCase();
    out.zones = z;
  }
  return out;
}

function fan(p, floor) {
  if (!p || typeof p !== 'object' || !MODES.includes(p.mode)) return null;
  const out = { mode: p.mode, shape: SHAPES.includes(p.shape) ? p.shape : 'smooth' };
  out.fixed = num(p.fixed, floor, 100) ?? 50;
  if (str(p.sensor, 300) != null) out.sensor = p.sensor;
  if (str(p.label, 60) != null) out.label = p.label.trim();
  const pts = Array.isArray(p.points) ? p.points.filter((q) => Array.isArray(q) && q.length === 2 && num(q[0], 0, 120) != null && num(q[1], 0, 100) != null) : [];
  if (pts.length > 16) pts.length = 16;
  out.points = pts.map(([t, d]) => [num(t, 20, 100), num(d, floor, 100)]).sort((a, b) => a[0] - b[0]);
  if (out.mode === 'curve' && out.points.length < 2) return null; // a curve needs two points
  return out;
}

// settings.json is user-writable, so it goes through the same gates on load.
function settings(raw, defaults, floor) {
  const s = structuredClone(defaults);
  if (!raw || typeof raw !== 'object') return s;
  Object.assign(s.lighting, lighting(raw.lighting) || {});
  if (raw.devices && typeof raw.devices === 'object') for (const [k, v] of Object.entries(raw.devices)) { const d = str(k, 300) && device(v); if (d) s.devices[k] = d; }
  if (raw.fans && typeof raw.fans === 'object') for (const [k, v] of Object.entries(raw.fans)) { const f = str(k, 300) && fan(v, floor); if (f) s.fans[k] = f; }
  if (typeof raw.closeConflicts === 'boolean') s.closeConflicts = raw.closeConflicts;
  if (typeof raw.glass === 'boolean') s.glass = raw.glass;
  if (typeof raw.splash === 'boolean') s.splash = raw.splash;
  return s;
}

module.exports = { lighting, device, fan, settings, HEX };
