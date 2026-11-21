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
