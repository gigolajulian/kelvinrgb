// Called by main.js with executeJavaScript: step(i, secs) as start-up points finish (1..4), done(reached) to fade out.
// The ring is a spring chasing an honest target: the edge of what really finished, plus an estimate for the running
// point that grows fast at first and flattens out, capped at 96% of that point's share. It never stops, never jumps,
// and never shows a point done before main.js says so.
const C = 390; // ring circumference (r 62)
const SHARE = [.12, .16, .12, .60]; // game check, OpenRGB, lighting, sensors
const EXP = [300, 1300, 300, 10400]; // expected ms for each point after the one before it (log, 2026-11-24)
const prog = document.getElementById('prog'), d = document.getElementById('d');
const lis = [...document.querySelectorAll('#steps li')], N = lis.length;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const edge = (i) => SHARE.slice(0, i).reduce((a, b) => a + b, 0); // ring fraction once i points are done
let shown = 0, runAt = performance.now(), last = runAt, x = 0, v = 0, honest = null, stopped = false;

function target(now) {
  if (honest != null) return honest;
  if (reduced.matches || shown >= N) return edge(shown);
  return edge(shown) + SHARE[shown] * .96 * (1 - Math.exp(-(now - runAt) / (EXP[shown] / 2)));
}
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  const t = target(now);
  if (reduced.matches) { x = t; v = 0; } else {
    const w = shown >= N ? 16 : 9; // stiffer on the last close so the ring shuts before the fade
    v += (w * w * (t - x) - 2 * w * v) * dt; x += v * dt;
    if (honest == null && x > t) { x = t; v = Math.min(v, 0); } // never ahead of the truth
  }
  prog.style.strokeDashoffset = C - C * Math.max(0, x);
  if (shown >= N && x > .995) d.classList.add('full');
  const li = lis[shown]; // the running row counts up, so the long sensors scan still looks alive
  if (li && honest == null) li.lastElementChild.textContent = `${((now - runAt) / 1000).toFixed(1)}s`;
  if (!stopped) requestAnimationFrame(frame);
}
const paint = () => lis.forEach((li, j) => { li.className = j < shown ? 'ok' : j === shown ? 'run' : ''; });
paint(); requestAnimationFrame(frame);

window.step = (i, secs) => {
  shown = Math.max(0, Math.min(N, i | 0)); runAt = performance.now();
  paint();
  if (secs && shown) lis[shown - 1].lastElementChild.textContent = `${secs}s`;
};
// Points past `reached` never finished (no OpenRGB, no admin, the game started): marked skipped, not ticked,
// and the ring gives back its estimate. With skipped points the tile holds 1.2 s longer (main.js waits to match).
window.done = (reached = N) => {
  const fade = () => { d.classList.add('done'); setTimeout(() => { stopped = true; }, 500); };
  if (reached >= N) { if (shown < N) window.step(N, ''); return fade(); }
  honest = edge(reached);
  lis.forEach((li, j) => { if (j >= reached) { li.className = 'skip'; li.lastElementChild.textContent = 'skipped'; } });
  setTimeout(fade, 1200);
};
