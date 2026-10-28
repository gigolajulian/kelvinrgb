// Hardware check for the sidecar, run elevated. Picks one fan header and walks it through:
// 100% -> 30% -> graceful exit (BIOS back) -> 60% -> hard kill -> restart (expect 100% hold).
// Writes progress to stdout. Usage: node scripts/fan-check.mjs [controlId]
import { spawn, execFileSync } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sidecar');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

function start() {
  const p = spawn(path.join(dir, 'sidecar.exe'), ['--floor', '25'], { cwd: dir });
  const sc = { p, tick: null, ready: null };
  readline.createInterface({ input: p.stdout }).on('line', (l) => {
    let m;
    try { m = JSON.parse(l); } catch { return; } // a hard kill can cut the last line short
    if (m.type === 'tick') sc.tick = m;
    else if (m.type === 'ready') { sc.ready = m; say('ready', JSON.stringify(m)); }
    else say('sidecar', l);
  });
  sc.ping = setInterval(() => sc.send({ cmd: 'ping' }), 1000);
  sc.send = (m) => { try { p.stdin.write(JSON.stringify(m) + '\n'); } catch {} };
  p.on('exit', (c) => { clearInterval(sc.ping); say('sidecar exit', c); });
  return sc;
}
const rpm = (sc, c) => {
  const h = sc.tick.hw.find((x) => x.name === c.hw);
  const s = h && h.sensors.find((x) => x.type === 'Fan' && x.index === c.index);
  return s ? Math.round(s.value) : null;
};
const ctl = (sc, id) => sc.tick.controls.find((c) => c.id === id);
async function settle(sc, id, label) {
  await sleep(9000);
  const c = ctl(sc, id);
  say(`${label}: ${rpm(sc, c)} rpm, duty ${c.value}%, mode ${c.mode}`);
}

let sc = start();
while (!sc.tick) await sleep(200);
for (const c of sc.tick.controls) say(`control ${c.id} "${c.name}" on ${c.hw}: ${rpm(sc, c)} rpm, ${c.value}%, ${c.mode}`);
const target = sc.tick.controls.find((c) => c.id === process.argv[2]) || [...sc.tick.controls].reverse().find((c) => rpm(sc, c) > 0);
if (!target) { say('no spinning fan header found'); sc.p.stdin.end(); process.exit(1); }
const id = target.id;
say(`testing ${id}`);

await settle(sc, id, 'baseline (bios)');
sc.send({ cmd: 'set', id, duty: 100 }); await settle(sc, id, 'set 100%');
sc.send({ cmd: 'set', id, duty: 30 }); await settle(sc, id, 'set 30%');
sc.send({ cmd: 'set', id, duty: 5 }); await settle(sc, id, 'asked 5% (floor should hold 25%)');

say('graceful exit: closing stdin');
sc.p.stdin.end();
await sleep(1500);
sc = start();
while (!sc.tick) await sleep(200);
await settle(sc, id, 'after graceful exit (expect bios)');

sc.send({ cmd: 'set', id, duty: 40 }); await settle(sc, id, 'set 40%');
say('hard kill: taskkill /F');
execFileSync('taskkill', ['/F', '/PID', String(sc.p.pid)]);
await sleep(1500);
sc = start();
while (!sc.tick) await sleep(200);
await settle(sc, id, `after hard kill, unclean=${sc.ready.unclean} (expect 100% hold)`);
sc.p.stdin.end();
await sleep(1500);
say('done');
process.exit(0);
