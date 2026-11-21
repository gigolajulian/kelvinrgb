const test = require('node:test');
const assert = require('node:assert');
const U = require('../lib/update');

test('version compare', () => {
  assert.ok(U.newer('0.2.10', '0.2.9'));
  assert.ok(U.newer('v1.0.0', '0.9.9'));
  assert.ok(!U.newer('0.2.2', '0.2.2'));
  assert.ok(!U.newer('0.2.1', '0.2.2'));
  assert.ok(!U.newer('latest', '0.2.2'));
  assert.ok(!U.newer('0.3', '0.2.2'));
});

const sha = 'a'.repeat(64);
test('release pick', () => {
  const ok = U.pick({ tag_name: 'v0.3.0', assets: [{ name: 'KelvinRGB Setup 0.3.0.exe.blockmap' }, { name: 'KelvinRGB-Setup-0.3.0.exe', browser_download_url: 'https://github.com/x', size: 5, digest: `sha256:${sha}` }] });
  assert.deepStrictEqual(ok, { v: '0.3.0', url: 'https://github.com/x', size: 5, sha, name: 'KelvinRGB-Setup-0.3.0.exe' });
  assert.ok(U.pick({ tag_name: 'v0.3.0', assets: [{ name: 'KelvinRGB-Setup-0.3.0.exe' }] }).error); // no digest, no install
  assert.ok(U.pick({ tag_name: 'v0.3.0', assets: [{ name: 'evil.exe', digest: `sha256:${sha}` }] }).error);
  assert.ok(U.pick(null).error);
});

test('a download that does not match the checksum never runs', async () => {
  const real = global.fetch;
  const rel = { tag_name: 'v9.0.0', assets: [{ name: 'KelvinRGB Setup 9.0.0.exe', browser_download_url: 'https://github.com/dl', size: 3, digest: `sha256:${sha}` }] };
  global.fetch = async (url) => url.includes('api.github.com')
    ? { status: 200, ok: true, json: async () => rel }
    : { ok: true, url: 'https://objects.githubusercontent.com/x', body: [Buffer.from('bad')] };
  try {
    let ran = false;
    const u = U.create({ version: '0.2.2', log() {}, onChange() {}, beforeInstall() {}, spawn: () => { ran = true; }, quit() {}, packaged: true });
    await u.check(true);
    assert.strictEqual(u.state.kind, 'available');
    await u.install();
    assert.strictEqual(u.state.kind, 'failed');
    assert.match(u.state.msg, /checksum/);
    assert.ok(!ran);
  } finally { global.fetch = real; }
});

test('quiet check failure stays quiet, manual one reports', async () => {
  const real = global.fetch;
  global.fetch = async () => ({ status: 404, ok: false });
  try {
    const seen = [];
    const u = U.create({ version: '0.2.2', log() {}, onChange: (s) => seen.push(s.kind), beforeInstall() {}, spawn() {}, quit() {}, packaged: true });
    await u.check(false);
    assert.strictEqual(u.state.kind, 'idle');
    await u.check(true);
    assert.deepStrictEqual(seen.slice(-2), ['checking', 'failed']);
    assert.match(u.view().text, /no public release/);
  } finally { global.fetch = real; }
});

test('sweep removes only our leftover installers', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'krgb-'));
  const ours = ['KelvinRGB-0b0c6c1e-1111-4222-8333-944455556666.exe', 'KelvinRGB-0b0c6c1e-1111-4222-8333-944455556667.msi'];
  for (const f of [...ours, 'KelvinRGB-notes.exe', 'other.exe']) fs.writeFileSync(path.join(dir, f), 'x');
  assert.strictEqual(U.sweep(dir), 2);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['KelvinRGB-notes.exe', 'other.exe']);
  fs.rmSync(dir, { recursive: true });
});

test('up to date still offers a check, then finds a later release', async () => {
  const real = global.fetch;
  const rel = (v) => ({ status: 200, ok: true, json: async () => ({ tag_name: `v${v}`, assets: [{ name: `KelvinRGB.Setup.${v}.exe`, size: 1, browser_download_url: 'https://github.com/x', digest: `sha256:${'a'.repeat(64)}` }] }) });
  try {
    const u = U.create({ version: '1.1.1', log() {}, onChange() {}, beforeInstall() {}, spawn() {}, quit() {}, packaged: true });
    global.fetch = async () => rel('1.1.1');
    await u.check(true);
    assert.strictEqual(u.state.kind, 'current');
    assert.strictEqual(u.view().action, 'check');
    global.fetch = async () => rel('1.1.3');
    await u.check(true);
    assert.strictEqual(u.view().action, 'install');
  } finally { global.fetch = real; }
});
