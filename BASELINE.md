# Baseline: kelvinrgb

App: kelvinrgb
Stage: 1
Parts: desktop, local, web
Features: none
Checklist version: 2026.11.20.5
Level: light
Gate answer: 
Gate asked: 
Next ask after: 
Manual expiry days: 180
Stage override:
Parts override: web = the Electron renderer only, no hosted site
Features override: detector saw uploads and url-fetch; the app takes no uploads and fetches only fixed GitHub/OpenRGB URLs (lib/update.js, lib/drivers.js), so neither applies

Detected: a project with dependencies (package.json); has web pages (renderer\index.html); a tray app (main.js); a desktop window (main.js)


| ID | Part | Status | Proof | Evidence | Break | Checked | Notes |
|---|---|---|---|---|---|---|---|
| SEC-1 | any | open | | | | | covered, not proven: pattern grep over all commits (AWS, GitHub, sk-, private-key headers) found nothing; release key lives outside the repo (scripts/sign-release.js). gap: no real scanner (gitleaks) run, none in CI. small |
| SEC-3 | any | open | | | | | covered, not proven: package-lock.json committed; openrgb-sdk and bufferpack pinned exactly; PawnIO and OpenRGB installers pinned by sha256 (scripts/fetch-pawnio.js, lib/drivers.js). gap: README says npm install, not npm ci; electron ^45 range. small |
| SEC-5 | any | open | | | | | partial: update install refuses without checksum and ed25519 signature (test/update.test.js "a download with the right checksum but no valid signature never runs"); pinned installers refuse on hash mismatch (test/drivers.test.js); lost temp sensor runs fan at 100% (main.js driveFans, no test). gap: settings.json written in place with writeFileSync, a crash mid-write leaves it half-written and V.settings falls back to defaults (curves lost, fans back to BIOS: safe but silent). small |
| LOC-1 | local | open | | | | | covered, not proven: KelvinRGB itself listens on nothing. It spawns OpenRGB --server without --server-host, so the bind depends on OpenRGB settings; observed 127.0.0.1:6742 on this PC. gap: pass --server-host 127.0.0.1 and add a test on the spawn args. small |
| INP-1 | any | open | | | | | partial: corrupt or BOM settings fall back to defaults (test/validate.test.js "settings from disk fall back to defaults"); IPC inputs validated (test/validate.test.js). gap: no network for update check has no timeout (lib/update.js check), missing sidecar files and missing OpenRGB show a message but have no test. small |
| MEM-3 | any | open | | | | | covered, not proven: state.log capped at 50 lines, identify map pruned each frame, declined set cleared on toggle (main.js). gap: no test asserts the caps. small |
| EXIT-1 | desktop, local | open | | | | | gap: quit stops the sidecar (stdin EOF, fans to BIOS) and disconnects OpenRGB, but an OpenRGB server KelvinRGB launched (launchedOpenRgb, spawned detached) keeps running after quit. Lights freeze mid-frame on quit (issue #25, fixed by open PR #29, which also flushes pending settings and caps quit at 8 s). No test for the quit path. medium |
| EXIT-5 | desktop, local | open | | | | | covered, not proven: log.txt reset every launch; leftover update installers swept from %SystemRoot%\Temp on start (U.sweep in lib/update.js); pinned installers deleted after run. gap: log.txt can still grow without limit within one long session, and no test proves sweep. small |
| EXIT-6 | desktop, local | open | | | | | covered, not proven: the sidecar returns every fan to BIOS on stdin EOF, on 5 s without a ping, on exception and on ProcessExit, and marks an unclean exit so the next start holds 100% (sidecar/sidecar.cs). gap: no automated test of the watchdog; the detached OpenRGB server outlives a crash (same as EXIT-1). medium |
| DATA-1 | any | open | | | | | person: only settings.json (%APPDATA%\KelvinRGB) holds user data; losing it drops curves and colours, fans go back to BIOS. Owner to decide: accept the risk, or a settings export. small |
| REL-1 | any | open | | | | | gap: npm test (6 files, 30 tests, all pass 2026-11-22) runs only by hand; no .github/workflows, no pre-merge hook. small |
