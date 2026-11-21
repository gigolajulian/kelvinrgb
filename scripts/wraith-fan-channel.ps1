# Test: set the Wraith Prism fan LED through its own effect channel (0x06), the way cm-rgb does
# (github.com/gfduszynski/cm-rgb ctrl.py): 41 80 (power on), 51 96, then 51 2C on channel 0x06 with
# color_source 0x20 ("use supplied color"), static mode 0x01, then apply. Close SignalRGB first. No admin.
# The 2026-10-28 version sent color_source 0x00 and no 41 80 / 51 96, which is why it was unreliable.
param([byte]$R = 255, [byte]$G = 0, [byte]$B = 0, [byte]$Brightness = 0xFF)
Add-Type -Path (Join-Path $PSScriptRoot '..\sidecar\lib\HidSharp.dll')
$dev = [HidSharp.DeviceList]::Local.GetHidDevices(0x2516, 0x0051) | Where-Object { $_.GetMaxOutputReportLength() -ge 65 } | Select-Object -First 1
if (-not $dev) { 'Wraith Prism HID interface not found'; exit 1 }
$s = $dev.Open()
function Send([byte[]]$bytes, [byte]$fill = 0) {
  $buf = New-Object byte[] 65; for ($i = 1; $i -lt 65; $i++) { $buf[$i] = $fill }
  [Array]::Copy($bytes, $buf, $bytes.Length); $s.Write($buf); $null = $s.Read((New-Object byte[] 65))
}
Send @(0x00, 0x41, 0x80)                    # power on / hardware effects
Send @(0x00, 0x51, 0x96)                    # cm-rgb startup "magic"
Send @(0x00, 0x51, 0x28, 0x00, 0x00, 0xE0)  # apply
# 51 2C 01 00 | channel speed color_source mode FF brightness R G B 00 00 00, rest FF
Send @(0x00, 0x51, 0x2C, 0x01, 0x00, 0x06, 0xFF, 0x20, 0x01, 0xFF, $Brightness, $R, $G, $B, 0x00, 0x00, 0x00) 0xFF
Send @(0x00, 0x51, 0x28, 0x00, 0x00, 0xE0)  # apply
$s.Close()
"fan channel 0x06 static $R,$G,$B"
