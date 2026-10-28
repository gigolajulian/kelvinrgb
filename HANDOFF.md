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
- Startup conflicts: SignalRGB, Armoury Crate (hides the ASUS Aura USB device) and NZXT CAM (locks the NZXT hub) all start at boot and fight KelvinRGB. Disable their autostart, or the app needs a startup step that stops them.
- No fan control on the NZXT hub, only its LEDs. GPU fans are read-only by design.
- Unsigned build with the default Electron icon.
- Never run with Apex / Easy Anti-Cheat. The guard stops everything while they run, but it is untested with EAC live.

## Stale copy
`Projects\RGB` is the first copy before the rename. Not deleted. Julian decides.
