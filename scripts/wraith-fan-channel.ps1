# Test: set the Wraith Prism fan LED through its own effect channel (0x06, static mode 0x01) instead of direct packets.
# -Hardware switches the cooler to hardware mode first (0x41 0x00), where effect channels are shown.
param([byte]$R = 255, [byte]$G = 0, [byte]$B = 255, [switch]$Hardware)
Add-Type -Path (Join-Path $PSScriptRoot '..\sidecar\lib\HidSharp.dll')
$dev = [HidSharp.DeviceList]::Local.GetHidDevices(0x2516, 0x0051) | Where-Object { $_.GetMaxOutputReportLength() -ge 65 } | Select-Object -First 1
if (-not $dev) { 'Wraith Prism HID interface not found'; exit 1 }
$s = $dev.Open()
function Send([byte[]]$bytes, [byte]$fill = 0) {
  $buf = New-Object byte[] 65; for ($i = 0; $i -lt 65; $i++) { $buf[$i] = $fill }
  [Array]::Copy($bytes, $buf, $bytes.Length); $s.Write($buf); $null = $s.Read((New-Object byte[] 65))
}
if ($Hardware) { Send @(0x00, 0x41, 0x00) }
# effect channel update: 51 2C 01 00 | channel speed flags mode | FF brightness R G B, rest FF (as OpenRGB does)
Send @(0x00, 0x51, 0x2C, 0x01, 0x00, 0x06, 0xFF, 0x00, 0x01, 0xFF, 0xFF, $R, $G, $B, 0x00, 0x00, 0x00) 0xFF
Send @(0x00, 0x51, 0x28, 0x00, 0x00, 0xE0)  # apply
$s.Close()
"sent fan channel color $R,$G,$B (hardware mode: $Hardware)"
