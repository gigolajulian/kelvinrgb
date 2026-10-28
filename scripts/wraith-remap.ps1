# Test: rewrite the Wraith Prism LED-to-channel map (logo -> 0x05, fan -> 0x06, ring -> $Ring), then set the fan channel color.
param([byte]$R = 255, [byte]$G = 0, [byte]$B = 255, [byte]$Ring = 0x00)
Add-Type -Path (Join-Path $PSScriptRoot '..\sidecar\lib\HidSharp.dll')
$dev = [HidSharp.DeviceList]::Local.GetHidDevices(0x2516, 0x0051) | Where-Object { $_.GetMaxOutputReportLength() -ge 65 } | Select-Object -First 1
if (-not $dev) { 'Wraith Prism HID interface not found'; exit 1 }
$s = $dev.Open()
function Send([byte[]]$bytes, [byte]$fill = 0) {
  $buf = New-Object byte[] 65; for ($i = 0; $i -lt 65; $i++) { $buf[$i] = $fill }
  [Array]::Copy($bytes, $buf, $bytes.Length); $s.Write($buf); $null = $s.Read((New-Object byte[] 65))
}
# channel remap as OpenRGB builds it: 51 A0 01 00 00 03 00 00 | logo fan ring x15
$remap = @(0x00, 0x51, 0xA0, 0x01, 0x00, 0x00, 0x03, 0x00, 0x00, 0x05, 0x06) + (@($Ring) * 15)
Send $remap
Send @(0x00, 0x51, 0x2C, 0x01, 0x00, 0x06, 0xFF, 0x00, 0x01, 0xFF, 0xFF, $R, $G, $B, 0x00, 0x00, 0x00) 0xFF
Send @(0x00, 0x51, 0x28, 0x00, 0x00, 0xE0)
$s.Close()
"remapped fan -> 0x06 and set it to $R,$G,$B"
