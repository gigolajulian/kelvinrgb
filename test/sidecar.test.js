// The sidecar's safety loop (sidecar/pump.cs), compiled with Windows' csc into a harness with fake fans
// (sidecar/selftest.cs). No LibreHardwareMonitor and no admin needed. Windows only, like the app.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..', 'sidecar');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'krgb-sidecar-'));
const exe = path.join(dir, 'selftest.exe');
const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
execFileSync(csc, ['/nologo', '/platform:x64', '/target:exe', `/out:${exe}`, path.join(root, 'pump.cs'), path.join(root, 'selftest.cs')]);
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// Starts the harness; resolves with its output and exit code. steps(p) drives stdin.
function run(args, steps, ms = 8000) {
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, { windowsHide: true });
    let out = '';
    const kill = setTimeout(() => { p.kill(); reject(new Error(`no exit in ${ms} ms: ${out}`)); }, ms);
    p.stdout.on('data', (d) => { out += d; });
    p.on('exit', (code) => { clearTimeout(kill); resolve({ out, code }); });
    steps(p, () => out);
  });
}
const until = async (get, re, ms = 5000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (re.test(get())) return; throw new Error(`never saw ${re}: ${get()}`); };

test('sidecar: the app closing or being killed hands every fan back, then the sidecar exits', async () => {
  const { out, code } = await run(['pump', '60000'], async (p, get) => {
    await until(get, /ready/);
    p.stdin.write('set\nset\n');
    await new Promise((r) => setTimeout(r, 300));
    p.stdin.end(); // what a killed parent looks like from here: stdin closes
  });
  assert.match(out, /restored 2\r?\nexit/);
  assert.strictEqual(code, 0);
});

test('sidecar: an app that stops talking gets its fans handed back by the watchdog', async () => {
  const { out } = await run(['pump', '400'], async (p, get) => {
    await until(get, /ready/);
    p.stdin.write('set\n');
    await until(get, /restored 1/, 3000); // still running, nothing sent for 400 ms
    p.stdin.end();
  });
  assert.match(out, /watchdog: app silent/);
});

test('sidecar: a crash hands the fans back before the process dies', async () => {
  const { out, code } = await run(['pump', '60000'], async (p, get) => {
    await until(get, /ready/);
    p.stdin.write('set\ncrash\n');
  });
  assert.match(out, /log crash: .*boom/);
  assert.match(out, /restored 1/);
  assert.notStrictEqual(code, 0);
});

test('sidecar: boot time stays right past 24.9 days of uptime (the crash marker compares it)', () => {
  const now = Date.UTC(2026, 0, 31); // the harness's fixed "now"
  const TICKS = 10000; // .NET ticks per ms
  const EPOCH = 621355968000000000n; // .NET ticks at 1970-01-01
  for (const days of [1, 24, 25, 30, 60]) {
    const ms = days * 86400e3;
    const ticks = BigInt(execFileSync(exe, ['boot', String(ms)]).toString().trim());
    assert.strictEqual(ticks, EPOCH + BigInt(now - ms) * BigInt(TICKS), `${days} days of uptime`);
  }
});
