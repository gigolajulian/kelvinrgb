# Reset the Wraith Prism to its saved (flash) settings without a power cycle, with cm-rgb's restore sequence
# (github.com/gfduszynski/cm-rgb, ctrl.py): Mirage off, load from flash (0x50), power-off/restore, apply.
# Then optionally stream a color to see whether the fan LED now takes Direct frames. Close SignalRGB first. No admin.
# Writes nothing to flash (0x50 0x55 is "save"; this sends only 0x50 "load").
param([byte]$R = 255, [byte]$G = 0, [byte]$B = 0, [int]$Seconds = 6, [switch]$NoStream)
Add-Type -Path (Join-Path $PSScriptRoot '..\sidecar\lib\HidSharp.dll')
$dev = [HidSharp.DeviceList]::Local.GetHidDevices(0x2516, 0x0051) | Where-Object { $_.GetMaxOutputReportLength() -ge 65 } | Select-Object -First 1
if (-not $dev) { 'Wraith Prism HID interface not found'; exit 1 }
$s = $dev.Open()
function Send([byte[]]$bytes) { $buf = New-Object byte[] 65; [Array]::Copy($bytes, $buf, $bytes.Length); $s.Write($buf); $null = $s.Read((New-Object byte[] 65)) }
# Mirage off: fan-LED strobe per color channel; 00 FF 4A = disabled (cm-rgb hzToBytes(0))
Send @(0x00, 0x51, 0x71, 0x00, 0x00, 0x01, 0x00, 0xFF, 0x4A, 0x02, 0x00, 0xFF, 0x4A, 0x03, 0x00, 0xFF, 0x4A, 0x04, 0x00, 0xFF, 0x4A)
Send @(0x00, 0x50)                          # load saved config from flash
Send @(0x00, 0x41, 0x03)
Send @(0x00, 0x41, 0x00)                    # restore / hardware mode
Send @(0x00, 0x51, 0x28, 0x00, 0x00, 0xE0)  # apply
'restored from flash (Mirage off). Fan should now show its saved hardware effect.'
if (-not $NoStream) {
  Start-Sleep 3
  $s.Close()
  & (Join-Path $PSScriptRoot 'wraith-stream.ps1') -R $R -G $G -B $B -Seconds $Seconds
} else { $s.Close() }
