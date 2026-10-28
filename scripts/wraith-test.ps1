# Sends SignalRGB-style direct packets to the AMD Wraith Prism over USB HID (via HidSharp from the sidecar).
# All 17 LEDs (0 logo, 1 fan, 2-16 ring) set to one color, in id order, 15 per packet.
param([byte]$R = 255, [byte]$G = 255, [byte]$B = 255)
Add-Type -Path (Join-Path $PSScriptRoot '..\sidecar\lib\HidSharp.dll')
$dev = [HidSharp.DeviceList]::Local.GetHidDevices(0x2516, 0x0051) | Where-Object { $_.GetMaxOutputReportLength() -ge 65 } | Select-Object -First 1
if (-not $dev) { 'Wraith Prism HID interface not found'; exit 1 }
"using $($dev.DevicePath)"
$s = $dev.Open()
function Send([byte[]]$bytes) { $buf = New-Object byte[] 65; [Array]::Copy($bytes, $buf, $bytes.Length); $s.Write($buf); $null = $s.Read((New-Object byte[] 65)) }
Send @(0x00, 0x41, 0x03)                    # software mode
Send @(0x00, 0x51, 0x28, 0x00, 0x00, 0xE0)  # apply / direct
$data = @(); for ($id = 0; $id -le 16; $id++) { $data += @([byte]$id, $R, $G, $B) }
Send (@(0x00, 0xC0, 0x01, 15, 0x00) + $data[0..59])
Send (@(0x00, 0xC0, 0x01, 2, 0x00) + $data[60..67])
$s.Close()
'sent'
