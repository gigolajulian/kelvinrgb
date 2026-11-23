// Drivers page: what Windows has installed for this PC's hardware, and the one installer KelvinRGB runs itself.
// Pure helpers; main.js passes in the raw Windows data and the real fetch / spawn / delete, tests pass fakes.
const crypto = require('node:crypto');
const path = require('node:path');

// Versions as numbers: 'release_1.1', 'v1.1.0' and '1.1.0.0' are all 1.1. Missing parts count as 0.
function parts(v) { const m = String(v ?? '').match(/\d+(\.\d+)*/); return m ? m[0].split('.').map(Number) : null; }
function cmp(a, b) {
  const x = parts(a), y = parts(b);
  if (!x || !y) return null; // unknown: never "newer"
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return Math.sign(d); }
  return 0;
}

// Third-party drivers by hardware vendor, so the list also works right after a Windows reset: the hardware is
// there, but on Microsoft's inbox driver (or none). Each row shows only when its hardware is present.
// inbox: Windows' own driver is fine for it. pkg: the Uninstall entry whose DisplayVersion is the package version; without it the device driver's version shows.
const CATALOG = [
  { id: 'chipset', name: 'AMD chipset', what: 'Board drivers: GPIO, SMBus, PSP.', hw: /PCI\\VEN_1022/i, cls: /^(SYSTEM|SECURITYDEVICES)$/, prov: /Advanced Micro Devices/i, pkg: /^AMD Chipset Software$/i, url: 'https://www.amd.com/en/support/download/drivers.html' },
  { id: 'radeon', name: 'AMD Software', what: 'Radeon graphics driver.', hw: /PCI\\VEN_1002/i, cls: /^DISPLAY$/, prov: /Advanced Micro Devices|^AMD/i, pkg: /^AMD Software$/i, url: 'https://www.amd.com/en/support/download/drivers.html' },
  { id: 'nvidia', name: 'NVIDIA graphics', what: 'GeForce graphics driver.', hw: /PCI\\VEN_10DE/i, cls: /^DISPLAY$/, prov: /NVIDIA/i, url: 'https://www.nvidia.com/en-us/drivers/' },
  { id: 'wifi', name: 'Intel Wi-Fi', what: 'Wireless network card.', hw: /PCI\\VEN_8086/i, cls: /^NET$/, prov: /Intel/i, url: 'https://www.intel.com/content/www/us/en/support/intel-driver-support-assistant.html' },
  { id: 'bt', name: 'Intel Bluetooth', what: 'Bluetooth on the Wi-Fi card.', hw: /USB\\VID_8087/i, cls: /^BLUETOOTH$/, prov: /Intel/i, url: 'https://www.intel.com/content/www/us/en/support/intel-driver-support-assistant.html' },
  { id: 'realtek', name: 'Realtek network', what: 'Wired network on the board.', hw: /PCI\\VEN_10EC/i, cls: /^NET$/, prov: /Realtek/i, inbox: true, url: 'https://www.realtek.com/Download/List?cate_id=584' },
  { id: 'fresco', name: 'Fresco Logic USB 3', what: 'USB 3 card. Windows has no driver for it.', hw: /PCI\\VEN_1B73/i, cls: /^USB$/, prov: /Fresco/i, pkg: /^Fresco Logic USB3/i, url: 'https://www.frescologic.com/support' },
  { id: 'steelseries', name: 'SteelSeries GG', what: 'SteelSeries mouse, headset and Sonar audio.', hw: /USB\\VID_1038/i, cls: /^HIDCLASS$/, prov: /SteelSeries/i, pkg: /^SteelSeries GG/i, url: 'https://steelseries.com/gg' },
  { id: 'logitech', name: 'Logitech', what: 'Logitech receiver, mouse or keyboard.', hw: /USB\\VID_046D/i, cls: /^HIDCLASS$/, prov: /Logitech/i, pkg: /^Logi Options/i, url: 'https://www.logitech.com/software/logi-options-plus.html' },
  { id: 'btdongle', name: 'USB Bluetooth dongle', what: 'Plug-in Bluetooth adapter.', hw: /USB\\VID_(19FF|0A5C|0A12|2B89)/i, cls: /^BLUETOOTH$/, prov: /Broadcom|Realtek|CSR|Cambridge|Intel/i, inbox: true, url: 'https://support.microsoft.com/windows/fix-bluetooth-problems-in-windows-723e092f-03fa-858b-5c80-131ec3fba75c' },
  { id: 'hp', name: 'HP printer', what: 'Printer and scanner.', hw: /VID_03F0|\bHP\b|Hewlett/i, cls: /^(PRINTER|IMAGE)$/, prov: /^HP|Hewlett/i, url: 'https://support.hp.com/drivers' },
];

// raw: { devices: [{ id, name, cls, prov, ver, err }], packages: [{ name, ver }] } from one PowerShell call.
// state: ok (maker's driver), inbox (Windows' own driver), none (no driver at all).
// wu: driver updates Windows Update offers ([{ provider, model, title }]), or null when that check failed.
function windowsRows(raw, wu = null) {
  const devs = raw.devices || [], pkgs = raw.packages || [];
  const out = [];
  for (const c of CATALOG) {
    const mine = devs.filter((d) => c.hw.test(`${d.id || ''} ${d.name || ''}`) && (c.cls.test(String(d.cls || '').toUpperCase()) || d.err === 28));
    if (!mine.length) continue;
    const ok = mine.find((d) => c.prov.test(d.prov || '') && !d.err);
    const pkg = c.pkg && pkgs.find((p) => c.pkg.test(p.name || ''));
    const state = ok ? 'ok' : mine.some((d) => !d.err) ? 'inbox' : 'none';
    // An offer belongs to this row by its device name, or by maker plus device class ("Intel - Net - 24.60"),
    // so one Intel Bluetooth update does not turn the Intel Wi-Fi row orange.
    const offer = wu && wu.find((u) => mine.some((d) => (d.name && String(u.model || '').toLowerCase() === d.name.toLowerCase())
      || (c.prov.test(u.provider || '') && /^\w+$/.test(d.cls || '') && new RegExp(` - ${d.cls} - `, 'i').test(u.title || ''))));
    out.push({ id: c.id, name: c.name, what: c.what, device: (ok || mine[0]).name || '', state, inboxOk: !!c.inbox, installed: ok ? String(pkg ? pkg.ver : ok.ver) : '', url: c.url,
      wu: wu ? (offer ? String(offer.title || 'update') : '') : null }); // null: not checked, '': nothing newer
  }
  for (const r of out) r.tone = tone({ ...r, windows: true });
  return out;
}

// Status colour, the same rule for every row:
//   ok (green): on the latest we can see.  warn (orange): an update is out.
//   bad (red): missing, on Windows' basic driver where the maker's is needed, or a whole major version behind.
//   dim (grey): no way to check.
function tone(r) {
  if (r.windows) {
    if (r.state === 'none' || (r.state === 'inbox' && !r.inboxOk)) return 'bad';
    if (r.wu) return 'warn';
    return r.wu === '' || r.state === 'inbox' ? 'ok' : 'dim';
  }
  if (!r.installed) return 'bad';
  if (!r.latest) return 'dim';
  const c = cmp(r.latest, r.installed);
  if (c === null) return 'dim';
  if (c <= 0) return 'ok';
  return (parts(r.latest)[0] || 0) > (parts(r.installed)[0] || 0) ? 'bad' : 'warn';
}
const pkgVer = (raw, re) => { const p = (raw.packages || []).find((x) => re.test(x.name || '')); return p ? String(p.ver) : ''; };

// OpenRGB's MSI is not signed, so KelvinRGB installs only this exact file. A newer release opens its page instead.
const OPENRGB = {
  v: '1.1.0',
  url: 'https://codeberg.org/OpenRGB/OpenRGB/releases/download/release_1.1/OpenRGB_1.1_Windows_64_8e16de2.msi',
  sha: 'a4ce48a5e1532750ad4f5248424d42f7f2c710775cee88db070ccdb63c549caa',
  page: 'https://codeberg.org/OpenRGB/OpenRGB/releases',
  api: 'https://codeberg.org/api/v1/repos/OpenRGB/OpenRGB/releases/latest',
  // Loopback only: the SDK port has no password, so other devices on the network must not reach it.
  args: ['--server', '--server-host', '127.0.0.1', '--startminimized'],
};

// Download, check the hash, write to an admin-owned temp folder under a random name, run, delete.
// run(file) -> Promise. d: { fetch, write(file, buf), remove(file), guard() -> bool, before(), after(), tempDir, log }
async function installPinned(pin, run, d) {
  if (d.guard()) throw new Error('Apex is running');
  const r = await d.fetch(pin.url, { headers: { 'User-Agent': 'KelvinRGB' } });
  if (!r.ok) throw new Error(`download failed (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (crypto.createHash('sha256').update(buf).digest('hex') !== pin.sha) throw new Error('checksum does not match, not installing');
  if (d.guard()) throw new Error('Apex is running'); // it may have started during the download
  const file = path.join(d.tempDir, `KelvinRGB-${crypto.randomUUID()}${path.extname(new URL(pin.url).pathname)}`);
  d.write(file, buf);
  try {
    await d.before();
    await run(file);
  } finally {
    try { d.remove(file); } catch (e) { d.log(`drivers: could not delete ${file}: ${e.message}`); }
    await d.after();
  }
}

module.exports = { cmp, tone, CATALOG, windowsRows, pkgVer, OPENRGB, installPinned };
