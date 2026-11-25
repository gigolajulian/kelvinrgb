// Updates from GitHub releases, no extra dependencies.
// Check: the latest release's tag against our version. Install: download the setup exe, check its sha256 against
// the digest GitHub publishes for the asset and its signature (the .sig asset), then run it silently and quit.
// The app runs as admin, so the file goes to an admin-owned folder under a random name, never somewhere a normal
// user can swap it.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO = 'gigolajulian/kelvinrgb';
const RELEASES = `https://github.com/${REPO}/releases`;
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const TIMEOUT = 10000; // each call gives up after 10 s; the next quiet check is 6 h later
const MAX_BYTES = 300 * 1024 * 1024; // no installer is this big
const DOWNLOAD_TIMEOUT = 15 * 60 * 1000; // a stalled installer download gives up after 15 min
const ASSET = /^KelvinRGB[ .-]Setup[ .-](\d+\.\d+\.\d+)\.exe$/i;

// Public halves of the release keys. The private halves never touch GitHub (scripts/sign-release.js runs on Julian's
// PC), so someone who takes over the GitHub account can upload an installer and its checksum, but not a signature.
// Signed text: "KelvinRGB <version> <sha256>\n", so an old signed installer can't be re-posted as a newer version.
// HELLO: the everyday key, RSA-2048 held by Windows Hello in the PC's TPM (can't be copied off it, a fingerprint or
// PIN per signature). RECOVERY: the passphrase-locked ed25519 key, kept for when the Hello key is lost (README).
const HELLO = '';
const RECOVERY = 'MCowBQYDK2VwAyEA8gcyEU9pjNP2Vp6fuBZe3IQmxU4Wdn8V2VxFNjuh0CQ=';
const KEYS = [HELLO, RECOVERY];
// the algorithm comes from the trusted key, never from the .sig file
const ALG = { ed25519: null, rsa: 'sha256' };
function signed(v, sha, sig, keys = KEYS) {
  const text = Buffer.from(`KelvinRGB ${v} ${sha}\n`), s = Buffer.from(String(sig).trim(), 'base64');
  return [].concat(keys).some((key) => {
    try {
      const k = crypto.createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' });
      return k.asymmetricKeyType in ALG && crypto.verify(ALG[k.asymmetricKeyType], text, k, s);
    } catch { return false; }
  });
}

// 1.2.10 > 1.2.9; a leading v is ignored; anything unparsable is never newer.
function newer(a, b) {
  const p = (v) => String(v).replace(/^v/i, '').split('-')[0].split('.').map(Number);
  const x = p(a), y = p(b);
  if (x.length !== 3 || y.length !== 3 || [...x, ...y].some((n) => !Number.isInteger(n))) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

// Picks what we need from the API answer, or says why not.
function pick(rel) {
  const v = String(rel?.tag_name || '').replace(/^v/i, '');
  const a = (rel?.assets || []).find((x) => ASSET.test(x.name));
  if (!v || !a) return { error: 'no installer in the latest release' };
  if (ASSET.exec(a.name)[1] !== v) return { error: 'installer version does not match the release' };
  const sha = /^sha256:([0-9a-f]{64})$/i.exec(a.digest || '');
  if (!sha) return { error: 'release has no checksum' };
  const sig = (rel.assets || []).find((x) => x.name === `${a.name}.sig`);
  if (!sig) return { error: 'release is not signed' };
  return { v, url: a.browser_download_url, size: a.size, sha: sha[1].toLowerCase(), name: a.name, sigUrl: sig.browser_download_url };
}

function create({ version, log, onChange, beforeInstall, spawn, quit, packaged, dir = path.join(process.env.SystemRoot || 'C:\\Windows', 'Temp'), key = KEYS }) {
  let state = { kind: 'idle' }; // idle | checking | current | available | downloading | installing | failed
  let rel = null, manual = false;
  const set = (s) => { state = s; onChange(state); };

  async function check(isManual) {
    if (['checking', 'downloading', 'installing'].includes(state.kind)) return;
    manual = !!isManual;
    if (manual) set({ kind: 'checking' });
    try {
      const r = await fetch(API, { headers: { 'User-Agent': 'KelvinRGB', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(TIMEOUT) });
      if (r.status === 404) throw new Error('no public release yet');
      if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
      const p = pick(await r.json());
      if (p.error) throw new Error(p.error);
      rel = p;
      if (newer(p.v, version)) { log(`update: ${p.v} available`); set({ kind: 'available', v: p.v }); }
      else set(manual ? { kind: 'current' } : { kind: 'idle' });
    } catch (e) {
      log(`update check: ${e.message}`);
      set(manual ? { kind: 'failed', msg: e.message } : { kind: 'idle' }); // a quiet check stays quiet
    }
  }

  async function install() {
    if (state.kind !== 'available' || !rel) return;
    if (!packaged) return set({ kind: 'failed', msg: 'installs only from the installed app' });
    const v = rel.v;
    // Admin-owned temp, random name, refuse to reuse an existing file. The download streams into it while it is
    // hashed, so the installer is never held in memory; it runs only after the checksum and signature pass.
    const file = path.join(dir, `KelvinRGB-${crypto.randomUUID()}.exe`);
    let fd = null;
    try {
      set({ kind: 'downloading', v, pct: 0 });
      const r = await fetch(rel.url, { headers: { 'User-Agent': 'KelvinRGB' }, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT) });
      const host = new URL(r.url).hostname;
      if (!r.ok || !/(^|\.)github\.com$|(^|\.)githubusercontent\.com$/.test(host)) throw new Error(`download failed (${r.status} ${host})`);
      const hash = crypto.createHash('sha256');
      fd = fs.openSync(file, 'wx');
      let got = 0, last = 0;
      for await (const c of r.body) {
        got += c.length;
        if (got > Math.min(rel.size || MAX_BYTES, MAX_BYTES)) throw new Error('download is bigger than the release says, not installing');
        fs.writeSync(fd, c); hash.update(c);
        const pct = Math.floor((got / (rel.size || got)) * 100);
        if (pct >= last + 5) { last = pct; set({ kind: 'downloading', v, pct }); }
      }
      fs.closeSync(fd); fd = null;
      const sha = hash.digest('hex');
      if (sha !== rel.sha) throw new Error('checksum does not match, not installing');
      const s = await fetch(rel.sigUrl, { headers: { 'User-Agent': 'KelvinRGB' }, signal: AbortSignal.timeout(TIMEOUT) });
      if (!s.ok || !signed(v, sha, await s.text(), key)) throw new Error('signature does not match, not installing');
      set({ kind: 'installing', v });
      log(`update: installing ${v}`);
      await beforeInstall(); // fans back to the BIOS before the installer touches the files
      spawn(file, ['/S', '--updated', '--force-run']);
      quit();
    } catch (e) {
      if (fd !== null) try { fs.closeSync(fd); } catch {}
      try { fs.unlinkSync(file); } catch {} // a partial or unverified installer never stays behind
      log(`update: ${e.message}`);
      set({ kind: 'failed', msg: e.message });
    }
  }

  // Label and action for the tray item and the settings row.
  function view() {
    switch (state.kind) {
      case 'checking': return { text: 'Checking for updates' };
      case 'current': return { text: `Up to date · ${version}`, action: 'check' }; // stays clickable, a release can come out later
      case 'available': return { text: `Update to ${state.v}`, action: 'install' };
      case 'downloading': return { text: `Downloading ${state.v} · ${state.pct}%` };
      case 'installing': return { text: `Installing ${state.v}` };
      case 'failed': return { text: `Update failed: ${state.msg}`, action: 'check' };
      default: return { text: 'Check for updates', action: 'check' };
    }
  }

  return { check, install, view, get state() { return state; } };
}

// Downloaded installers run once. One still running is locked and stays until the next start.
function sweep(dir, rm = fs.unlinkSync) {
  let n = 0;
  for (const f of fs.readdirSync(dir)) if (/^KelvinRGB-[0-9a-f-]{36}\.(exe|msi)$/i.test(f)) try { rm(path.join(dir, f)); n++; } catch {}
  return n;
}

module.exports = { create, newer, pick, signed, sweep, RELEASES, HELLO, RECOVERY };
