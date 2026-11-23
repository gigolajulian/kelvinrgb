# Baseline: kelvinrgb

App: kelvinrgb
Stage: 1
Parts: desktop, local, web
Features: none
Checklist version: 2026.11.20.5
Level: full
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
| SEC-1 | any | open | | | | | gap (no test; handled in code): pattern grep over all commits (AWS, GitHub, sk-, private-key headers) found nothing; release key lives outside the repo (scripts/sign-release.js). gap: no real scanner (gitleaks) run, none in CI. small |
| SEC-3 | any | open | | | | | gap (no test; handled in code): package-lock.json committed; openrgb-sdk and bufferpack pinned exactly; PawnIO and OpenRGB installers pinned by sha256 (scripts/fetch-pawnio.js, lib/drivers.js). gap: README says npm install, not npm ci; electron ^45 range. small |
| SEC-5 | any | open | test | `npm test` | | | covered, not proven (partly): update install refuses without checksum and ed25519 signature (test/update.test.js "a download with the right checksum but no valid signature never runs"); pinned installers refuse on hash mismatch (test/drivers.test.js); lost temp sensor runs fan at 100% (main.js driveFans, no test). gap: settings.json written in place with writeFileSync, a crash mid-write leaves it half-written and V.settings falls back to defaults (curves lost, fans back to BIOS: safe but silent). small |
| LOC-1 | local | open | | | | | gap (no test; handled in code): KelvinRGB itself listens on nothing. It spawns OpenRGB --server without --server-host, so the bind depends on OpenRGB settings; observed 127.0.0.1:6742 on this PC. gap: pass --server-host 127.0.0.1 and add a test on the spawn args. small |
| INP-1 | any | open | test | `npm test` | | | covered, not proven (partly): corrupt or BOM settings fall back to defaults (test/validate.test.js "settings from disk fall back to defaults"); IPC inputs validated (test/validate.test.js). gap: no network for update check has no timeout (lib/update.js check), missing sidecar files and missing OpenRGB show a message but have no test. small |
| MEM-3 | any | open | | | | | gap (no test; handled in code): state.log capped at 50 lines, identify map pruned each frame, declined set cleared on toggle (main.js). gap: no test asserts the caps. small |
| EXIT-1 | desktop, local | open | | | | | gap: quit stops the sidecar (stdin EOF, fans to BIOS) and disconnects OpenRGB, but an OpenRGB server KelvinRGB launched (launchedOpenRgb, spawned detached) keeps running after quit. Lights freeze mid-frame on quit (issue #25, fixed by open PR #29, which also flushes pending settings and caps quit at 8 s). No test for the quit path. medium |
| EXIT-5 | desktop, local | open | | | | | gap (no test; handled in code): log.txt reset every launch; leftover update installers swept from %SystemRoot%\Temp on start (U.sweep in lib/update.js); pinned installers deleted after run. gap: log.txt can still grow without limit within one long session, and no test proves sweep. small |
| EXIT-6 | desktop, local | open | | | | | gap (no test; handled in code): the sidecar returns every fan to BIOS on stdin EOF, on 5 s without a ping, on exception and on ProcessExit, and marks an unclean exit so the next start holds 100% (sidecar/sidecar.cs). gap: no automated test of the watchdog; the detached OpenRGB server outlives a crash (same as EXIT-1). medium |
| DATA-1 | any | open | | | | | person: only settings.json (%APPDATA%\KelvinRGB) holds user data; losing it drops curves and colours, fans go back to BIOS. Owner to decide: accept the risk, or a settings export. small |
| REL-1 | any | open | | | | | gap: npm test (6 files, 30 tests, all pass 2026-11-22) runs only by hand; no .github/workflows, no pre-merge hook. small |
| DEV-1 | any | open | | | | | Reuse a running dev server; stop every server you start before ending the turn; nothing left running in worktrees |
| SEC-2 | any | open | | | | | Secrets inventory: what each unlocks, its scope, where it's stored, how to rotate it in minutes |
| SEC-4 | any | open | | | | | Known-vulnerable dependencies are flagged automatically, and update proposals arrive on their own (OWASP A03 supply chain) |
| LOC-2 | local | open | | | | | If exposed beyond the machine, the firewall allows private networks only |
| INP-2 | any | open | | | | | User data is written atomically (temp file, then rename), so a crash never corrupts it |
| MEM-1 | any | open | | | | | Memory budget written for a modest device (8-16 GB, integrated graphics): idle and working |
| MEM-2 | desktop, local | open | | | | | Measured against the budget: commit and working set, 10 min idle and 10 min in use |
| MEM-4 | any | open | | | | | Big files and bodies are streamed, never loaded whole; byte budgets on anything that streams or stores |
| MEM-5 | desktop, local | open | | | | | Heavy models and runtimes load only when needed and are released; thread pools and arenas capped |
| MEM-6 | desktop, local, web | open | | | | | A memory-ceiling regression test in the suite |
| EXIT-2 | desktop, local | open | | | | | Nothing starts at login unless the user turned it on; uninstall removes everything it added |
| EXIT-3 | desktop, local | open | | | | | No leftovers: when the app moves, is renamed or a part is retired, its own cleanup removes every startup entry, scheduled task, service and handler it registered; nothing at login points into a dev folder or a .venv |
| EXIT-4 | desktop, local | open | | | | | Quiet when idle: in the background or tray it averages under 0.5% CPU and no graphics use over 10 min, waking on events or timers of a minute or more, never busy-polling |
| OPS-8 | local | open | | | | | Data survives a restart: nothing users rely on lives only in memory; processes are stateless or persist state durably |
| DATA-2 | any | open | | | | | Crashes and errors reach the developer (a local log at least; any remote reporting opt-in) |
| REL-2 | desktop | open | | | | | The app's auto-updates are signed and size-checked, and never restart in the middle of the user's work |
| PLAT-1 | desktop, local | open | | | | | Paths work on every supported OS: long paths, spaces, non-ASCII, case differences |
| PLAT-2 | desktop, web | open | | | | | High-DPI: 125-200% scaling and 4K render sharp, nothing clipped |
| LIC-1 | any | open | | | | | Own licence chosen; third-party licences compatible and credited |
| SEC-8 | any | open | | | | | Operator accounts (code host, cloud, registrar, email, stores) use 2FA or passkeys; tokens are least-privilege and expire |
| SEC-9 | any | open | | | | | Config lives outside code; development, staging and production are separate; production secrets never on a dev machine's disk in plain text |
| SEC-10 | any | open | | | | | No homemade crypto; random values for tokens and codes come from a cryptographic source |
| NET-1 | any | open | | | | | Every outbound call has a timeout, retries with backoff and jitter, and stops after repeated failures |
| DATA-3 | desktop, local | open | | | | | Stored data and schemas are versioned with forward migrations; data from older versions still opens |
| TIME-1 | any | open | | | | | Times stored in UTC, or deliberately local with the reason written down (a camera's local day); time zones, daylight-saving changes and clock skew tested where dates matter |
| DOC-1 | any | open | | | | | A README says how to run, test and release it; big decisions recorded (short decision notes) |
| PERF-2 | desktop, local | open | | | | | Cold start and main actions timed on a modest device, with a written budget |
| SEC-13 | desktop, local | open | | | | | Secrets the app keeps on the user's device live in the OS keychain or a file only the user can read; never in logs or plain config |
