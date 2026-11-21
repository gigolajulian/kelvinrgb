; Update in place: ask a running KelvinRGB to quit cleanly first, so its sensor service hands every fan
; back to the BIOS before files are replaced. Only if it is still running after 10 s is it force-closed.
!macro customCheckAppRunning
  StrCpy $R2 "$INSTDIR\KelvinRGB.exe"
  IfFileExists $R2 +2 0
    StrCpy $R2 "$PROGRAMFILES64\KelvinRGB\KelvinRGB.exe"
  IfFileExists $R2 0 kelvin_done
  Exec '"$R2" --quit'
  StrCpy $R1 0
  kelvin_wait:
    nsExec::Exec '"$SYSDIR\cmd.exe" /c "$SYSDIR\tasklist.exe" /FI "IMAGENAME eq KelvinRGB.exe" /NH | "$SYSDIR\find.exe" /I "KelvinRGB.exe"'
    Pop $R0
    StrCmp $R0 0 0 kelvin_done
    IntOp $R1 $R1 + 1
    IntCmp $R1 20 kelvin_force
    Sleep 500
    Goto kelvin_wait
  kelvin_force:
    nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM KelvinRGB.exe'
    Sleep 1000
  kelvin_done:
!macroend
