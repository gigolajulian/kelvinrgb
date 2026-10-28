# KelvinRGB

One dark window for the PC: lighting on every component, fan curves, live sensors and per-device color tuning. It replaces the SignalRGB interface using free engines:

- **Lighting:** [OpenRGB](https://openrgb.org) as an SDK server on port 6742, driven by the `openrgb-sdk` npm package.
- **Sensors and fans:** [LibreHardwareMonitorLib](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) 0.9.6 (MPL 2.0) inside a small sidecar (`sidecar/sidecar.exe`) that talks JSON over stdio.
- **Color tuning:** done in this app. Each device gets red, green and blue gain and a gamma, applied before colors go to OpenRGB, saved per device.

## Setup

1. Install the engines (once):
   ```bash
   winget install --id OpenRGB.OpenRGB --exact
   ```
   ```bash
   winget install --id namazso.PawnIO --exact
   ```
   PawnIO is the signed driver LibreHardwareMonitor 0.9.6 uses to read the Super I/O chip (fans, board temps).
2. Install and build:
   ```bash
   npm install
   ```
   ```bash
   npm run build:sidecar
   ```
   The sidecar builds with the C# compiler that ships with Windows. No .NET SDK needed. `sidecar/fetch-deps.mjs` pulls LibreHardwareMonitorLib and its dependencies from nuget.org into `sidecar/lib`.
3. Quit SignalRGB first, including its tray icon and `SignalRgbService`. Both apps fight over the same devices.
4. Start:
   ```bash
   npm start
   ```
   The app asks for admin once per launch (UAC). LibreHardwareMonitor needs admin for fan headers and CPU temps. OpenRGB needs it for RAM and motherboard lighting over SMBus. If OpenRGB is not already running, the app starts it with `--server --startminimized`.

To run OpenRGB yourself instead: open it, go to the **SDK Server** tab and click **Start Server** (port 6742).

## Fan safety

- Every fan starts on **BIOS** (motherboard control). Nothing changes until you pick Curve or Fixed and click Apply.
- Duty never goes below **25%**. The sidecar clamps it too, so a bug in the app cannot stop a fan.
- The app sends a heartbeat every second. If the app closes, crashes or hangs for 5 s, the sidecar hands every fan back to the BIOS.
- If the sidecar itself crashes, it restores the BIOS on the way out. The app restarts it.
- If the sidecar is **force-killed** (Task Manager, `taskkill /F`), nothing can run in it. The app restarts it within 2 s. The new sidecar finds the leftover marker (`%LOCALAPPDATA%\KelvinRGB\fans-in-software-mode.txt`) and holds those fans at **100%** until reboot. The BIOS's own settings went with the killed process, so full speed is the only safe value. A reboot clears it.
- GPU fans stay with the AMD driver. They are read-only here.

## Apex Legends / Easy Anti-Cheat

**Risk:** OpenRGB and LibreHardwareMonitor both load low-level drivers (PawnIO, plus SMBus access). Easy Anti-Cheat can flag or block drivers like these. I have not tested this with EAC. If that worries you, uninstall PawnIO or don't run the app while playing.

What the app does: every 4 s it checks for `r5apex.exe`, `r5apex_dx12.exe` and `EasyAntiCheat*.exe`. While any of them runs, it hands the fans back to the BIOS, stops the sidecar, stops sending lighting and disconnects from OpenRGB. It resumes once the game closes. The PawnIO driver service stays installed while the game runs. OpenRGB stays open unless you quit it.

## Layout

- `main.js`: window, OpenRGB client, lighting loop, sidecar manager, fan curves, Apex guard.
- `lib/math.js`: color tuning, effects, curve math (tested in `test/`, run `npm test`).
- `renderer/`: the UI (Lighting, Devices, Cooling, Monitoring).
- `sidecar/`: LibreHardwareMonitor bridge (`sidecar.cs`, `build.ps1`, `fetch-deps.mjs`).

Settings live in `%APPDATA%\kelvinrgb\settings.json`.
