// Small file and memory helpers for the main process. fs is passed in so tests can fail a step on purpose.
const nodeFs = require('node:fs');
const { pathToFileURL } = require('node:url');

// Write to a temp file, then rename over the real one: a crash mid-write leaves the old file whole.
// On Windows the rename can fail for a moment (EPERM, EBUSY) while antivirus or a reader holds the file: retry a few times.
function writeAtomic(file, text, fs = nodeFs, tries = 5) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  for (let i = 1; ; i++) {
    try { return fs.renameSync(tmp, file); } catch (e) {
      if (i >= tries || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { try { fs.unlinkSync(tmp); } catch {} throw e; }
      const until = Date.now() + 50 * i; while (Date.now() < until); // short, rare, and only on the save path
    }
  }
}

// Keep the last n items: the in-memory log never grows past n lines.
const ring = (arr, item, n) => [...arr.slice(-(n - 1)), item];

// Append a line; once the file passes max bytes, start it over so one long session can't fill the disk.
function appendCapped(file, line, max, fs = nodeFs) {
  let size = 0;
  try { size = fs.statSync(file).size; } catch {}
  if (size + line.length > max) fs.writeFileSync(file, `(log restarted at ${max} bytes)\n${line}`);
  else fs.appendFileSync(file, line);
}

// A settings backup the user picked: small, valid JSON, and through the same gates as settings.json (validate).
function parseBackup(text, validate) {
  if (typeof text !== 'string' || text.length > 1024 * 1024) throw new Error('not a KelvinRGB backup (too big)');
  const raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (!raw || typeof raw !== 'object' || !raw.lighting) throw new Error('not a KelvinRGB backup');
  return validate(raw);
}

// Debounced save: a burst of changes writes once, ms after the last. flush() writes a pending save now (quit).
function saver(write, ms, timers = globalThis) {
  let t = null;
  return {
    save() { timers.clearTimeout(t); t = timers.setTimeout(() => { t = null; write(); }, ms); },
    flush() { if (t) { timers.clearTimeout(t); t = null; write(); } },
  };
}

// The installed app has no console: uncaught errors go to the log (log.txt) and the app keeps running, as
// Electron's own handler would, minus its dialog. Fans don't depend on it: the sidecar has its own watchdog.
function catchCrashes(proc, log) {
  proc.on('uncaughtException', (e) => log(`crash: ${e && e.stack || e}`));
  proc.on('unhandledRejection', (e) => log(`crash (promise): ${e && e.stack || e}`));
}

// The window page's URL as Chromium reports it, lower-cased: IPC is accepted only from this page. Built the same
// way Chromium builds it, so an install folder with spaces, non-ASCII letters or # still matches.
const pageUrl = (file) => pathToFileURL(file).href.toLowerCase();

module.exports = { writeAtomic, ring, appendCapped, parseBackup, saver, catchCrashes, pageUrl };
