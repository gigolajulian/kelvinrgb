# KelvinRGB

Made by Julian Gigola. Powered by [OpenRGB](https://openrgb.org).

[![Latest release](https://img.shields.io/github/v/release/gigolajulian/kelvinrgb?label=download&color=8fd3e0)](https://github.com/gigolajulian/kelvinrgb/releases/latest)

**[Download the latest KelvinRGB for Windows](https://github.com/gigolajulian/kelvinrgb/releases/latest)**: run `KelvinRGB.Setup.<version>.exe`. Free. Updates install from inside the app.

One dark window for the PC: lighting on every component, fan curves, live sensors and per-device color tuning. It replaces the SignalRGB interface using free engines:

- **Lighting:** [OpenRGB](https://openrgb.org) as an SDK server on port 6742, driven by the `openrgb-sdk` npm package.
- **Sensors and fans:** [LibreHardwareMonitorLib](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) 0.9.6 (MPL 2.0) inside a small sidecar (`sidecar/sidecar.exe`) that talks JSON over stdio.
- **Color tuning:** done in this app. Each device gets red, green and blue gain and a gamma, applied before colors go to OpenRGB, saved per device.

## Install

Download the installer from [the latest release](https://github.com/gigolajulian/kelvinrgb/releases/latest) and run it. It includes the PawnIO driver, and the first-run Setup sheet helps install OpenRGB.

Or build the installer yourself:
```bash
npm run dist
```
This builds the sidecar, then writes `dist\KelvinRGB Setup <version>.exe`. The installer puts the app in `C:\Program Files\KelvinRGB` and adds Start menu and desktop shortcuts. The app always starts as admin (UAC prompt). OpenRGB and PawnIO still need installing once (step 1 below).

The build is unsigned, so Windows SmartScreen may warn the first time: More info, then Run anyway. It uses the default Electron icon for now.

## Release an update

1. Bump `version` in `package.json`, then `npm run dist`.
2. `gh release create v<version> "dist/KelvinRGB Setup <version>.exe" --title "KelvinRGB <version>"`.
3. `npm run sign -- --upload` signs the installer and uploads `KelvinRGB.Setup.<version>.exe.sig` to that release. Installed copies refuse an update without a valid `.sig`.

The key is `~/.release-keys/updates-ed25519.pem` on Julian's PC (or the file `RELEASE_SIGNING_KEY` points to). It never goes in a repo. If it is lost, installed copies can't update again, so keep a backup.

## Secrets

The app itself stores no secrets: no accounts, tokens or keys on the user's PC. Two secrets exist on the release side.

| Secret | Unlocks | Where | Rotate |
|---|---|---|---|
| Release signing key (ed25519) | Installed copies accept an update signed with it | `~/.release-keys/updates-ed25519.pem` on Julian's PC, plus his backup | Make a new key pair, put the public half in `lib/update.js` `PUBKEY`, ship one release signed with the old key. Copies that skip that release can't update and need a manual download. |
| GitHub login (gh CLI, 2FA) | Push and create releases on every repository of the account, edit workflows, gists (scopes repo, workflow, read:org, gist; no expiry) | gh's credential store on Julian's PC | `gh auth refresh` or revoke the OAuth app at github.com/settings/applications. A stolen login can upload an installer but can't sign it. |

## Checks

`npm test` runs the unit tests, including the sidecar's safety loop (compiled with Windows' csc, so that test needs Windows).
These scripts check the rest: `secret-scan.js` (leaked keys), `lock-check.js` (lockfile drift), `uninstall-check.js`
(uninstall leftovers), `crypto-check.js` (no homemade crypto) and `licence-check.js` (bundled licences ship), all in
`scripts/`. CI runs everything except the uninstall check on every PR. BASELINE.md lists every production-readiness check,
its proof and what's still open.

## Setup (run from source)

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
   npm ci
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
- `renderer/`: the UI (Lighting, Drivers, Cooling, Monitoring).
- `sidecar/`: LibreHardwareMonitor bridge (`sidecar.cs`, `build.ps1`, `fetch-deps.mjs`).

Settings live in `%APPDATA%\kelvinrgb\settings.json`.

## Credits

- **[OpenRGB](https://gitlab.com/CalcProgrammer1/OpenRGB)** (GPL 2.0) by Adam Honse and contributors. KelvinRGB is powered by OpenRGB: every lighting change goes through its SDK server. OpenRGB is installed separately and is not bundled.
- **[openrgb-sdk](https://www.npmjs.com/package/openrgb-sdk)** (MIT) for the Node client.
- **[LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)** (MPL 2.0) for sensors and fan control.
- **[PawnIO](https://pawnio.eu)** for the hardware access driver.
- **[HidSharp](https://software.seekye.com/hidsharp)** (Apache 2.0), **BlackSharp**, **DiskInfoToolkit** and **RAMSPDToolkit** (MPL 2.0) ship with LibreHardwareMonitor; licences and sources in `resources\sidecar\lib\SIDECAR-NOTICE.txt`.
- **[bufferpack](https://github.com/ryanrolds/bufferpack)** (BSD 3-Clause, Fair Oaks Labs) for openrgb-sdk's packet format.
- **[IBM Plex](https://github.com/IBM/plex)** (SIL OFL 1.1) for the fonts.
