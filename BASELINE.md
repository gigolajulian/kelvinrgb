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
| SEC-1 | any | open | script | `node scripts/secret-scan.js` | .bedrock/breaks/SEC-1.patch |  | Scans every tracked file and every commit (7 key and token patterns, value never printed); runs in CI. Clean on 2026-11-22. |
| SEC-3 | any | open | script | `node scripts/lock-check.js` | .bedrock/breaks/SEC-3.patch |  | Lockfile committed and in step (bufferpack was missing from its root, fixed), runtime deps exact, CI installs with npm ci. PawnIO and OpenRGB installers pinned by sha256. README dev setup still says npm install (fine for a dev machine). |
| SEC-5 | any | open | test | `npm test` | .bedrock/breaks/SEC-5.patch |  | An update without a valid ed25519 signature or checksum never runs; pinned installers refuse on hash mismatch; lost temp sensor runs the fan at 100% (main.js, untested); settings writes are atomic (INP-2). |
| LOC-1 | local | open | test | `npm test` | .bedrock/breaks/LOC-1.patch |  | KelvinRGB listens on nothing. The OpenRGB server it starts gets --server-host 127.0.0.1 (flag present in the pinned OpenRGB 1.1 binary). An OpenRGB the user runs as a service keeps its own setting (127.0.0.1 on Julian's PC). |
| INP-1 | any | open | test | `npm test` | .bedrock/breaks/INP-1.patch |  | Bad settings.json and bad backups fall back to defaults or are refused with a message (too big, not JSON, not a backup); IPC input validated; dead network times out (NET-1). Missing sidecar files and missing OpenRGB show a message (main.js, untested). |
| MEM-3 | any | open | test | `npm test` | .bedrock/breaks/MEM-3.patch |  | In-memory log is a 50-line ring (lib/store.js). identify map pruned each frame; declined set cleared on toggle (main.js, by reading). |
| EXIT-1 | desktop, local | open | | | | | gap: quit stops the sidecar (stdin EOF, fans to BIOS) and disconnects OpenRGB, but an OpenRGB server KelvinRGB launched (launchedOpenRgb, spawned detached) keeps running after quit. Lights freeze mid-frame on quit (issue #25, fixed by open PR #29, which also flushes pending settings and caps quit at 8 s). No test for the quit path. medium |
| EXIT-5 | desktop, local | open | test | `npm test` | .bedrock/breaks/EXIT-5.patch |  | log.txt reset each launch and capped at 1 MB within a session; leftover update installers swept on start (tested); pinned installers deleted after running. |
| EXIT-6 | desktop, local | open | | | | | gap (no test; handled in code): the sidecar returns every fan to BIOS on stdin EOF, on 5 s without a ping, on exception and on ProcessExit, and marks an unclean exit so the next start holds 100% (sidecar/sidecar.cs). gap: no automated test of the watchdog; the detached OpenRGB server outlives a crash (same as EXIT-1). medium |
| DATA-1 | any | open | | | | | person: only settings.json (%APPDATA%\KelvinRGB) holds user data; losing it drops curves and colours, fans go back to BIOS. Owner to decide: accept the risk, or a settings export. small |
| REL-1 | any | open | ci | `npm test` | .bedrock/breaks/REL-1.patch |  | .github/workflows/test.yml runs npm test, the secret scan and the lock check on every push to main and every PR (windows-latest, Node 22). First CI run happens when this PR opens. |
| DEV-1 | any | open | | | | | Reuse a running dev server; stop every server you start before ending the turn; nothing left running in worktrees |
| SEC-2 | any | open | | | | | Secrets inventory: what each unlocks, its scope, where it's stored, how to rotate it in minutes |
| SEC-4 | any | open | script | `node scripts/lock-check.js` | .bedrock/breaks/SEC-4.patch |  | .github/dependabot.yml: npm weekly, Actions monthly; never auto-merged. npm audit: 0 in runtime deps, 6 moderate in build tools (electron-builder chain). |
| LOC-2 | local | open | | | | | If exposed beyond the machine, the firewall allows private networks only |
| INP-2 | any | open | test | `npm test` | .bedrock/breaks/INP-2.patch |  | settings.json and backups are written to a temp file, then renamed (lib/store.js writeAtomic). |
| MEM-1 | any | open | | | | | Memory budget written for a modest device (8-16 GB, integrated graphics): idle and working |
| MEM-2 | desktop, local | open | | | | | Measured against the budget: commit and working set, 10 min idle and 10 min in use |
| MEM-4 | any | open | | | | | Big files and bodies are streamed, never loaded whole; byte budgets on anything that streams or stores |
| MEM-5 | desktop, local | open | | | | | Heavy models and runtimes load only when needed and are released; thread pools and arenas capped |
| MEM-6 | desktop, local, web | open | | | | | A memory-ceiling regression test in the suite |
| EXIT-2 | desktop, local | open | | | | | Nothing starts at login unless the user turned it on; uninstall removes everything it added |
| EXIT-3 | desktop, local | open | script | `node scripts/uninstall-check.js` | .bedrock/breaks/EXIT-3.patch |  | Static check: the uninstaller deletes the KelvinRGB logon task main.js creates, except during an update. The only thing KelvinRGB registers is that task (opt-in). A real uninstall on a test PC has not been done. |
| EXIT-4 | desktop, local | open | | | | | Quiet when idle: in the background or tray it averages under 0.5% CPU and no graphics use over 10 min, waking on events or timers of a minute or more, never busy-polling |
| OPS-8 | local | open | | | | | Data survives a restart: nothing users rely on lives only in memory; processes are stateless or persist state durably |
| DATA-2 | any | open | | | | | Crashes and errors reach the developer (a local log at least; any remote reporting opt-in) |
| REL-2 | desktop | open | test | `npm test` | .bedrock/breaks/REL-2.patch |  | Signed (ed25519 over version and sha256) and size-checked: the download stops past the release size (300 MB hard cap). Installs only on the user's click, never mid-work; a failed check or download leaves the old version running. |
| PLAT-1 | desktop, local | open | | | | | Paths work on every supported OS: long paths, spaces, non-ASCII, case differences |
| PLAT-2 | desktop, web | open | | | | | High-DPI: 125-200% scaling and 4K render sharp, nothing clipped |
| LIC-1 | any | open | | | | | Own licence chosen; third-party licences compatible and credited |
| SEC-8 | any | open | | | | | Operator accounts (code host, cloud, registrar, email, stores) use 2FA or passkeys; tokens are least-privilege and expire |
| SEC-9 | any | open | | | | | Config lives outside code; development, staging and production are separate; production secrets never on a dev machine's disk in plain text |
| SEC-10 | any | open | | | | | No homemade crypto; random values for tokens and codes come from a cryptographic source |
| NET-1 | any | open | test | `npm test` | .bedrock/breaks/NET-1.patch |  | Update check and signature fetch time out at 10 s, driver lookups at 8 s, the Windows Update search at 90 s. Retries: the next quiet check is 6 h later. The installer download has no overall timeout (size-capped). |
| DATA-3 | desktop, local | open | | | | | Stored data and schemas are versioned with forward migrations; data from older versions still opens |
| TIME-1 | any | open | | | | | Times stored in UTC, or deliberately local with the reason written down (a camera's local day); time zones, daylight-saving changes and clock skew tested where dates matter |
| DOC-1 | any | open | | | | | A README says how to run, test and release it; big decisions recorded (short decision notes) |
| PERF-2 | desktop, local | open | | | | | Cold start and main actions timed on a modest device, with a written budget |
| SEC-13 | desktop, local | open | | | | | Secrets the app keeps on the user's device live in the OS keychain or a file only the user can read; never in logs or plain config |
