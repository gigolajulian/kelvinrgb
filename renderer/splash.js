// Called by main.js with executeJavaScript: step(i, secs) as start-up steps finish (1..4), done(reached) to fade out.
const N = 4;
window.step = (i, secs) => {
  i = Math.max(0, Math.min(N, i | 0));
  document.getElementById('prog').style.strokeDashoffset = 390 - 390 * (i / N);
  document.querySelectorAll('#steps li').forEach((li, j) => {
    li.className = j < i ? 'ok' : j === i ? 'run' : '';
    if (secs && j === i - 1 && li.lastElementChild.textContent === '') li.lastElementChild.textContent = `${secs}s`;
  });
};
// Points past `reached` never finished (no OpenRGB, no admin, the game started): marked skipped, not ticked.
// With skipped points the tile holds 1.2 s longer so they can be read (main.js waits to match).
window.done = (reached = N) => {
  const fade = () => document.getElementById('d').classList.add('done');
  if (reached >= N) { window.step(N, ''); return fade(); }
  document.querySelectorAll('#steps li').forEach((li, j) => { if (j >= reached) { li.className = 'skip'; li.lastElementChild.textContent = 'skipped'; } });
  setTimeout(fade, 1200);
};
