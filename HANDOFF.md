# KelvinRGB handoff

Updated 2026-11-21 by the KelvinRGB home thread. Repo: github.com/gigolajulian/kelvinrgb (public since 2026-11-20). Default branch `main`.

## Threads
- This home thread keeps the app's context. Each new request goes to its own sub session that reports back here.
- The glass redesign thread is archived. All its work is merged.
- One writer per folder at a time.

## Release
- Latest release: v1.1.3, 2026-11-21 (deletes leftover downloaded installers on start, PR #15). Installed on this PC: 1.1.1 (2026-11-21), update in the app to get 1.1.3.
- History, all 2026-11-21: 0.3.3 sidecar DLLs ship again, Setup sheet, bundled PawnIO 2.2.0, footer version | 0.3.4 Lighting focus grid | 0.3.5 NZXT Smart Device V2 fan control | 0.3.6 and 0.3.7 installer closes the running app and updates in place, "Game check" splash label | 1.0.0 "v1 beta" | 1.1.0 Drivers page (versions, updates) | 1.1.1 installer fix (#16) | 1.1.2 splash ticks every point in order, 15 s limit (#17) | 1.1.3 leftover installer cleanup (#15).
- Installer bug in 0.3.7 and 1.0.0: their `customCheckAppRunning` ran `--quit` even when the app was closed, which started it, so the next update failed with exit 2 ("uninstall failed"). Fixed in 1.1.1. Updating from an installed 0.3.7 or 1.0: rename `C:\Program Files\KelvinRGB\KelvinRGB.exe` first, or uninstall in Windows Settings (settings are kept).
- Updates come from GitHub releases on the public repo. No token in the app.
- Build: `npm run dist`, NSIS installer in `dist/`, installs to `C:\Program Files\KelvinRGB`. `npm start` asks for admin (`RGB_NO_ELEVATE=1` skips it).
- Log: `%APPDATA%\KelvinRGB\log.txt`, reset on every launch.

## PRs (all merged)
| # | What | Branch |
|---|---|---|
| 1 | Glass redesign phase 1, conflict check, Wraith fan fix | redesign/glass |
| 2 | Stop the OpenRGB server while Apex runs | guard/openrgb-stop |
| 3 | Updates from GitHub releases | updates/github-releases |
| 4 | Bloom startup splash (later replaced by D) | splash/bloom |
| 5 | Glass redesign: tray, autostart, Apex stop, updates, splash | redesign/glass |
| 6 | Credit line in Settings | redesign/glass |
| 7 | Devices: Mixer layout | devices/mixer |
| 8 | 0.3.3: sensors and fans back, Setup sheet, footer version | fix/sidecar-packaging |
| 9 | Lighting: focus grid with colour and brightness on each tile | lighting/focus-tiles |
| 10-13 | NZXT hub fans, installer closes running copy, Game check label, Devices bento | various |
| 14 | Drivers page with versions and updates | drivers |
| 15 | Delete leftover downloaded installers on start | fix/update-cleanup |
| 16 | Installer only closes a running copy, never starts one | installer/quit-fix |
| 17 | Splash ticks every point in order | splash/all-steps |

No open PRs.

## Git state (2026-11-20, nothing changed or removed)
- **Main checkout** (`KelvinRGB`, branch `main`): ahead 1, behind 3 of `origin/main`.
  - Unpushed: `282868f Add DESIGN.md`. Needs a pull (merge or rebase) before push; `origin/main` has #7 and `8fbb4b9 0.3.2`.
  - Untracked: `scripts/rgb-off.py` (not the home thread's; Julian decides keep or commit). This HANDOFF.md is also uncommitted.
- **Worktree** `.claude/worktrees/glass` on `fix/sidecar-packaging`: merged as #8, pushed. Untracked look sheets in `mock/setup/` (scratch). `dist/` holds old installers.
- Local branches, all pushed and merged: `guard/openrgb-stop`, `prototype/splash` (throwaway splash prototypes), `redesign/glass`, `splash/bloom`, `updates/github-releases`, `devices/mixer`.

## Verified on hardware
- Sensors read live with admin (LibreHardwareMonitorLib 0.9.6 + PawnIO), at least as of 2026-10-28.
- Fans: the sidecar drives the NCT6798D headers. Chipset Fan 30% gave 1951 rpm, 100% gave 4397. A 5% request was held at the 25% floor. Graceful exit returns it to BIOS; a hard kill holds 100% until reboot, by design.
- Lighting: all 7 OpenRGB devices follow the app (DRAM x4, RX 6700 XT, NZXT Smart Device V2, Wraith Prism, ASUS Aura board).
- Wraith fan blade: its LED only responds to blue. `render()` in `main.js` sends LED id 1 of "AMD Wraith Prism" `255,255,fanWhite` (default 240). Devices page slider "fan blade · yellow to white" (160 to 255), `settings.devices[key].fanWhite`. Checked on camera: blade white, ring follows the effect.
- Conflict check (`lib/conflicts.js`, `handleConflicts` in `main.js`): works in dev runs with a stand-in process; Armoury Crate "Stop service" worked elevated.

## Open
- **Sensors and fans empty in installed builds:** fixed in 0.3.3. Cause: builds ran in a worktree whose `sidecar/lib` was a junction, which electron-builder skips. `scripts/after-pack.js` now copies the DLLs and fails the build without them.
- Fan support beyond this board: LibreHardwareMonitor already covers the common Super I/O chips (Nuvoton, ITE, Fintek). Extra work only if a real PC shows a chip it misses.
- Apex stop of the OpenRGB server: never tested with the game running.
- In-app update 0.3.1 to 0.3.2: never run end to end.
- Conflict check: not tested on real NZXT CAM (SignalRGB closes it first) or on the installed build.
- BIOS Q-Fan curves, set by hand by Julian: CPU fan 40/60/75/85 C at 25/45/75/100%, case fans 25/40/70/100%, step time 2.1 s (CPU) and 3 s (case). Both use CPU temp as source.
- GPU fan curve in Adrenalin: Julian declined computer-use access. GPU fans are read-only in the app by design.
- NZXT Smart Device V2 fans: controlled by the sidecar over HID since 0.3.5 (3 channels, ids `/nzxt/fan/N`). NZXT CAM must be closed, it overwrites the hub.
- Log `%APPDATA%\KelvinRGB\log.txt` has not been written since 0.3.4. Cause unknown, the file is not locked.
- Unsigned build, default Electron icon.

## Decisions
- Apex / EAC: KelvinRGB stops the OpenRGB server while they run and restarts it after. Lights hold their state; fans follow the BIOS.
- Splash: D (logo ring fills with start-up steps). Prototypes artifact: https://claude.ai/artifact/RPcYngTqr7iePyzVYXXsPo (disposable now that D shipped).
- Design: locked in DESIGN.md (glass, Plex, accent `#8fd3e0`).

## Scripts
- `scripts/wraith-*.ps1`, `wraith-header-test.py`: Wraith diagnostics from the fan LED hunt. Full notes in git history of this file (before 2026-11-20 rewrite).
- `scripts/rgb-off.py` (untracked): all lights off through OpenRGB :6742. `uv run --with openrgb-python python scripts/rgb-off.py`.

## Stale copy
`Projects\RGB` is the first copy before the rename. Not deleted. Julian decides.
