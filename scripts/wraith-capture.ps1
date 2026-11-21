# Records USB traffic on every USBPcap root hub for $Seconds while SignalRGB changes the Wraith fan color.
# Needs admin and USBPcap (winget desowin.USBPcap). Output: verify\capture\usbpcapN.pcap plus usbpcapN.err (USBPcapCMD's errors).
param([int]$Seconds = 45)
$cmd = 'C:\Program Files\USBPcap\USBPcapCMD.exe'
$dir = Join-Path (Split-Path $PSScriptRoot) 'verify\capture'
New-Item -ItemType Directory -Force $dir | Out-Null
$hubs = & $cmd --extcap-interfaces | ForEach-Object { if ($_ -match 'value=(\\\\\.\\USBPcap\d+)') { $matches[1] } }
"hubs: $($hubs -join ', ')"
$procs = foreach ($h in $hubs) {
  $n = $h -replace '.*USBPcap', 'usbpcap'
  # -o - writes pcap to stdout; USBPcapCMD fails to open -o file paths here ("invalid write handle")
  Start-Process $cmd -ArgumentList '-d', $h, '-o', '-', '-A' -NoNewWindow -PassThru `
    -RedirectStandardOutput "$dir\$n.pcap" -RedirectStandardError "$dir\$n.err"
}
Start-Sleep 2
$procs | ForEach-Object { "pid $($_.Id) exited: $($_.HasExited)" }
Write-Host "Recording for $Seconds s. In SignalRGB, set the Wraith Prism to red, then green, then blue, a few seconds each."
Start-Sleep $Seconds
$procs | Stop-Process -ErrorAction SilentlyContinue
Get-ChildItem $dir | Select-Object Name, Length, LastWriteTime
