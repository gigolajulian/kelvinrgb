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

// Color of LED i of n at time t (seconds). speed 0..100.
function frame(effect, base, t, speed, i = 0, n = 1) {
  const rate = 0.05 + (speed / 100) * 0.95; // cycles per second
  if (effect === 'off') return { red: 0, green: 0, blue: 0 };
  if (effect === 'breathing') {
    const k = 0.5 - 0.5 * Math.cos(2 * Math.PI * t * rate * 0.5);
    return { red: Math.round(base.red * k), green: Math.round(base.green * k), blue: Math.round(base.blue * k) };
  }
  if (effect === 'spectrum') return hsv((t * rate * 60) % 360);
  if (effect === 'wave') return hsv((t * rate * 120 + (i / Math.max(1, n)) * 360) % 360);
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

module.exports = { clamp, hexToRgb, tune, hsv, frame, curveDuty };
