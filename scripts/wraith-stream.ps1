# Test: stream SignalRGB's exact Wraith Prism packets at its rate (about 56 frames/s) for $Seconds.
# Captured 2026-11-20: SignalRGB sends only C0 01 0F 00 (LED ids 0-14) then C0 01 02 00 (ids 15-16), nonstop, on interrupt OUT 0x04.
# Close SignalRGB first so only this script writes. No admin needed.
param([byte]$R = 255, [byte]$G = 0, [byte]$B = 0, [int]$Seconds = 8, [switch]$NoInit, [switch]$FanOnly)  # -FanOnly: color on LED id 1, everything else black
Add-Type -Path (Join-Path $PSScriptRoot '..\sidecar\lib\HidSharp.dll')
$dev = [HidSharp.DeviceList]::Local.GetHidDevices(0x2516, 0x0051) | Where-Object { $_.GetMaxOutputReportLength() -ge 65 } | Select-Object -First 1
if (-not $dev) { 'Wraith Prism HID interface not found'; exit 1 }
$s = $dev.Open()
function Send([byte[]]$bytes) { $buf = New-Object byte[] 65; [Array]::Copy($bytes, $buf, $bytes.Length); $s.Write($buf) }
if (-not $NoInit) {
  Send @(0x00, 0x41, 0x03)                    # software mode
  Send @(0x00, 0x51, 0x28, 0x00, 0x00, 0xE0)  # direct
}
$data = @(); for ($id = 0; $id -le 16; $id++) { $on = (-not $FanOnly) -or $id -eq 1; $data += @([byte]$id, $(if ($on) { $R } else { 0 }), $(if ($on) { $G } else { 0 }), $(if ($on) { $B } else { 0 })) }
$p1 = [byte[]](@(0x00, 0xC0, 0x01, 15, 0x00) + $data[0..59])
$p2 = [byte[]](@(0x00, 0xC0, 0x01, 2, 0x00) + $data[60..67])
$end = (Get-Date).AddSeconds($Seconds); $n = 0
while ((Get-Date) -lt $end) { Send $p1; Send $p2; $n++; Start-Sleep -Milliseconds 16 }
$s.Close()
"streamed $n frames of $R,$G,$B in $Seconds s"
