# bedrock full, 2026-11-22, on main 1.2.5 (2201c42) plus this branch

39 checks for stage 1: 13 pass (each proven by a break patch), 22 open, 4 n/a. The core gate still fails on 3: EXIT-6, DATA-1, REL-1.
BASELINE.md has every row; this file is the short version.

## Built in this branch

| Check | What changed | Proof |
|---|---|---|
| EXIT-1 | Quit stops the OpenRGB server only if KelvinRGB started it (by PID and image name), after the lights rest and the fans go back | test + break |
| INP-2 | settings.json and backups written to a temp file, then renamed; retries while antivirus holds the file; a failed save logs instead of crashing | test + break |
| LOC-1 | OpenRGB started with `--server-host 127.0.0.1` | test + break |
| EXIT-5, MEM-3 | log.txt capped at 1 MB per session; in-memory log a 50-line ring | test + break |
| REL-2, NET-1 | Download stops past the release size (300 MB cap); timeouts on check, download and signature | test + break |
| SEC-5, INP-1 | Already in place, now break-proven: unsigned update never runs; bad settings fall back | test + break |
| EXIT-3 | Uninstall deletes the Start with Windows task (not during updates) | script + break |
| SEC-1, SEC-3, SEC-4 | Secret scan over all history, lockfile check (bufferpack was missing from the lockfile root, fixed), Dependabot | script + break |
| REL-1 | CI on every PR and push to main | proven locally; passes once CI is green |
| DATA-1 | Settings > Settings backup: Export and Import, through the same validation as settings.json | tested; restore drill owed |
| LIC-1 | LICENSE: all rights reserved (Julian's choice) | manual, open on two credit gaps |
| SEC-2 | Secrets inventory in README | Julian to confirm |

## Open gaps by risk

| # | Gap | Check | Size |
|---|---|---|---|
| 1 | The whole app runs as admin; only the sidecar and OpenRGB need it | (beyond the checklist) | large |
| 2 | No crash handler writes uncaught errors to log.txt (the 'log not written' alarm was a Claude sandbox copy of AppData, not a bug) | DATA-2 | small |
| 3 | Sidecar watchdog (fans back to BIOS on crash) has no behavioural test | EXIT-6 | medium |
| 4 | 0.95% CPU idle in the tray, over the 0.5% budget: 1 s repaint, 1 s sidecar tick, tasklist every 4 s | EXIT-4 | medium |
| 5 | Installer held in memory until verified (capped) | MEM-4 | medium |
| 6 | No memory-ceiling test | MEM-6 | medium |
| 7 | Sidecar boot-time marker wraps after 24.9 days of uptime (TickCount, not TickCount64) | TIME-1 | small |
| 8 | Release signing key unencrypted on disk | SEC-9 | small |
| 9 | gh token is broad and never expires | SEC-8 | small |
| 10 | bufferpack declares no licence; MPL-2.0 text for the bundled LibreHardwareMonitor isn't shipped | LIC-1 | small |
| 11 | No settings version or migration fixture | DATA-3 | small |
| 12 | No path tests (spaces, non-ASCII, long) | PLAT-1 | small |
| 13 | Owner sign-offs: memory budget, README, scaling look, restore drill, real uninstall | MEM-1, DOC-1, PLAT-2, DATA-1, EXIT-2 | small each |

## Measured (installed 1.2.3, Julian's desktop, not a modest device)

| Run | CPU avg | CPU max | GPU | Commit | Private working set |
|---|---|---|---|---|---|
| Idle, tray, 10 min | 0.95% | 1.47% | 0% | 369 to 370 MB | 147 MB |
| In use, window open, Breathing, 10 min | 1.15% | 1.99% | 0% | 374 to 373 MB | 181 MB |

## Not run

- This branch hasn't run on hardware: stop-OpenRGB-on-quit, the `--server-host` spawn (OpenRGB runs as a service on Julian's PC, so that path never runs there), and Export/Import in a real window. A dev copy started and wrote its log; Julian declined the click-through.
- The installer with the new uninstall step hasn't been built.
- REL-1 waits for the first green CI run.

## Nathan's issues

- #25 (quit freezes lights): EXIT-1. Fixed in 1.2.4; this branch adds the leftover-server part.
- #23 (first run): partly INP-1.
- #24, #26, #27: product and UX, outside bedrock.
