// The Setup sheet's three figures (mock/setup). Each one calls hairline() once; the sheet mounts them by name when it opens.
window.FIGURES = {};
window.hairline = (f) => { window.FIGURES[f.name] = f; };
{
/**
 * Ring: the top of a Wraith-style cooler, a puck with fifteen LED segments
 * round its logo. The pointer picks the segment under it; that segment and
 * its neighbours lift out, staggered by distance round the ring. At rest the
 * ring swells towards segment 4, which holds the bright edge. The slider is
 * the stagger, in ms.
 */
const {
  Cam, circ, fit, prism, proj, rrect, facing, unproj, tset, tval, tdone, tween,
  disposer, mk, pointer, put, register, solid,
} = HL;

const N = 15, R = 60, RL = 50, TOP = 14, LH = 3, LIFT = 26, REST_AT = 3;

/** A ring of samples turned by a and moved to (cx, cy). */
const turn = (ring, a, cx, cy) => {
  const c = Math.cos(a), s = Math.sin(a);
  return ring.map((q) => ({ u: cx + q.u * c - q.v * s, v: cy + q.u * s + q.v * c, nu: q.nu * c - q.nv * s, nv: q.nu * s + q.nv * c }));
};
/** Steps round the ring between i and j, the short way. */
const steps = (i, j) => { const d = Math.abs(i - j) % N; return Math.min(d, N - d); };
const restLift = (i) => 7 * Math.max(0, Math.cos(steps(i, REST_AT) * 2 * Math.PI / N)) ** 2;

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let stag = value;
  const C = Cam(45, 0.5, 2.25);
  fit(C, [[-R, -R, 0], [R, R, 0], [R, -R, 0], [-R, R, 0], [0, 0, TOP + LH + LIFT]], 200, 170);
  const P = proj(C), front = facing(C);
  const g = mk("g", {}, svg);

  // the puck: a body, then a shallow step for the ring's bed
  put(solid(g), prism(P, front, circ(R, 72), circ(R - 2, 72), 0, TOP - 3));
  put(solid(g), prism(P, front, circ(R - 4, 72), circ(R - 6, 72), TOP - 3, TOP));

  const leds = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, cx = RL * Math.cos(a), cy = RL * Math.sin(a);
    leds.push({ i, ring: turn(rrect(-5, -7.5, 5, 7.5, 2.6, 4), a, cx, cy), inner: turn(rrect(-4, -6.5, 4, 6.5, 1.8, 4), a, cx, cy), depth: cx + cy, z: tween(restLift(i)), drawn: NaN });
  }
  // back to front; the logo sits between the far half and the near half
  const order = leds.slice().sort((p, q) => p.depth - q.depth);
  const logo = mk("g", {}, g);
  for (const l of order) { l.el = solid(g); if (l.depth > 0) g.appendChild(l.el.g); else g.insertBefore(l.el.g, logo); }
  put(solid(logo), prism(P, front, circ(24, 64), circ(22.5, 64), TOP, TOP + 4));
  put(solid(logo), prism(P, front, circ(9, 40), circ(7.6, 40), TOP + 4, TOP + 6.5));
  leds[REST_AT].el.sil.classList.add("hi");

  const B = register(stage, (_dt, now) => {
    let moving = false;
    for (const l of leds) {
      const h = tval(l.z, now);
      if (h !== l.drawn) { l.drawn = h; put(l.el, prism(P, front, l.ring, l.inner, TOP, TOP + LH + h)); }
      if (!tdone(l.z, now)) moving = true;
    }
    return moving;
  });
  bag.add(B.unregister);

  // Picks on the plane of the segments' resting tops, which never moves.
  function hit(p) {
    const [x, y] = unproj(C, p[0], p[1], TOP + LH);
    const r = Math.hypot(x, y);
    if (r < 32 || r > 70) return -1;
    return Math.round(((Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * N) % N;
  }

  let act = -1;
  function setActive(a) {
    if (a === act) return;
    const now = performance.now(), from = a >= 0 ? a : act;
    act = a;
    for (const l of leds) {
      const d = steps(l.i, from);
      tset(l.z, a < 0 ? restLift(l.i) : LIFT * Math.max(0, 1 - steps(l.i, a) / 4), now, d * stag);
      l.el.sil.classList.toggle("hi", a < 0 ? l.i === REST_AT : l.i === a);
    }
    read.textContent = a < 0 ? "rest" : `led ${a + 1}`;
    B.wake();
  }

  bag.add(pointer(stage, { move: (p) => setActive(hit(p)), leave: () => setActive(-1) }));
  bag.add(() => svg.replaceChildren());
  return { set: (v) => { stag = v; }, destroy: bag.dispose };
}

hairline({
  name: "ring",
  means: "A cooler's LED ring: the segment under the pointer lifts out and its neighbours follow, one after another.",
  rules: [1, 2, 5, 9],
  range: [0, 40, 90],
  tour: [[150, 190], [250, 210], [290, 140], null],
  mount,
});
}
{
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
}
{
/**
 * Fan: a 120 mm case fan lying in its square frame. The rotor always turns,
 * never below the 25% floor. The pointer sets the duty by where it sits: near
 * the hub the fan runs full, at the frame's edge it falls back to the floor,
 * on a spring. One blade holds the bright edge so the turn can be followed.
 * The slider is the reach of the pointer, in world units.
 */
const {
  Cam, clamp, fit, open, poly, prism, proj, rings, circ, facing, unproj, spring, stepS,
  disposer, mk, pointer, put, register, solid,
} = HL;

const F = 60, FH = 10, HOLE = 56, HUB = 17, NB = 7, FLOOR = 0.25, RPM = 2000, TURNS = 1.6;

/** One blade in the rotor plane, swept back, as world [x, y] points before turning. */
function bladeShape() {
  const pts = [];
  for (let k = 0; k <= 8; k++) { const t = k / 8, r = HUB + 1 + t * (HOLE - HUB - 5); pts.push([r, -10 + 16 * t * t - 3 * t]); }
  for (let k = 8; k >= 0; k--) { const t = k / 8, r = HUB + 1 + t * (HOLE - HUB - 5); pts.push([r, 6 + 14 * t * t + 4 * t]); }
  return pts;
}

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let reach = value, over = null, ang = 0.2, last = NaN;
  const C = Cam(45, 0.5, 1.7);
  fit(C, [[-F, -F, 0], [F, F, 0], [F, -F, 0], [-F, F, 0], [0, 0, FH + 4]], 200, 166);
  const P = proj(C), front = facing(C);
  const g = mk("g", {}, svg);
  const ZR = FH - 3;

  // frame: body, then its opening as a well, and the far inner wall
  const [fr, fi] = rings(-F, -F, F, F, 9, 2);
  put(solid(g), prism(P, front, fr, fi, 0, FH));
  const hole = circ(HOLE, 72);
  mk("path", { d: poly(hole.map((q) => P(q.u, q.v, FH))), class: "sil" }, g);
  mk("path", { d: open(hole.filter((q) => !front(q)).map((q) => P(q.u, q.v, ZR - 1))), class: "nf lo" }, g);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mk("ellipse", { cx: 0, cy: 0, class: "nf lo", ...(() => { const c = P(sx * (F - 7), sy * (F - 7), FH); return { cx: c[0], cy: c[1], rx: 3.2 * C.S, ry: 1.6 * C.S }; })() }, g);

  const shape = bladeShape();
  const blades = [];
  for (let b = 0; b < NB; b++) blades.push(mk("path", { class: b === 0 ? "hi" : "sil" }, g));
  const hub = solid(g);
  put(hub, prism(P, front, circ(HUB, 48), circ(HUB - 1.6, 48), ZR, FH + 3));
  mk("ellipse", (() => { const c = P(0, 0, FH + 3); return { cx: c[0], cy: c[1], rx: 6 * C.S * 0.71, ry: 6 * C.S * 0.36, class: "nf lo" }; })(), g);

  const duty = spring(FLOOR, { eps: 0.002 });
  function drawBlades() {
    if (ang === last) return;
    last = ang;
    const order = [];
    for (let b = 0; b < NB; b++) {
      const a = ang + (b / NB) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const w = shape.map(([u, v]) => [u * c - v * s, u * s + v * c]);
      order.push({ b, depth: w.reduce((t, p) => t + p[0] + p[1], 0), d: poly(w.map(([x, y]) => P(x, y, ZR))) });
    }
    order.sort((p, q) => p.depth - q.depth).forEach((o) => { blades[o.b].setAttribute("d", o.d); hub.g.before(blades[o.b]); });
  }

  // ambient: the rotor never stops, so tick always asks for another frame (rule 07 allows ambient motion)
  const B = register(stage, (dt) => {
    stepS(duty, dt);
    ang += duty.x * TURNS * Math.PI * 2 * dt;
    drawBlades();
    if (over) read.textContent = `${Math.round((duty.x * RPM) / 10) * 10} rpm`;
    return true;
  });
  bag.add(B.unregister);

  function retarget() {
    if (!over) { duty.t = FLOOR; read.textContent = "rest"; }
    else { const u = Math.hypot(over[0], over[1]) / reach; duty.t = clamp(1 - u * u * (1 - FLOOR), FLOOR, 1); }
    B.wake();
  }
  bag.add(pointer(stage, {
    move: (p) => { const w = unproj(C, p[0], p[1], FH); over = Math.max(Math.abs(w[0]), Math.abs(w[1])) < F ? w : null; retarget(); },
    leave: () => { over = null; retarget(); },
  }));
  bag.add(() => svg.replaceChildren());
  drawBlades();
  return { set: (v) => { reach = v; if (over) retarget(); }, destroy: bag.dispose };
}

hairline({
  name: "fan",
  means: "A case fan that never stops: the nearer the pointer to its hub, the faster it turns, down to a 25% floor.",
  rules: [3, 5, 7, 8],
  range: [40, 60, 85],
  tour: [[200, 166], [250, 190], [150, 140], null],
  mount,
});
}
