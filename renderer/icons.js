// Device icons in the Hairline style: isometric solids in one stroke. Each box is a silhouette plus one crease,
// plates filled with the ground so nothing shows through, no colour of their own. Every part is its own <g> so
// the hover can lift the parts off their base (style.css, .ic). window.deviceIcon(typeLabel, size, selected).
(() => {
  const ISO = (x, y, z) => [(x - y) * 0.866, (x + y) * 0.5 - z];
  const pt = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  const f1 = (n) => n.toFixed(1);
  function box(x, y, z, w, d, h) {
    const c = [ISO(x, y + d, z), ISO(x + w, y + d, z), ISO(x + w, y, z), ISO(x + w, y, z + h), ISO(x, y, z + h), ISO(x, y + d, z + h)];
    const k = ISO(x + w, y + d, z + h), f = ISO(x + w, y + d, z);
    return `<g><path class="pl" d="M${c.map(pt).join('L')}Z"/><path d="M${pt(c[5])}L${pt(k)}L${pt(c[3])}M${pt(k)}L${pt(f)}"/></g>`;
  }
  // a circle lying on a top face
  const ring = (cx, cy, z, r) => { const c = ISO(cx, cy, z); return `<g><ellipse class="pl" cx="${f1(c[0])}" cy="${f1(c[1])}" rx="${f1(r * 1.22)}" ry="${f1(r * 0.71)}"/></g>`; };
  // a circle standing on the front-right face, for fans seen side on
  const disc = (x, cy, cz, r) => { const c = ISO(x, cy, cz); return `<g><ellipse class="pl" cx="${f1(c[0])}" cy="${f1(c[1])}" rx="${f1(r * 0.71)}" ry="${f1(r)}" transform="rotate(-30 ${f1(c[0])} ${f1(c[1])})"/></g>`; };
  const line = (a, b) => `<g><path d="M${pt(ISO(...a))}L${pt(ISO(...b))}"/></g>`;
  const keys = () => [0, 1, 2].map((r) => [0, 1, 2, 3, 4, 5].map((c) => box(3 + c * 6.6, 2 + r * 4.6, 3, 4.6, 3.2, 1)).join('')).join('');

  const ICONS = {
    GPU: box(0, 0, 0, 40, 16, 6) + ring(12, 8, 6, 5) + ring(28, 8, 6, 5) + box(40, 2, 0, 3, 12, 7),
    Cooler: box(0, 0, 0, 22, 22, 4) + box(3, 3, 4, 16, 16, 14) + ring(11, 11, 18, 7) + ring(11, 11, 18, 2.4),
    Strip: box(0, 0, 0, 44, 4, 3) + [6, 14, 22, 30, 38].map((x) => ring(x, 2, 3, 0.9)).join(''),
    RAM: box(0, 0, 0, 4, 34, 12) + line([4, 2, 12.6], [4, 32, 12.6]) + box(0, 0, 12, 4, 34, 3),
    Board: box(0, 0, 0, 34, 30, 2) + box(6, 6, 2, 10, 10, 4) + box(22, 4, 2, 2, 22, 3) + box(26, 4, 2, 2, 22, 3) + box(6, 22, 2, 14, 4, 2),
    Mouse: box(0, 0, 0, 14, 24, 4) + box(1.5, 2, 4, 11, 16, 4) + line([7, 3, 8], [7, 9, 8]) + ring(7, 6, 8.2, 1.2),
    Keyboard: box(0, 0, 0, 44, 16, 3) + keys(),
    Mousemat: box(0, 0, 0, 40, 30, 1.5) + box(2, 2, 1.5, 36, 26, 0.5),
    Headset: box(0, 0, 0, 6, 12, 12) + box(26, 0, 0, 6, 12, 12) + `<g><path d="M${pt(ISO(3, 6, 12))}C${pt(ISO(3, 6, 34))} ${pt(ISO(29, 6, 34))} ${pt(ISO(29, 6, 12))}"/></g>`,
    Fan: box(0, 0, 0, 5, 26, 26) + disc(5, 13, 13, 10) + disc(5, 13, 13, 3),
    Case: box(0, 0, 0, 20, 34, 40) + disc(20, 10, 26, 6) + disc(20, 10, 12, 6) + line([20, 26, 4], [20, 26, 36]),
  };
  // OpenRGB device type label (app.js TYPES) to icon
  const BY_TYPE = { Graphics: 'GPU', Cooler: 'Cooler', Strip: 'Strip', Light: 'Strip', RAM: 'RAM', Board: 'Board', Mouse: 'Mouse',
    Keyboard: 'Keyboard', Keypad: 'Keyboard', Laptop: 'Keyboard', Mousemat: 'Mousemat', Pad: 'Mousemat', Headset: 'Headset',
    Stand: 'Headset', Case: 'Case', Fan: 'Fan' };
  // Bounds per icon (getBBox plus 2), so long and tall parts fill the same square.
  const BOX = { GPU: '-15.9 -8 53.4 38.5', Cooler: '-21.1 -17 42.2 41', Strip: '-5.5 -5 45.6 31', RAM: '-31.4 -17 36.9 38', Board: '-28 -4 59.4 38', Mouse: '-22.8 -8.3 36.9 29.3', Keyboard: '-15.9 -5 56 37', Mousemat: '-28 -3.5 64.6 40.5', Headset: '-12.4 -20.9 42.1 44.9', Fan: '-24.5 -28 30.8 45.5', Case: '-31.4 -42 50.7 71' };

  window.deviceIcon = (type, size = 28, hi = false) => {
    const k = BY_TYPE[type] || 'Board';
    return `<svg class="ic${hi ? ' hi' : ''}" viewBox="${BOX[k]}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${ICONS[k]}</svg>`;
  };
})();
