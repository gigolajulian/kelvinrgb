; Update in place. If KelvinRGB is running, ask it to quit cleanly (KelvinRGB.exe --quit reaches the running
; copy), so its sensor service hands every fan back to the BIOS before files are replaced. If it is still
; running after 10 s it is force-closed. If it is not running, nothing is started.
!macro customCheckAppRunning
  StrCpy $R1 0
  nsExec::Exec '"$SYSDIR\cmd.exe" /c "$SYSDIR\tasklist.exe" /FI "IMAGENAME eq KelvinRGB.exe" /NH | "$SYSDIR\find.exe" /I "KelvinRGB.exe"'
  Pop $R0
  StrCmp $R0 0 0 kelvin_done
  StrCpy $R2 "$INSTDIR\KelvinRGB.exe"
  IfFileExists $R2 +2 0
    StrCpy $R2 "$PROGRAMFILES64\KelvinRGB\KelvinRGB.exe"
  IfFileExists $R2 0 kelvin_wait
    Exec '"$R2" --quit'
  kelvin_wait:
    Sleep 500
    nsExec::Exec '"$SYSDIR\cmd.exe" /c "$SYSDIR\tasklist.exe" /FI "IMAGENAME eq KelvinRGB.exe" /NH | "$SYSDIR\find.exe" /I "KelvinRGB.exe"'
    Pop $R0
    StrCmp $R0 0 0 kelvin_done
    IntOp $R1 $R1 + 1
    IntCmp $R1 20 0 kelvin_wait
    nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM KelvinRGB.exe'
    StrCpy $R1 0
  kelvin_gone:
    Sleep 500
    nsExec::Exec '"$SYSDIR\cmd.exe" /c "$SYSDIR\tasklist.exe" /FI "IMAGENAME eq KelvinRGB.exe" /NH | "$SYSDIR\find.exe" /I "KelvinRGB.exe"'
    Pop $R0
    StrCmp $R0 0 0 kelvin_done
    IntOp $R1 $R1 + 1
    IntCmp $R1 10 0 kelvin_gone
  kelvin_done:
!macroend
