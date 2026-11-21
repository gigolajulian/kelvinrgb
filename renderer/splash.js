// Called by main.js with executeJavaScript: step(0..4) as start-up steps finish, done() to open into the app.
const HUES = ['#ff8a3d', '#ffc79a', '#fff4e6', '#c4e6ec', '#8fd3e0'];
window.step = (i) => {
  const h = HUES[Math.max(0, Math.min(HUES.length - 1, i | 0))];
  document.getElementById('c').style.setProperty('--hue', h);
  document.getElementById('seg').setAttribute('stroke', h);
};
window.done = () => document.getElementById('c').classList.add('done');
