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
