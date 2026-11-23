// Pure helpers: color tuning, effect frames, fan curves. No I/O, so they are easy to test.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return { red: (n >> 16) & 255, green: (n >> 8) & 255, blue: n & 255 };
}

// gain: per channel 0..1, gamma: 2.2 = unchanged, brightness: 0..1.
function tune(c, { gain = [1, 1, 1], gamma = 2.2 } = {}, brightness = 1) {
  const ch = (v, g) => Math.round(255 * clamp(Math.pow(v / 255, gamma / 2.2) * g * brightness, 0, 1));
  return { red: ch(c.red, gain[0]), green: ch(c.green, gain[1]), blue: ch(c.blue, gain[2]) };
}

function hsv(h, s = 1, v = 1) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return { red: f(5), green: f(3), blue: f(1) };
}

const mix = (a, b, k) => ({ red: Math.round(a.red + (b.red - a.red) * k), green: Math.round(a.green + (b.green - a.green) * k), blue: Math.round(a.blue + (b.blue - a.blue) * k) });
// Position p (any real, one unit per colour) on a looping blend through the palette.
function along(pal, p) {
  const n = pal.length, x = ((p % n) + n) % n, j = Math.floor(x);
  return mix(pal[j], pal[(j + 1) % n], x - j);
}

const BLACK = { red: 0, green: 0, blue: 0 };
const COOL = { red: 59, green: 79, blue: 216 }, WARM = { red: 200, green: 50, blue: 60 }; // #3b4fd8, #c8323c
const TEMP_LO = 35, TEMP_HI = 85; // degrees C mapped to the cool and warm ends

// Color of LED i of n at time t (seconds). speed 0..100.
// pal: 2 or 3 colours ({red,green,blue}) keep spectrum and wave inside them, and breathing steps through them
// one colour per breath (#27). Fewer than 2 = the old full rainbow.
// temp: CPU temperature in degrees C for the Temperature effect (null = no sensor, shows the cool end).
function frame(effect, base, t, speed, i = 0, n = 1, pal = [], temp = null) {
  const rate = 0.05 + (speed / 100) * 0.95; // cycles per second
  const own = pal.length >= 2;
  if (effect === 'off') return { red: 0, green: 0, blue: 0 };
  if (effect === 'breathing') {
    const ph = t * rate * 0.5, k = 0.5 - 0.5 * Math.cos(2 * Math.PI * ph);
    const c = own ? pal[Math.floor(ph) % pal.length] : base; // the colour changes at the dark point of each breath
    return mix({ red: 0, green: 0, blue: 0 }, c, k);
  }
  if (effect === 'spectrum') return own ? along(pal, t * rate * 0.5) : hsv((t * rate * 60) % 360);
  if (effect === 'wave') return own ? along(pal, t * rate + (i / Math.max(1, n)) * pal.length) : hsv((t * rate * 120 + (i / Math.max(1, n)) * 360) % 360);
  if (effect === 'cycle') {
    // Colour cycle: hold each colour, then cross-fade to the next. Every device on the same colour at once.
    const cs = own ? pal : [base, COOL];
    const p = t * rate * 0.25, j = Math.floor(p), f = p - j;
    const k = f < 0.6 ? 0 : (1 - Math.cos(Math.PI * (f - 0.6) / 0.4)) / 2;
    return mix(cs[j % cs.length], cs[(j + 1) % cs.length], k);
  }
  if (effect === 'sweep') {
    // Sweep: a soft band of light runs from the first LED to the last over a dim floor; each pass takes the next colour.
    const p = t * rate * 0.5, pass = Math.floor(p), head = (p - pass) * 1.6 - 0.3; // band enters and leaves the strip
    const c = own ? pal[pass % pal.length] : base;
    const x = n > 1 ? i / (n - 1) : 0.5, d = Math.abs(x - head) / 0.22;
    const k = 0.08 + 0.92 * (d < 1 ? (1 + Math.cos(Math.PI * d)) / 2 : 0);
    return mix(BLACK, c, k);
  }
  if (effect === 'temp') {
    // Temperature: cool colour at 35 C, warm colour at 85 C. With effect colours set, the bluest is cool, the reddest warm.
    const warmth = (c) => c.red - c.blue;
    const lo = own ? pal.reduce((a, c) => (warmth(c) < warmth(a) ? c : a)) : COOL;
    const hi = own ? pal.reduce((a, c) => (warmth(c) > warmth(a) ? c : a)) : WARM;
    const k = temp == null ? 0 : clamp((temp - TEMP_LO) / (TEMP_HI - TEMP_LO), 0, 1);
    return mix(lo, hi, k);
  }
  return base; // static
}

// points: [[tempC, duty%], ...] sorted by temp. shape: linear | smooth | stepped.
function curveDuty(points, temp, shape = 'linear') {
  if (!points.length) return 100;
  if (temp <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (temp >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [t1, d1] = points[i];
    if (temp > t1) continue;
    const [t0, d0] = points[i - 1];
    if (shape === 'stepped') return d0;
    let k = (temp - t0) / (t1 - t0);
    if (shape === 'smooth') k = k * k * (3 - 2 * k);
    return d0 + (d1 - d0) * k;
  }
  return last[1];
}

module.exports = { clamp, hexToRgb, tune, hsv, frame, curveDuty, along, TEMP_LO, TEMP_HI };
