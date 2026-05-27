Var clabSeededInstallLocation

Function clabCleanupSeededInstallLocation
  StrCmp $clabSeededInstallLocation "1" 0 clabCleanupSeededInstallLocationDone
  DeleteRegValue HKCU "Software\${APP_GUID}" "InstallLocation"
  DeleteRegKey /ifempty HKCU "Software\${APP_GUID}"
  StrCpy $clabSeededInstallLocation "0"

  clabCleanupSeededInstallLocationDone:
FunctionEnd

Function .onInstFailed
  Call clabCleanupSeededInstallLocation
FunctionEnd

Function .onGUIEnd
  Call clabCleanupSeededInstallLocation
FunctionEnd

!macro preInit
  !ifndef BUILD_UNINSTALLER
    StrCpy $clabSeededInstallLocation "0"
    ReadRegStr $0 HKCU "Software\${APP_GUID}" "InstallLocation"
    StrCmp $0 "" 0 +3
    # Avoid electron-builder's per-user SHGetKnownFolderPath call through NSIS System.dll.
    WriteRegStr HKCU "Software\${APP_GUID}" "InstallLocation" "$LocalAppData\Programs\${APP_FILENAME}"
    StrCpy $clabSeededInstallLocation "1"
  !endif
!macroend

!macro customInstallMode
  StrCmp $clabSeededInstallLocation "1" 0 +2
  StrCpy $hasPerUserInstallation "0"
!macroend

!macro customInstall
  StrCmp $clabSeededInstallLocation "1" 0 clabCustomInstallDone
  StrCmp $installMode "CurrentUser" 0 +3
  StrCpy $clabSeededInstallLocation "0"
  Goto clabCustomInstallDone
  Call clabCleanupSeededInstallLocation

  clabCustomInstallDone:
!macroend
