# Baseline: kelvinrgb

App: kelvinrgb
Stage: 1
Parts: desktop, local, web
Features: none
Checklist version: 2026.11.20.5
Level: full
Gate answer: build
Gate asked: 2026-11-22
Next ask after: 
Manual expiry days: 180
Stage override:
Parts override: web = the Electron renderer only, no hosted site
Features override: detector saw uploads and url-fetch; the app takes no uploads and fetches only fixed GitHub/OpenRGB URLs (lib/update.js, lib/drivers.js), so neither applies

Detected: a project with dependencies (package.json); has web pages (renderer\index.html); a tray app (main.js); a desktop window (main.js)


| ID | Part | Status | Proof | Evidence | Break | Checked | Notes |
|---|---|---|---|---|---|---|---|
| SEC-1 | any | pass | script | `node scripts/secret-scan.js` | .bedrock/breaks/SEC-1.patch | 2026-11-22 | Scans every tracked file and every commit (7 key and token patterns, value never printed); runs in CI. Clean on 2026-11-22. |
| SEC-3 | any | pass | script | `node scripts/lock-check.js lock` | .bedrock/breaks/SEC-3.patch | 2026-11-22 | Lockfile committed and in step (bufferpack was missing from its root, fixed), runtime deps exact, CI installs with npm ci. PawnIO and OpenRGB installers pinned by sha256. README dev setup still says npm install (fine for a dev machine). |
| SEC-5 | any | pass | test | `node --test --test-name-pattern="right checksum but no valid signature" test/update.test.js` | .bedrock/breaks/SEC-5.patch | 2026-11-22 | An update without a valid ed25519 signature or checksum never runs; pinned installers refuse on hash mismatch; lost temp sensor runs the fan at 100% (main.js, untested); settings writes are atomic (INP-2). |
| LOC-1 | local | pass | test | `node --test --test-name-pattern="loopback only" test/drivers.test.js` | .bedrock/breaks/LOC-1.patch | 2026-11-22 | KelvinRGB listens on nothing. The OpenRGB server it starts gets --server-host 127.0.0.1 (flag present in the pinned OpenRGB 1.1 binary). An OpenRGB the user runs as a service keeps its own setting (127.0.0.1 on Julian's PC). |
| INP-1 | any | pass | test | `node --test --test-name-pattern="settings from disk fall back" test/validate.test.js` | .bedrock/breaks/INP-1.patch | 2026-11-22 | Bad settings.json and bad backups fall back to defaults or are refused with a message (too big, not JSON, not a backup); IPC input validated; dead network times out (NET-1). Missing sidecar files and missing OpenRGB show a message (main.js, untested). |
| MEM-3 | any | pass | test | `node --test --test-name-pattern="last 50 lines" test/store.test.js` | .bedrock/breaks/MEM-3.patch | 2026-11-22 | In-memory log is a 50-line ring (lib/store.js). identify map pruned each frame; declined set cleared on toggle (main.js, by reading). |
| EXIT-1 | desktop, local | pass | test | `node --test --test-name-pattern="quit stops the OpenRGB server" test/guard.test.js` | .bedrock/breaks/EXIT-1.patch | 2026-11-22 | Quit (lib/guard.js quit): saves, rests the lights on the chosen colour, hands every fan back (sidecar EOF), then stops the OpenRGB server only if KelvinRGB started it (by PID and image name; Julian chose this 2026-11-22). A failed step never blocks the rest; quit always exits within 8 s. An OpenRGB the user runs (a service, as on Julian's PC) keeps running. |
| EXIT-5 | desktop, local | pass | test | `node --test --test-name-pattern="never grows past its cap" test/store.test.js` | .bedrock/breaks/EXIT-5.patch | 2026-11-22 | log.txt reset each launch and capped at 1 MB within a session; leftover update installers swept on start (tested); pinned installers deleted after running. |
| EXIT-6 | desktop, local | open |  |  |  |  | gap (no test): the sidecar returns every fan to BIOS on stdin EOF, 5 s without a ping, exception and exit, and marks an unclean exit so the next start holds 100% (sidecar/sidecar.cs). No behavioural test can run in CI (needs the built sidecar and LibreHardwareMonitor). A --selftest mode with a fake control would make it testable. The OpenRGB server KelvinRGB starts outlives a crash (see EXIT-1). medium |
| DATA-1 | any | open | manual |  |  |  | gap: Settings has Export and Import (tested: an export restores the same settings, an import goes through the same gates as settings.json, test/store.test.js). The manual restore drill is still owed: Julian exports, changes a colour, imports, sees it back. small |
| REL-1 | any | pass | ci | `npm test` | .bedrock/breaks/REL-1.patch | 2026-11-22 | .github/workflows/test.yml runs npm test, the secret scan and the lock check on every push to main and every PR (windows-latest, Node 22). First CI run happens when this PR opens. |
| DEV-1 | any | n/a |  |  |  |  | No dev server: an Electron app started with npm start. Worktree cleanup is covered by Julian's ~/.claude/hooks/worktree-sweep.mjs. |
| SEC-2 | any | open | manual |  |  |  | gap: inventory drafted in README, Secrets (release signing key, gh login: what each unlocks, where, how to rotate). Needs Julian to confirm it's complete. small |
| SEC-4 | any | pass | script | `node scripts/lock-check.js dependabot` | .bedrock/breaks/SEC-4.patch | 2026-11-22 | .github/dependabot.yml: npm weekly, Actions monthly; never auto-merged. npm audit: 0 in runtime deps, 6 moderate in build tools (electron-builder chain). |
| LOC-2 | local | n/a |  |  |  |  | Nothing is exposed beyond the machine: KelvinRGB listens on nothing, and the OpenRGB server it starts is loopback only (LOC-1). |
| INP-2 | any | pass | test | `node --test --test-name-pattern="crash mid-save" test/store.test.js` | .bedrock/breaks/INP-2.patch | 2026-11-22 | settings.json and backups are written to a temp file, then renamed (lib/store.js writeAtomic). |
| MEM-1 | any | open | | | | | Memory budget written for a modest device (8-16 GB, integrated graphics): idle and working |
| MEM-2 | desktop, local | open | | | | | Measured against the budget: commit and working set, 10 min idle and 10 min in use |
| MEM-4 | any | open |  |  |  |  | gap: the update installer (about 100 MB) is held in memory until verified, now capped at the release size and 300 MB (REL-2). Streaming it to the admin-owned temp file while hashing would remove the copy. medium |
| MEM-5 | desktop, local | n/a |  |  |  |  | No ML models or heavy runtimes. LibreHardwareMonitor loads only in the sidecar, which starts after the Apex check and stops while Apex runs. |
| MEM-6 | desktop, local, web | open |  |  |  |  | gap: no memory-ceiling test. A test that renders 10,000 frames for 10 devices and checks heap growth would guard the render loop. medium |
| EXIT-2 | desktop, local | open | manual |  |  |  | gap: nothing starts at login unless the user turns on Start with Windows (by reading: setAutostart runs only from the toggle and the tray). Uninstall now deletes that task (EXIT-3). A real install, autostart on, uninstall run on a test PC is still to do. small |
| EXIT-3 | desktop, local | pass | script | `node scripts/uninstall-check.js` | .bedrock/breaks/EXIT-3.patch | 2026-11-22 | Static check: the uninstaller deletes the KelvinRGB logon task main.js creates, except during an update. The only thing KelvinRGB registers is that task (opt-in). A real uninstall on a test PC has not been done. |
| EXIT-4 | desktop, local | open | | | | | Quiet when idle: in the background or tray it averages under 0.5% CPU and no graphics use over 10 min, waking on events or timers of a minute or more, never busy-polling |
| OPS-8 | local | open |  |  |  |  | gap (no test): settings are written 300 ms after each change and flushed on quit (main.js); nothing users rely on lives only in memory. main.js has no test seam. small |
| DATA-2 | any | open |  |  |  |  | gap: errors go to %APPDATA%\KelvinRGB\log.txt (capped at 1 MB, EXIT-5) and the in-app log. Found 2026-11-22: the installed 1.2.3 hasn't written log.txt since Nov 21 even after relaunching at 22:19, so the installed log is not working; cause not found yet. No uncaughtException handler writes crashes to the log. medium |
| REL-2 | desktop | pass | test | `node --test --test-name-pattern="bigger than the release" test/update.test.js` | .bedrock/breaks/REL-2.patch | 2026-11-22 | Signed (ed25519 over version and sha256) and size-checked: the download stops past the release size (300 MB hard cap). Installs only on the user's click, never mid-work; a failed check or download leaves the old version running. |
| PLAT-1 | desktop, local | open |  |  |  |  | gap: no test with long, spaced or non-ASCII paths. Paths are built with path.join from Program Files, %APPDATA% and resources, all of which can hold spaces or non-ASCII user names. small |
| PLAT-2 | desktop, web | open | manual |  |  |  | gap: not checked; Julian skipped the scaling sheet on 2026-11-22. Nathan's report (#25) mentions testing at 3840x2160 and 125%, but that's not a sign-off. small |
| LIC-1 | any | open | manual |  |  |  | gap: Julian chose all rights reserved on 2026-11-22; LICENSE added. Credits list OpenRGB (GPL-2.0, not bundled), openrgb-sdk (MIT), LibreHardwareMonitor (MPL-2.0, bundled), PawnIO (licence and notice in third_party, bundled), IBM Plex (OFL). Open: bufferpack declares no licence, and the MPL-2.0 text for the bundled LibreHardwareMonitor DLLs isn't shipped next to them. small |
| SEC-8 | any | open | manual |  |  |  | gap: Julian confirmed 2026-11-22 that GitHub has 2FA or a passkey and the gh login is the only token that can push. That token has broad repo scope and doesn't expire, so the 'least-privilege and expire' half is not met. small |
| SEC-9 | any | n/a |  |  |  |  | No environments or runtime config: a desktop app with no server. The only production secret (release signing key) lives outside the repo (README, Secrets). |
| SEC-10 | any | open |  |  |  |  | gap (no proof): by reading, all crypto is node:crypto (sha256, ed25519 verify, randomUUID for temp names); nothing homemade. A static script would make it provable. small |
| NET-1 | any | pass | test | `node --test --test-name-pattern="carries a timeout" test/update.test.js` | .bedrock/breaks/NET-1.patch | 2026-11-22 | Update check and signature fetch time out at 10 s, driver lookups at 8 s, the Windows Update search at 90 s. Retries: the next quiet check is 6 h later. The installer download has no overall timeout (size-capped). |
| DATA-3 | desktop, local | open |  |  |  |  | gap: settings.json has no version field; older files open because every key goes through the validators with defaults (test/validate.test.js), but there is no migration step or old-file fixture. small |
| TIME-1 | any | n/a |  |  |  |  | No stored times. Log lines use local time on purpose, for the person reading them. |
| DOC-1 | any | open | manual |  |  |  | gap: README covers run, test, release, signing, secrets and checks; decisions live in HANDOFF.md. Needs Julian's sign-off. small |
| PERF-2 | desktop, local | open | | | | | Cold start and main actions timed on a modest device, with a written budget |
| SEC-13 | desktop, local | n/a |  |  |  |  | The app keeps no secrets on the user's device: no accounts, tokens or licence keys. |
