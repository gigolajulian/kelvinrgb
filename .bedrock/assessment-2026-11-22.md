# bedrock light, 2026-11-22, main at a31c12b (1.2.3)

Assessment only. No app code changed. `npm test`: 30 of 30 pass. Nothing is proven yet (no break patches), so every row in BASELINE.md stays open.

## Gaps by risk

| # | Gap | Check | Size | Open PR |
|---|---|---|---|---|
| 1 | The whole Electron app and its renderer run as admin; only the sidecar and OpenRGB need it. Well hardened (sandboxed renderer, IPC sender check + validation, absolute System32 paths, OpenRGB only from Program Files, autostart only for a Program Files install), but one renderer bug would run with admin rights. | outside the light set | large | none |
| 2 | Quit leaves an OpenRGB server KelvinRGB started running (spawned detached, never stopped), and lights freeze mid-frame. No test of the quit path. | EXIT-1 | medium | #29 fixes the frozen lights and flushes settings; the leftover server is not covered |
| 3 | Crash path: the sidecar hands fans back to BIOS on EOF, 5 s silence, exception and exit, and marks unclean exits. Good design, but no automated test; the OpenRGB server outlives a crash. | EXIT-6 | medium | none |
| 4 | No CI: tests run only by hand. | REL-1 | small | none |
| 5 | OpenRGB is spawned without `--server-host 127.0.0.1`; the bind depends on OpenRGB's own settings (127.0.0.1 on this PC). Unauthenticated SDK port would be LAN-reachable on a default install. | LOC-1 | small | none |
| 6 | settings.json written in place; a crash mid-write silently resets curves to BIOS. | SEC-5 | small | #29 flushes pending writes on quit, still not atomic |
| 7 | Update check `fetch` has no timeout (driver checks do). | INP-1 | small | none |
| 8 | log.txt grows without limit within one session; caps on log, maps and the temp sweep have no tests. | EXIT-5, MEM-3 | small | none |
| 9 | No secret scanner run (pattern grep of all history is clean). README says `npm install`, not `npm ci`. | SEC-1, SEC-3 | small | none |
| 10 | Idle CPU and memory not measured: 30 fps OpenRGB writes while an effect animates (also with the window hidden), `tasklist` spawned every 4 s, sidecar tick and ping each second. | MEM-2, PERF-2 (full level) | medium | #30 changes the render loop |

## Asked about specifically

- **Clean quit:** fans yes (sidecar EOF -> BIOS, 4 s kill fallback). Lights no on main (#25, PR #29). OpenRGB server left running (gap 2).
- **Leftover processes:** sidecar ends with the app, also on crash (stdin EOF + watchdog). OpenRGB server does not.
- **Idle memory and CPU:** not measured (gap 10).
- **Admin rights:** gap 1.
- **PawnIO:** bundled installer pinned by sha256 in an admin-owned resources folder, never installed while Apex runs. The kernel driver stays installed after KelvinRGB is uninstalled (no uninstall step); worth saying in the README.
- **Updates:** sha256 from GitHub's asset digest plus an ed25519 signature over "KelvinRGB <version> <sha>", key off GitHub, file in an admin-owned temp folder under a random name. Tested in test/update.test.js. Solid.

## Nathan's issues

- #25 (quit freezes lights): caught by EXIT-1.
- #23 (first run, devices held by other apps, empty list after an OpenRGB restart): partly, by INP-1 ("a clear message, no crash"); the race itself needs a real-hardware test.
- #24 (effect sync), #26 (who controls each fan), #27 (more effects): product and UX, not production-readiness. bedrock would not catch them.
