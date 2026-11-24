# Builds sidecar.exe with the C# compiler that ships with Windows (.NET Framework 4.x). No .NET SDK needed.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path lib\LibreHardwareMonitorLib.dll)) { node fetch-deps.mjs }
$fw = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319"
$refs = @("$fw\System.Web.Extensions.dll", "$fw\System.Management.dll", "$fw\netstandard.dll",'lib\LibreHardwareMonitorLib.dll', 'lib\HidSharp.dll')
& "$fw\csc.exe" /nologo /optimize /platform:x64 /target:exe /out:sidecar.exe ($refs | ForEach-Object { "/r:$_" }) sidecar.cs pump.cs
if ($LASTEXITCODE) { throw "csc failed" }
'built sidecar.exe'
