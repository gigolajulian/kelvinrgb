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
- Next on the fan LED: USBPcap is installed (2026-10-28). After a reboot, run `scripts/wraith-capture.ps1` elevated while SignalRGB changes the Wraith color, then diff its packets against ours.
- The tests changed the cooler's channel map, so the fan LED is off now. A full power off (not a restart) should bring back its saved color. Unverified.
- Startup conflicts (conflict check added 2026-11-20, `lib/conflicts.js` + `handleConflicts` in `main.js`): every guard poll (4 s, reuses its `tasklist`), KelvinRGB shows the RGB apps that hold the same devices in an in-app sheet (`#conflicts` in `renderer/index.html`, `state.conflicts` from main). Each row is red while the app runs and turns green once it is gone, whether closed from the row's Close button (`taskkill /F /T`, then a toast "KelvinRGB closed NZXT CAM.exe.") or by hand. Warn-only rows say "close it yourself". "Continue" (or "Continue anyway", Esc) closes the sheet; at startup, lights and fans wait for it. Apps left running are not shown again until relaunch. Never runs while the Apex guard is active. The toggle "conflict check" in the sidebar status turns it off (`settings.closeConflicts`).
  - Closeable: `NZXT CAM.exe`, `SteelSeriesGG.exe`, `SteelSeriesEngine.exe`, `SteelSeriesPrism.exe` (SignalRGB's ConflictMitigator list on this PC, from its logs).
  - Warn only, shown once per session: Armoury Crate (`ArmouryCrate.Service.exe`) and SignalRGB. Armoury runs as Windows services that the service manager restarts, and stopping them needs admin and can break MyASUS / ASUS updates. Killing them would only start a restart loop. The real fix is turning off Armoury's lighting (or uninstalling it). Its row has a **Stop service** button: `sc stop ArmouryCrateService` (admin), which lasts until reboot and never changes the startup type. If it fails, the row says KelvinRGB needs admin. SignalRGB and OpenRGB are never closed by the app.
  - Verified 2026-11-20 in a dev run (`RGB_NO_ELEVATE=1`): sheet shown, the row's Close button closed a stand-in process (row turned green, soft chime played), hardware started after Continue. Stop service on Armoury Crate worked in an elevated dev run. Not verified on real NZXT CAM: SignalRGB is running and closes CAM and SteelSeries about 2 s after they start, before KelvinRGB's 4 s poll. Dev aid: `RGB_CONFLICT_TEST=<name.exe>` adds a stand-in to the closeable list.
  - Not tested: the installed build (the AppUserModelID is `com.juliangigola.kelvinrgb` when packaged).
- No fan control on the NZXT hub, only its LEDs. GPU fans are read-only by design.
- Unsigned build with the default Electron icon.
- Never run with Apex / Easy Anti-Cheat. The guard stops everything while they run, but it is untested with EAC live.

## Wraith fan LED: what SignalRGB does (static read, 2026-11-20)
SignalRGB sends nothing KelvinRGB or OpenRGB don't. The packets are not the difference.
- Plugin: `%LOCALAPPDATA%\VortxEngine\app-2.5.86\Signal-x64\Plugins\AMD\AMD_Wraith_Prism.js`. The CDN copy in `%LOCALAPPDATA%\WhirlwindFX\SignalRgb\cache\plugin_cdn\main\Plugins\AMD\` is the same file with other line endings. Unchanged in the 2.5.86 update.
- Interface: HID MI_01 (`Validate` returns `interface === 1`), 65-byte writes with report ID 0. OpenRGB uses the same MI_01 path, and so do our scripts.
- Init: `41 03` (software mode), then `51 28 00 00 E0`. Nothing else. No `51 A0` channel remap, no `51 2C` effect channel.
- Each frame: `C0 01 <count> 00` plus `<id> R G B` groups, LED ids 0..14 in packet 1 and 15..16 in packet 2. Fan = id 1, as in OpenRGB. It never reads replies and streams at its frame rate.
- Shutdown: `41 00` (hardware mode), or all black on sleep.
- OpenRGB master, `AMDWraithPrismController.cpp`: Direct sends the same `41 03` and `51 28 00 00 E0`. Frames go as logo + fan (count 2), then the ring (count 15), with a read after each write. It is the same protocol in a different grouping.
- KelvinRGB already repaints through OpenRGB every second (`main.js` `startRender`), so the "SignalRGB streams, we send once" gap is already closed. That leaves no protocol reason for the fan LED to ignore us.

What is left is outside the USB packets:
1. **The 4-pin RGB cable.** The board has two 12V RGB headers. SignalRGB creates them as subdevices `12V Header 1/2` (its log, 2026-10-28), and OpenRGB lists them as LEDs 3 and 4 on the ASUS board. If the cooler's RGB cable sits in one of them, that cable may drive the fan LED. MSI says the Wraith's lighting can't be controlled when the RGB and USB cables are both connected. SignalRGB would then light the fan through the ASUS board, not through the "Wraith Prism" device. Against this: the one magenta hit in hardware mode matched `wraith-fan-channel.ps1`'s color, so USB did reach that LED at least once.
2. **The channel map.** The remap tests rewrote the cooler's LED-to-channel table. If that table also gates Direct for the fan, a full power off (not a restart) is needed before any test means anything.
3. **Today, unverified:** only `SignalRgbService.exe` runs, not the engine. Its last log is from 2026-10-28. Nobody has confirmed that SignalRGB still lights the fan LED after the remap tests.

**Result 2026-11-20:** header test run in green, then red. The fan LED stayed **yellow** both times, while the logo and ring stayed black from OpenRGB Direct. So the fan is not wired through the board headers (lead 1 is out). The fan LED is lit, but from a stored color, and it ignores Direct frames. That points at lead 2: after the remap tests the fan reads its effect channel instead of the Direct buffer. Next: a full power off, check whether the fan follows OpenRGB Direct, and if it still doesn't, run SignalRGB plus `wraith-capture.ps1` elevated.

**USB capture 2026-11-20** (`verify\capture\usbpcap3.pcap` is SignalRGB starting up; `run1\` is SignalRGB already running). The Wraith is bus 3, device 2. From launch SignalRGB sends, in order:
- string descriptor reads (indexes 1 to 3)
- `41 03`
- `51 28 00 00 E0`
- `C0 01 0F 00` (ids 0 to 14) and `C0 01 02 00` (ids 15 and 16) every ~35 ms, nonstop, on interrupt OUT 0x04. The cooler echoes each one on IN 0x83.

There are no control transfers, feature reports, remaps or effect commands. That is byte for byte what `wraith-test.ps1` and `wraith-stream.ps1` send.

`wraith-stream.ps1` (SignalRGB closed, red, 31 frames/s for 8 s): the ring went red, the fan did not. While SignalRGB ran its pink and blue effect, Julian saw the fan go from yellow to white. Neither color is in SignalRGB's stream, where the fan (id 01) only ever gets `0A 2F FF` or `FF 05 B0`. **So SignalRGB does not control the fan LED right now either.** The fan runs its own hardware effect and ignores Direct mode, whoever sends it. The fan LED was likely last seen following SignalRGB before the 10/28 remap tests. Next: a full power off (PSU off or unplugged for 30 s) to see whether the cooler restores its map. If it doesn't, find the factory channel map for `51 A0`.

**Online check 2026-11-20.** No published write-up covers the fan LED ignoring Direct. Two sources pin down the protocol:
- cm-rgb (github.com/gfduszynski/cm-rgb, `cm_rgb/ctrl.py`), the reverse-engineered Cooler Master utility protocol:
  - Channels: ring static 0x00, ring breathe 0x01, ring cycle 0x02, logo 0x05, fan 0x06, ring rainbow 0x07, ring swirl 0x0A, off 0xFE.
  - `51 A0` assigns logo, fan, then 15 ring LEDs to channels.
  - `51 2C` sets a channel: `ch speed color_source mode FF brightness R G B`. color_source `0x20` means "use the supplied color". Our `wraith-fan-channel.ps1` sent `0x00` there, which may be why it never showed our color.
  - `50` loads the config saved in flash, and `50 55` saves to it. Our scripts never sent `50 55`, so the flash should be untouched.
  - `51 71` is **Mirage**, a fan-LED-only strobe (one frequency per R, G, B). cm-rgb turns it off first in its restore sequence. A Mirage left on would hit only the fan LED, which fits.
  - Its restore sequence: Mirage off, `50`, `41 03`, `41 00`, apply.
- OpenRGB's remap packet template is `05 06` then `07` x15 (logo 0x05, fan 0x06, ring rainbow 0x07), likely the factory map. The 10/28 remap kept fan at 0x06 and only moved the ring. **So the fan's map entry was never changed, and the remap is probably not the cause.**

Next test, no admin, SignalRGB closed: `scripts/wraith-restore.ps1` sends cm-rgb's restore sequence (Mirage off, load from flash), then streams red for 6 s. If the fan goes red, Mirage or the live state was the cause, and KelvinRGB needs Mirage off plus `50` once at startup.

**Results, same day.**
- `wraith-restore.ps1`: the ring went red, the blade stayed yellow.
- Corrected `wraith-fan-channel.ps1` (cm-rgb init `41 80` + `51 96`, channel 0x06 static red, color_source `0x20`, apply): the blade stayed yellow.
- SignalRGB: only `AMD/AMD_Wraith_Prism.js` claims 2516:0051, and the launch capture holds nothing beyond it. It has no fan override.

**Conclusion:** the fan blade LED now ignores every documented route: Direct (`C0`), its effect channel (`51 2C` ch 0x06), Mirage off, and reload from flash. The logo and ring obey the same packets on the same handle. SignalRGB doesn't drive it today either. The yellow-to-white drift is not in any stream we or SignalRGB send. What's left is the cooler itself: either its controller is stuck, which a full power off (PSU off or unplugged for 30 s) would clear, or the fan LED or its cable is faulty. If it is still yellow after a power off, reseat the fan's small LED connector under the shroud. If that doesn't fix it, treat it as hardware, and KelvinRGB needs no code change.

**Correction, same day: the fan does take Direct, but only its blue channel works.** Found with the webcam ("USB  Live camera", frames in `D:\wraith-cam\`). `wraith-stream.ps1 -FanOnly` lights LED id 1 with everything else black, so no ring light reflects onto the blade.
- The fan's red and green inputs do nothing. The blade always shows a warm yellow, as if its red and green dies are stuck on.
- Blue adds to that yellow, so the visible range is yellow (B low) to white (B high), which matches what Julian sees.
- Blue is invisible up to about 184. It tints the blade from about 192, and the camera's blade B/R ratio crosses neutral (white) at about 232–240. 255 is a slightly cool white.
- **The midpoint of the yellow-to-white change is B ≈ 224. White is B ≥ 240.**
- Earlier "the fan ignores everything" readings came from sending red, which this LED can't show, and from ring light on the blade.
- AMD's official utility (v1.17, installed in `C:\Program Files (x86)\AMD Wraith\Wraith Prism`, capture in `verify\capture\usbpcap3.pcap`) sends the fan `51 2C 01 00 06 FF 00 01 FF FF FF 00 00` (channel 0x06 static R=255) and never changes it. It also uploads `51 70` lookup tables and saves with `50 55`.

So to keep the fan white, give LED id 1 blue ≥ 240, whatever the R and G.

**In KelvinRGB (2026-11-20):** `render()` in `main.js` overrides LED id 1 of "AMD Wraith Prism" with `255,255,fanWhite` (default 240, 0 when lighting is off, skipped while flashing). The Wraith's Devices page has a "fan blade · yellow to white" slider (160–255), saved as `settings.devices[key].fanWhite`. Checked on camera with the app running: blade white, ring follows the effect color.

Original plan for that test, no admin: `uv run --with openrgb-python python scripts/wraith-header-test.py 0 255 0 10`. It sets both RGB headers green for 10 s, then sets the board back to Off. If the fan LED turns green, the fix is in KelvinRGB's ASUS board output (LEDs 3 and 4 in Direct mode), not in the Wraith code. If it doesn't, check the cable and do a full power off. Then capture SignalRGB with `wraith-capture.ps1`. USBPcap's driver is already running, so the capture needs admin but no reboot.

## Scripts
- `scripts/wraith-restore.ps1`: cm-rgb restore sequence (Mirage off, load from flash, hardware mode, apply), then a Direct stream test. No admin, writes nothing to flash.
- `scripts/wraith-stream.ps1`: streams SignalRGB's exact Wraith packets at its rate for N seconds. No admin. Close SignalRGB first.
- `scripts/wraith-capture.ps1`: USBPcap capture of every root hub, elevated. It writes pcap through stdout, because USBPcapCMD's `-o file` fails here with "invalid write handle".
- `scripts/wraith-header-test.py`: sets the ASUS board's two 12V RGB headers to a color for N seconds, then back to Off. It tests whether the fan LED is wired through the board.
- `scripts/rgb-off.py`: all lights off through the running OpenRGB server (:6742), no app needed. `uv run --with openrgb-python python scripts/rgb-off.py`. The Wraith fan LED stays as is.

## Stale copy
`Projects\RGB` is the first copy before the rename. Not deleted. Julian decides.
