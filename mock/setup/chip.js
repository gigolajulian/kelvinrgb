/**
 * Chip: the board's Super I/O chip, the part the driver opens up to read
 * temperatures and set fan speeds. Seven pins on each side of a square
 * package; pins rise near the pointer, each on its own spring, and the one
 * under it takes the bright edge. At rest the pins on the fan-header side
 * swell a little and the pin-1 dot is bright. The slider is the reach, in pins.
 */
const {
  Cam, clamp, fit, prism, proj, rings, facing, unproj, spring, stepS,
  disposer, flatDot, mk, place, pointer, put, register, solid,
} = HL;

const PITCH = 7, B0 = 28, PL = 10, HMAX = 24, BD = 54;

const falloff = (u) => (u <= 0 ? 1 : u <= 0.42 ? 1 - (u / 0.42) * 0.69 : u <= 1 ? 0.31 - ((u - 0.42) / 0.58) * 0.22 : 0.09);

/** The 28 pins, numbered counterclockwise from the pin-1 corner. */
function pins() {
  const out = [], ks = [-3, -2, -1, 0, 1, 2, 3];
  const sides = [
    (k) => [k * PITCH, -B0 - PL / 2, 2, PL / 2], (k) => [B0 + PL / 2, k * PITCH, PL / 2, 2],
    (k) => [-k * PITCH, B0 + PL / 2, 2, PL / 2], (k) => [-B0 - PL / 2, -k * PITCH, PL / 2, 2],
  ];
  sides.forEach((f) => ks.forEach((k) => {
    const [cx, cy, hw, hh] = f(k);
    out.push({ n: out.length + 1, cx, cy, ri: rings(cx - hw, cy - hh, cx + hw, cy + hh, 1.2, 0.6) });
  }));
  return out;
}

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let R = value * PITCH, over = null;
  const C = Cam(45, 0.5, 1.95);
  fit(C, [[-BD, -BD, -4], [BD, BD, -4], [BD, -BD, -4], [-BD, BD, -4], [0, 0, HMAX + 4]], 200, 168);
  const P = proj(C), front = facing(C);
  const g = mk("g", {}, svg);

  const [br, bi] = rings(-BD, -BD, BD, BD, 8, 2);
  put(solid(g), prism(P, front, br, bi, -4, 0));
  const body = mk("g", {}, g);
  const [cr, ci] = rings(-B0, -B0, B0, B0, 3, 1.6);
  put(solid(body), prism(P, front, cr, ci, 0, 9));
  const dot = flatDot(body, C, 1.6, "dot");
  place(dot, P(-B0 + 7, -B0 + 7, 9));

  const ps = pins().map((p) => {
    const h0 = 2 + 9 * Math.exp(-((p.cx - 38) ** 2 + p.cy ** 2) / 260);
    return { ...p, h0, sp: spring(h0, { eps: 0.04 }), drawn: NaN };
  });
  ps.slice().sort((a, b) => a.cx + a.cy - (b.cx + b.cy)).forEach((p) => {
    p.el = solid(g);
    if (p.cx + p.cy < 0) g.insertBefore(p.el.g, body); else g.appendChild(p.el.g);
  });

  const B = register(stage, (dt) => {
    let m = false;
    for (const p of ps) {
      if (stepS(p.sp, dt)) m = true;
      const h = Math.max(1.5, p.sp.x);
      if (h !== p.drawn) { p.drawn = h; put(p.el, prism(P, front, p.ri[0], p.ri[1], 0, h)); }
    }
    return m;
  });
  bag.add(B.unregister);

  let lit = null;
  function retarget() {
    let near = null, best = Infinity;
    for (const p of ps) {
      if (!over) { p.sp.t = p.h0; continue; }
      const d = Math.hypot(p.cx - over[0], p.cy - over[1]);
      p.sp.t = 2 + HMAX * falloff(d / R);
      if (d < best) { best = d; near = p; }
    }
    if (best > PITCH * 1.6) near = null;
    if (lit !== near) { if (lit) lit.el.sil.classList.remove("hi"); if (near) near.el.sil.classList.add("hi"); lit = near; }
    dot.setAttribute("class", near ? "dot m" : "dot");
    read.textContent = near ? `pin ${near.n}` : "rest";
    B.wake();
  }

  bag.add(pointer(stage, {
    move: (p) => { const w = unproj(C, p[0], p[1], 2); over = Math.max(Math.abs(w[0]), Math.abs(w[1])) < BD ? w : null; retarget(); },
    leave: () => { over = null; retarget(); },
  }));
  bag.add(() => svg.replaceChildren());
  return { set: (v) => { R = v * PITCH; if (over) retarget(); }, destroy: bag.dispose };
}

hairline({
  name: "chip",
  means: "The board's sensor chip: its pins rise under the pointer, the way the driver reaches each one.",
  rules: [1, 3, 5, 9],
  range: [1.5, 3, 5],
  tour: [[150, 120], [300, 170], [200, 230], null],
  mount,
});
