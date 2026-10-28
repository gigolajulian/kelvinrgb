# Admin hardware check. Run elevated. Writes everything to verify\log.txt and verify\*.png.
# Optional: -Fans runs the sidecar fan walk (100% / 30% / floor / graceful exit / hard kill).
param([switch]$Fans)
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot
$out = Join-Path $root 'verify'
New-Item -ItemType Directory -Force $out | Out-Null
Start-Transcript -Path (Join-Path $out 'log.txt') -Force | Out-Null
Set-Location $root

if (Get-Process r5apex, r5apex_dx12, EasyAntiCheat, EasyAntiCheat_EOS -ErrorAction SilentlyContinue) { 'ABORT: Apex or EAC is running'; Stop-Transcript; exit 1 }

'== stop SignalRGB'
Get-Process SignalRgb* -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process SignalRgb* -ErrorAction SilentlyContinue | Select-Object Name | Out-String

'== stop Armoury Crate and NZXT CAM for this run (they hold the Aura and NZXT USB devices)'
Stop-Service ArmouryCrateService -Force -ErrorAction SilentlyContinue
Get-Process Armoury*, asus_framework, 'NZXT CAM', cam_helper -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2
Get-Process Armoury*, asus_framework, 'NZXT CAM', cam_helper -ErrorAction SilentlyContinue | Select-Object Name | Out-String

'== restart OpenRGB elevated, wait for full detection'
Get-Process OpenRGB -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2
Start-Process 'C:\Program Files\OpenRGB\OpenRGB.exe' -ArgumentList '--server', '--startminimized'
Start-Sleep 45

if ($Fans) { '== fan check'; node scripts\fan-check.mjs 2>&1 | Out-String }

'== app run: static #00b4d8 at 100%, Chipset Fan on a flat 30% curve'
$cfgDir = Join-Path $env:APPDATA 'kelvinrgb'
New-Item -ItemType Directory -Force $cfgDir | Out-Null
$cfg = '{"lighting":{"effect":"static","color":"#00b4d8","speed":40,"brightness":100,"on":true},"devices":{},"fans":{"/lpc/nct6798d/0/control/4":{"mode":"curve","sensor":"/lpc/nct6798d/0/temperature/22","shape":"linear","points":[[20,30],[100,30]],"fixed":50}}}'
[IO.File]::WriteAllText((Join-Path $cfgDir 'settings.json'), $cfg)  # no BOM
$env:RGB_SHOT = $out
$app = Start-Process .\node_modules\electron\dist\electron.exe -ArgumentList '.' -PassThru -RedirectStandardOutput (Join-Path $out 'app.out') -RedirectStandardError (Join-Path $out 'app.err')
Start-Sleep 25
'== colors read back from OpenRGB'
node scripts\color-check.mjs 2>&1 | Out-String
Stop-Process -Id $app.Id -Force
Start-Sleep 3
'== app stdout'
Get-Content (Join-Path $out 'app.out') | Out-String
'== sidecar left running?'
Get-Process sidecar -ErrorAction SilentlyContinue | Select-Object Id | Out-String
'DONE'
Stop-Transcript | Out-Null
