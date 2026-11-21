# KelvinRGB handoff

Updated 2026-10-28. Repo: github.com/gigolajulian/kelvinrgb (private), branch `main`.

## State
- v1 works and is installed from the NSIS installer (`npm run dist`, output in `dist/`) to `C:\Program Files\KelvinRGB`.
- The installed copy still holds a Wraith fan LED experiment that was since reverted in source. Rebuild and reinstall (one UAC prompt) to get the clean build.
- Log file: `%APPDATA%\KelvinRGB\log.txt`, reset on every launch.

## Verified on hardware
- Sensors read live with admin (LHM 0.9.6 + PawnIO).
- Fans: the sidecar drives the NCT6798D headers. Chipset Fan: 30% duty gave 1951 rpm, 100% gave 4397. A 5% request was held at the 25% floor. A graceful exit returned it to BIOS. A hard kill held it at 100% until reboot, as designed.
- The app's curve moved the Chipset Fan from 4232 to 2036 rpm.
- Lighting: all 7 OpenRGB devices read back the app color (DRAM x4, RX 6700 XT, NZXT Smart Device V2, Wraith Prism, ASUS Aura board).

## Open
- **Wraith Prism fan blade LED** does not follow the app. Logo and ring do. Tried: OpenRGB direct packets, SignalRGB's plugin packets byte for byte, effect channel 0x06, channel remaps, hardware mode round trips. None worked except one magenta hit while the cooler was in hardware mode, which did not repeat. SignalRGB does control it, through its "Wraith Prism" device. Cause unknown. Diagnostic scripts: `scripts/wraith-test.ps1`, `wraith-fan-channel.ps1`, `wraith-remap.ps1`.
- The tests changed the cooler's channel map, so the fan LED is off now. A full power off (not a restart) should bring back its saved color. Unverified.
- Startup conflicts (conflict check added 2026-11-20, `lib/conflicts.js` + `handleConflicts` in `main.js`): every guard poll (4 s, reuses its `tasklist`), KelvinRGB shows the RGB apps that hold the same devices in an in-app sheet (`#conflicts` in `renderer/index.html`, `state.conflicts` from main). Each row is red while the app runs and turns green once it is gone, whether closed from the row's Close button (`taskkill /F /T`, then a toast "KelvinRGB closed NZXT CAM.exe.") or by hand. Warn-only rows say "close it yourself". "Continue" (or "Continue anyway", Esc) closes the sheet; at startup, lights and fans wait for it. Apps left running are not shown again until relaunch. Never runs while the Apex guard is active. The toggle "conflict check" in the sidebar status turns it off (`settings.closeConflicts`).
  - Closeable: `NZXT CAM.exe`, `SteelSeriesGG.exe`, `SteelSeriesEngine.exe`, `SteelSeriesPrism.exe` (SignalRGB's ConflictMitigator list on this PC, from its logs).
  - Warn only, shown once per session: Armoury Crate (`ArmouryCrate.Service.exe`) and SignalRGB. Armoury runs as Windows services that the service manager restarts, and stopping them needs admin and can break MyASUS / ASUS updates. Killing them would only start a restart loop. The real fix is turning off Armoury's lighting (or uninstalling it). Its row has a **Stop service** button: `sc stop ArmouryCrateService` (admin), which lasts until reboot and never changes the startup type. If it fails, the row says KelvinRGB needs admin. SignalRGB and OpenRGB are never closed by the app.
  - Verified 2026-11-20 in a dev run (`RGB_NO_ELEVATE=1`): sheet shown, the row's Close button closed a stand-in process (row turned green, soft chime played), hardware started after Continue. Stop service on Armoury Crate worked in an elevated dev run. Not verified on real NZXT CAM: SignalRGB is running and closes CAM and SteelSeries about 2 s after they start, before KelvinRGB's 4 s poll. Dev aid: `RGB_CONFLICT_TEST=<name.exe>` adds a stand-in to the closeable list.
  - Not tested: the installed build (the AppUserModelID is `com.juliangigola.kelvinrgb` when packaged).
- No fan control on the NZXT hub, only its LEDs. GPU fans are read-only by design.
- Unsigned build with the default Electron icon.
- Never run with Apex / Easy Anti-Cheat. The guard stops everything while they run, but it is untested with EAC live.

## Stale copy
`Projects\RGB` is the first copy before the rename. Not deleted. Julian decides.
