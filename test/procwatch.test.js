// sidecar/procwatch.cs: the resident process lister the Apex guard reads instead of starting tasklist.exe every 4 s.
// Compiled with Windows' csc into a temp folder. Windows only, like the app.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const C = require('../lib/conflicts');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'krgb-procwatch-'));
const exe = path.join(dir, 'procwatch.exe');
const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
execFileSync(csc, ['/nologo', '/platform:x64', '/target:exe', `/out:${exe}`, path.join(__dirname, '..', 'sidecar', 'procwatch.cs')]);
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// Starts the lister; lists() returns every complete list so far, parsed the way main.js parses tasklist.
function watch(ms) {
  const p = spawn(exe, [String(ms)], { windowsHide: true });
  let buf = '';
  const got = [];
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (d) => { buf += d; for (let i; (i = buf.indexOf('\n\n')) >= 0; buf = buf.slice(i + 2)) got.push(C.parse(buf.slice(0, i))); });
  return { p, lists: () => got, exited: new Promise((r) => p.once('exit', r)) };
}
const until = async (ok, ms = 5000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (ok()) return; throw new Error('timed out'); };

test('procwatch: lists processes like tasklist, sees one start and stop, and exits when the app goes', async () => {
  const w = watch(200);
  const ping = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'PING.EXE'), ['-n', '60', '127.0.0.1'], { windowsHide: true, stdio: 'ignore' });
  try {
    const has = (l) => l.some((x) => x.name.toLowerCase() === 'ping.exe' && x.pid === ping.pid);
    await until(() => w.lists().some(has));
    const self = w.lists().at(-1).find((x) => x.pid === w.p.pid);
    assert.strictEqual(self && self.name, 'procwatch.exe', 'image names carry .exe, as tasklist shows them');
    ping.kill();
    const seen = w.lists().length;
    await until(() => w.lists().length > seen + 1 && !has(w.lists().at(-1)));
  } finally { ping.kill(); }
  w.p.stdin.end(); // what KelvinRGB quitting or dying looks like from here
  assert.strictEqual(await Promise.race([w.exited, new Promise((r) => setTimeout(() => r('still running'), 3000))]), 0);
});
