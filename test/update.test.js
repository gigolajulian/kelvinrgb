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
  const ok = U.pick({ tag_name: 'v0.3.0', assets: [{ name: 'KelvinRGB Setup 0.3.0.exe.blockmap' }, { name: 'KelvinRGB-Setup-0.3.0.exe', browser_download_url: 'https://github.com/x', size: 5, digest: `sha256:${sha}` }, { name: 'KelvinRGB-Setup-0.3.0.exe.sig', browser_download_url: 'https://github.com/sig' }] });
  assert.deepStrictEqual(ok, { v: '0.3.0', url: 'https://github.com/x', size: 5, sha, name: 'KelvinRGB-Setup-0.3.0.exe', sigUrl: 'https://github.com/sig' });
  assert.match(U.pick({ tag_name: 'v0.3.0', assets: [{ name: 'KelvinRGB-Setup-0.3.0.exe', digest: `sha256:${sha}` }] }).error, /not signed/);
  assert.match(U.pick({ tag_name: 'v0.4.0', assets: [{ name: 'KelvinRGB-Setup-0.3.0.exe', digest: `sha256:${sha}` }, { name: 'KelvinRGB-Setup-0.3.0.exe.sig' }] }).error, /version/);
  assert.ok(U.pick({ tag_name: 'v0.3.0', assets: [{ name: 'KelvinRGB-Setup-0.3.0.exe' }] }).error); // no digest, no install
  assert.ok(U.pick({ tag_name: 'v0.3.0', assets: [{ name: 'evil.exe', digest: `sha256:${sha}` }] }).error);
  assert.ok(U.pick(null).error);
});

test('a download that does not match the checksum never runs', async () => {
  const real = global.fetch;
  const rel = { tag_name: 'v9.0.0', assets: [{ name: 'KelvinRGB Setup 9.0.0.exe', browser_download_url: 'https://github.com/dl', size: 3, digest: `sha256:${sha}` }, { name: 'KelvinRGB Setup 9.0.0.exe.sig', browser_download_url: 'https://github.com/sig' }] };
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
  const rel = (v) => ({ status: 200, ok: true, json: async () => ({ tag_name: `v${v}`, assets: [{ name: `KelvinRGB.Setup.${v}.exe`, size: 1, browser_download_url: 'https://github.com/x', digest: `sha256:${'a'.repeat(64)}` }, { name: `KelvinRGB.Setup.${v}.exe.sig` }] }) });
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

test('signature: only the release key, only this version and file', () => {
  const crypto = require('node:crypto');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const sig = crypto.sign(null, Buffer.from(`KelvinRGB 1.2.3 ${sha}
`), privateKey).toString('base64');
  assert.ok(U.signed('1.2.3', sha, sig, pub));
  assert.ok(!U.signed('1.2.4', sha, sig, pub)); // an old installer re-posted as a newer version
  assert.ok(!U.signed('1.2.3', 'b'.repeat(64), sig, pub));
  assert.ok(!U.signed('1.2.3', sha, sig)); // a key other than the shipped one
  assert.ok(!U.signed('1.2.3', sha, 'garbage', pub));
});

test('a download with the right checksum but no valid signature never runs', async () => {
  const real = global.fetch;
  const body = Buffer.from('installer');
  const good = require('node:crypto').createHash('sha256').update(body).digest('hex');
  const rel = { tag_name: 'v9.0.0', assets: [{ name: 'KelvinRGB.Setup.9.0.0.exe', browser_download_url: 'https://github.com/dl', size: body.length, digest: `sha256:${good}` }, { name: 'KelvinRGB.Setup.9.0.0.exe.sig', browser_download_url: 'https://github.com/sig' }] };
  const logs = [];
  global.fetch = async (url) => url.includes('api.github.com') ? { status: 200, ok: true, json: async () => rel }
    : url.endsWith('/sig') ? { ok: true, text: async () => Buffer.alloc(64).toString('base64') }
    : { ok: true, url: 'https://objects.githubusercontent.com/x', body: [body] };
  try {
    let ran = false;
    const u = U.create({ version: '0.2.2', log: (m) => logs.push(m), onChange() {}, beforeInstall() {}, spawn: () => { ran = true; }, quit() {}, packaged: true });
    await u.check(true);
    await u.install();
    assert.strictEqual(u.state.kind, 'failed');
    assert.match(u.state.msg, /signature/);
    assert.ok(logs.some((m) => /signature does not match/.test(m)));
    assert.ok(!ran);
  } finally { global.fetch = real; }
});

const release = (size) => ({ tag_name: 'v9.0.0', assets: [{ name: 'KelvinRGB Setup 9.0.0.exe', browser_download_url: 'https://github.com/dl', size, digest: `sha256:${sha}` }, { name: 'KelvinRGB Setup 9.0.0.exe.sig', browser_download_url: 'https://github.com/sig' }] });

test('every GitHub call carries a timeout, so a dead network never hangs the updater', async () => {
  const real = global.fetch;
  const seen = [];
  global.fetch = async (url, opts) => {
    if (!(opts && opts.signal instanceof AbortSignal)) throw new Error(`no timeout on ${url}`);
    seen.push(url);
    if (url.includes('api.github.com')) return { status: 200, ok: true, json: async () => release(3) };
    if (url.endsWith('/sig')) return { ok: true, text: async () => 'not a signature' };
    return { ok: true, url: 'https://objects.githubusercontent.com/x', body: [Buffer.from('abc')] };
  };
  try {
    const u = U.create({ version: '1.0.0', log() {}, onChange() {}, beforeInstall() {}, spawn() {}, quit() {}, packaged: true });
    await u.check(true);
    assert.strictEqual(u.state.kind, 'available', u.state.msg);
    await u.install();
    assert.doesNotMatch(u.state.msg || '', /no timeout/);
    assert.strictEqual(seen.length, 2); // check + download; the checksum stops it before the signature
  } finally { global.fetch = real; }
});

test('the signature fetch carries a timeout too', async () => {
  const real = global.fetch;
  const body = Buffer.from('abc');
  const digest = require('node:crypto').createHash('sha256').update(body).digest('hex');
  const rel = { tag_name: 'v9.0.0', assets: [{ name: 'KelvinRGB Setup 9.0.0.exe', browser_download_url: 'https://github.com/dl', size: 3, digest: `sha256:${digest}` }, { name: 'KelvinRGB Setup 9.0.0.exe.sig', browser_download_url: 'https://github.com/sig' }] };
  global.fetch = async (url, opts) => {
    if (!(opts && opts.signal instanceof AbortSignal)) throw new Error(`no timeout on ${url}`);
    if (url.includes('api.github.com')) return { status: 200, ok: true, json: async () => rel };
    if (url.endsWith('/sig')) return { ok: true, text: async () => 'not a signature' };
    return { ok: true, url: 'https://objects.githubusercontent.com/x', body: [body] };
  };
  try {
    const u = U.create({ version: '1.0.0', log() {}, onChange() {}, beforeInstall() {}, spawn() {}, quit() {}, packaged: true });
    await u.check(true);
    await u.install();
    assert.match(u.state.msg, /signature does not match/);
  } finally { global.fetch = real; }
});

test('a download bigger than the release stops early and never runs', async () => {
  const real = global.fetch;
  let pulled = 0;
  async function* body() { for (let i = 0; i < 100; i++) { pulled++; yield Buffer.alloc(1024); } }
  global.fetch = async (url) => url.includes('api.github.com')
    ? { status: 200, ok: true, json: async () => release(1500) }
    : { ok: true, url: 'https://objects.githubusercontent.com/x', body: body() };
  try {
    let ran = false;
    const u = U.create({ version: '1.0.0', log() {}, onChange() {}, beforeInstall() {}, spawn: () => { ran = true; }, quit() {}, packaged: true });
    await u.check(true);
    await u.install();
    assert.strictEqual(u.state.kind, 'failed');
    assert.match(u.state.msg, /bigger than the release/);
    assert.ok(pulled <= 3, `kept downloading: ${pulled} chunks`);
    assert.ok(!ran);
  } finally { global.fetch = real; }
});
