// Called by main.js with executeJavaScript: step(i, secs) as start-up steps finish (1..4), done() to fade out.
const N = 4;
window.step = (i, secs) => {
  i = Math.max(0, Math.min(N, i | 0));
  document.getElementById('prog').style.strokeDashoffset = 390 - 390 * (i / N);
  document.querySelectorAll('#steps li').forEach((li, j) => {
    li.className = j < i ? 'ok' : j === i ? 'run' : '';
    if (secs && j === i - 1 && li.lastElementChild.textContent === '') li.lastElementChild.textContent = `${secs}s`;
  });
};
window.done = () => { window.step(N, ''); document.getElementById('d').classList.add('done'); };
