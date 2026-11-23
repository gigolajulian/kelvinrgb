const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const D = require('../lib/drivers');

test('cmp normalises tags and extra zeros', () => {
  assert.strictEqual(D.cmp('release_1.1', '1.1.0'), 0);
  assert.strictEqual(D.cmp('2.2.0.0', '2.2.0'), 0);
  assert.strictEqual(D.cmp('v1.0.0', '0.3.7'), 1);
  assert.strictEqual(D.cmp('1.2.9', '1.2.10'), -1);
  assert.strictEqual(D.cmp('', '1.0'), null);
});

test('windowsRows: maker driver, Windows driver after a reset, no driver, absent hardware', () => {
  const raw = {
    devices: [
      { id: 'PCI\\VEN_1002&DEV_73DF', name: 'Microsoft Basic Display Adapter', cls: 'DISPLAY', prov: 'Microsoft', ver: '10.0', err: 0 },
      { id: 'PCI\\VEN_1022&DEV_790B', name: 'AMD SMBus', cls: 'SYSTEM', prov: 'Advanced Micro Devices, Inc', ver: '5.12.0.44', err: 0 },
      { id: 'PCI\\VEN_1B73&DEV_1100', name: 'Universal Serial Bus (USB) Controller', cls: 'USB', prov: '', ver: '', err: 28 },
    ],
    packages: [{ name: 'AMD Chipset Software', ver: '8.09.28.1124' }],
  };
  const rows = Object.fromEntries(D.windowsRows(raw).map((r) => [r.id, r]));
  assert.deepStrictEqual(Object.keys(rows).sort(), ['chipset', 'fresco', 'radeon']);
  assert.strictEqual(rows.chipset.state, 'ok');
  assert.strictEqual(rows.chipset.installed, '8.09.28.1124'); // the package, not the SMBus driver
  assert.strictEqual(rows.radeon.state, 'inbox');
  assert.strictEqual(rows.radeon.installed, '');
  assert.strictEqual(rows.fresco.state, 'none');
});

function fakes(body, over = {}) {
  const log = [];
  const d = {
    fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => body }),
    write: (f) => log.push(['write', f]), remove: (f) => log.push(['remove', f]),
    guard: () => false, before: async () => log.push(['before']), after: async () => log.push(['after']),
    tempDir: 'C:\\Windows\\Temp', log: () => {}, ...over,
  };
  return { d, log };
}
const pin = (buf) => ({ url: 'https://codeberg.org/x/OpenRGB.msi', sha: crypto.createHash('sha256').update(buf).digest('hex') });

test('installPinned runs the verified file, then deletes it', async () => {
  const buf = Buffer.from('msi'), { d, log } = fakes(buf);
  let ran = '';
  await D.installPinned(pin(buf), async (f) => { ran = f; log.push(['run']); }, d);
  assert.match(ran, /^C:\\Windows\\Temp\\KelvinRGB-[0-9a-f-]{36}\.msi$/);
  assert.deepStrictEqual(log.map((x) => x[0]), ['write', 'before', 'run', 'remove', 'after']);
});

test('installPinned refuses a file whose hash does not match', async () => {
  const { d, log } = fakes(Buffer.from('tampered'));
  await assert.rejects(D.installPinned(pin(Buffer.from('msi')), async () => {}, d), /checksum/);
  assert.strictEqual(log.length, 0);
});

test('installPinned stops if Apex starts during the download', async () => {
  const buf = Buffer.from('msi');
  let n = 0;
  const { d, log } = fakes(buf, { guard: () => n++ > 0 });
  await assert.rejects(D.installPinned(pin(buf), async () => {}, d), /Apex/);
  assert.strictEqual(log.length, 0);
});

test('installPinned deletes the file when the installer fails', async () => {
  const buf = Buffer.from('msi'), { d, log } = fakes(buf);
  await assert.rejects(D.installPinned(pin(buf), async () => { throw new Error('exit 1603'); }, d), /1603/);
  assert.deepStrictEqual(log.map((x) => x[0]), ['write', 'before', 'remove', 'after']);
});

test('tone: green current, orange behind, red missing or a major behind, grey unknown', () => {
  assert.strictEqual(D.tone({ installed: '1.1.0', latest: 'release_1.1' }), 'ok');
  assert.strictEqual(D.tone({ installed: '1.0.0', latest: '1.1.0' }), 'warn');
  assert.strictEqual(D.tone({ installed: '0.9.0', latest: '1.1.0' }), 'bad');
  assert.strictEqual(D.tone({ installed: '', latest: '1.1.0' }), 'bad');
  assert.strictEqual(D.tone({ installed: '2.2.0', latest: '' }), 'dim');
  const w = (o) => D.tone({ windows: true, state: 'ok', inboxOk: false, ...o });
  assert.strictEqual(w({ wu: '' }), 'ok');
  assert.strictEqual(w({ wu: 'AMD - Display - 32.0.1' }), 'warn');
  assert.strictEqual(w({ wu: null }), 'dim');
  assert.strictEqual(w({ state: 'none', wu: '' }), 'bad');
  assert.strictEqual(w({ state: 'inbox', wu: '' }), 'bad');
  assert.strictEqual(w({ state: 'inbox', inboxOk: true, wu: '' }), 'ok');
});

test('windowsRows marks a Windows Update offer for that maker', () => {
  const raw = { devices: [{ id: 'PCI\\VEN_8086&DEV_2526', name: 'Intel Wi-Fi', cls: 'NET', prov: 'Intel', ver: '24.40.0.4', err: 0 }], packages: [] };
  assert.strictEqual(D.windowsRows(raw, [{ provider: 'Intel', model: 'x', title: 'Intel - Net - 24.60.0.1' }])[0].tone, 'warn');
  assert.strictEqual(D.windowsRows(raw, [{ provider: 'Intel', model: 'x', title: 'Intel - Bluetooth - 24.90.0.1' }])[0].tone, 'ok'); // another Intel device
  assert.strictEqual(D.windowsRows(raw, [{ provider: 'Contoso', model: 'Intel Wi-Fi', title: 'x' }])[0].tone, 'warn'); // matched by model
  assert.strictEqual(D.windowsRows(raw, [])[0].tone, 'ok');
  assert.strictEqual(D.windowsRows(raw, null)[0].tone, 'dim');
});

test('OpenRGB server is started on loopback only', () => {
  const a = D.OPENRGB.args;
  assert.ok(a.includes('--server'));
  const i = a.indexOf('--server-host');
  assert.ok(i >= 0, 'no --server-host: OpenRGB would decide where its unauthenticated port listens');
  assert.strictEqual(a[i + 1], '127.0.0.1');
});
