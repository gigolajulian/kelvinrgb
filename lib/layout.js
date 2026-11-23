// Case layout (#27): where every LED sits in a side view of the case, so Wave and Sweep can run across the whole PC
// instead of inside each device. Pure: no I/O. Units: a 760 x 520 view, the case on the left, the desk on the right.

const W = 760, H = 520;
const CASE = { x: 20, y: 20, w: 580, h: 480 }; // the desk is the strip right of x 616
const DESK_X = 616;
// OpenRGB device types that live on the desk, not in the case: keyboard, mouse, mousemat, headset, headset stand,
// gamepad, light, speaker, microphone, keypad.
const DESK_TYPES = new Set([5, 6, 7, 8, 9, 10, 11, 12, 16, 18]);

const isDesk = (d) => DESK_TYPES.has(d.type);
const line = (n, x0, y0, x1, y1) => Array.from({ length: n }, (_, i) => { const k = n > 1 ? i / (n - 1) : 0.5; return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k]; });
const ring = (n, cx, cy, r) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2 - Math.PI / 2; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });

// The drawing for one device: its box size, a kind the page draws, and one local point per LED.
function shape(d) {
  const n = d.leds;
  if (isDesk(d)) return { kind: 'desk', w: 60, h: 90, pts: line(n, 30, 14, 30, 76) };
  if (d.type === 1) return { kind: 'ram', w: 14, h: 120, pts: line(n, 7, 12, 7, 108) };
  if (d.type === 3) {
    // Coolers: a ring. Zones named Logo and Fan (Wraith Prism) sit in the middle, the rest go round.
    const pts = []; let i = 0; const rest = [];
    for (const z of d.zones) for (let k = 0; k < z.leds; k++, i++) (/logo|fan/i.test(z.name) ? pts[i] = [60, 60] : rest.push(i));
    ring(rest.length, 60, 60, 50).forEach((p, k) => { pts[rest[k]] = p; });
    for (let j = 0; j < n; j++) if (!pts[j]) pts[j] = [60, 60]; // zones and LED count disagree: keep every LED placed
    return { kind: 'cooler', w: 120, h: 120, pts };
  }
  if (d.type === 2) return { kind: 'gpu', w: 330, h: 54, pts: line(n, 25, 27, 305, 27) };
  if (d.type === 0) return { kind: 'board', w: 150, h: 30, pts: line(n, 15, 15, 135, 15) };
  return { kind: 'strip', w: 34, h: 420, pts: line(n, 17, 12, 17, 408) }; // LED strips, fan hubs, case lighting
}

// A first guess by device type. Several of one type (RAM sticks, two strips) sit side by side.
function guess(d, k) {
  if (isDesk(d)) return [650 - k * 70, 400];
  if (d.type === 1) return [395 + k * 16, 70];
  if (d.type === 3) return [230, 85];
  if (d.type === 2) return [150, 285 + k * 64];
  if (d.type === 0) return [300, 370];
  return [540 - k * 44, 50];
}

const clampPos = (x, y, s) => [Math.round(Math.min(W - s.w, Math.max(0, x))), Math.round(Math.min(H - s.h, Math.max(0, y)))];

// Every device with LEDs: its box and absolute LED points. saved: { key: [x, y] } from settings.layout.
function place(devices, saved = {}) {
  const seen = new Map();
  return devices.filter((d) => d.leds > 0).map((d) => {
    const s = shape(d), slot = `${isDesk(d) ? 'desk' : d.type}`, k = seen.get(slot) || 0;
    seen.set(slot, k + 1);
    const [x, y] = clampPos(...(saved[d.key] || guess(d, k)), s);
    return { key: d.key, name: d.name, kind: s.kind, desk: isDesk(d), x, y, w: s.w, h: s.h, pts: s.pts.map(([px, py]) => [x + px, y + py]) };
  });
}

// Position 0..1 of a point along the chosen direction: x = left to right, y = bottom to top, r = out from the CPU.
function along(p, dir, centre) {
  if (dir === 'y') return 1 - p[1] / H;
  if (dir === 'r') return Math.min(1, Math.hypot(p[0] - centre[0], p[1] - centre[1]) / Math.hypot(W, H) * 1.6);
  return p[0] / W;
}
// The cooler's middle, or the middle of the case when there is none.
function centre(placed) {
  const c = placed.find((p) => p.kind === 'cooler');
  return c ? [c.x + c.w / 2, c.y + c.h / 2] : [CASE.x + CASE.w / 2, CASE.y + CASE.h / 2];
}

module.exports = { place, along, centre, shape, isDesk, clampPos, W, H, CASE, DESK_X };
