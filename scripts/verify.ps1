# Admin hardware check. Run elevated. Writes everything to verify\log.txt and verify\*.png.
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot
$out = Join-Path $root 'verify'
New-Item -ItemType Directory -Force $out | Out-Null
Start-Transcript -Path (Join-Path $out 'log.txt') -Force | Out-Null
Set-Location $root

if (Get-Process r5apex, r5apex_dx12, EasyAntiCheat, EasyAntiCheat_EOS -ErrorAction SilentlyContinue) { 'ABORT: Apex or EAC is running'; Stop-Transcript; exit 1 }

'== stop SignalRGB'
Stop-Service SignalRgbService -Force -ErrorAction SilentlyContinue
Get-Process SignalRgb* -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Service SignalRgbService -ErrorAction SilentlyContinue | Select-Object Name, Status | Out-String

'== restart OpenRGB elevated'
Get-Process OpenRGB -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2
Start-Process 'C:\Program Files\OpenRGB\OpenRGB.exe' -ArgumentList '--server', '--startminimized'
Start-Sleep 20

'== fan check'
node scripts\fan-check.mjs 2>&1 | Out-String

'== app run with static cyan'
$cfgDir = Join-Path $env:APPDATA 'kelvinrgb'
New-Item -ItemType Directory -Force $cfgDir | Out-Null
'{"lighting":{"effect":"static","color":"#00b4d8","speed":40,"brightness":100,"on":true},"devices":{},"fans":{}}' | Set-Content -Encoding utf8 (Join-Path $cfgDir 'settings.json')
$env:RGB_SHOT = $out
$app = Start-Process .\node_modules\electron\dist\electron.exe -ArgumentList '.' -PassThru -RedirectStandardOutput (Join-Path $out 'app.out') -RedirectStandardError (Join-Path $out 'app.err')
Start-Sleep 22
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
