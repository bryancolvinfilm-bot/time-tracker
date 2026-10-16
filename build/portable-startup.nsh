!include WinMessages.nsh
!include LogicLib.nsh

Page instfiles "" StartupPageShow
XPStyle on
InstallColors 253047 F0F0F0

Var StartupHeading
Var StartupProgress
Var StartupHint
Var StartupFont
Var StartupSmallFont
Var StartupProcess
Var StartupNativeProcess
Var StartupResult
Var StartupArguments
Var StartupReadyFile
Var StartupHidden
Var StartupExitCode
Var StartupLog

Function StartupLogEvent
  Exch $R8
  Push $R9
  ReadEnvStr $StartupLog "TIME_TRACKER_STARTUP_TEST_LOG"
  StrCmp $StartupLog "" done
  FileOpen $R9 $StartupLog a
  FileWrite $R9 "$R8$\r$\n"
  FileClose $R9
done:
  Pop $R9
  Pop $R8
FunctionEnd

Function StartupPageShow
  ; Hide the installer furniture; this is a launch status window, not a setup UI.
  System::Call 'user32::GetWindow(p $HWNDPARENT, i 5) p.r0'
hide_children:
  StrCmp $0 0 children_hidden
  System::Call 'user32::ShowWindow(p r0, i 0)'
  System::Call 'user32::GetWindow(p r0, i 2) p.r0'
  Goto hide_children
children_hidden:
  System::Call 'user32::GetSystemMetrics(i 0) i.r0'
  System::Call 'user32::GetSystemMetrics(i 1) i.r1'
  IntOp $0 $0 - 400
  IntOp $0 $0 / 2
  IntOp $1 $1 - 160
  IntOp $1 $1 / 2
  System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i r0, i r1, i 400, i 160, i 4)'
  System::Call 'user32::GetSystemMenu(p $HWNDPARENT, i 0) p.r0'
  System::Call 'user32::EnableMenuItem(p r0, i 0xF060, i 1)'
  CreateFont $StartupFont "Segoe UI" 12 600
  CreateFont $StartupSmallFont "Segoe UI" 9
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "Unpacking Time Tracker...", i 0x50000000, i 20, i 15, i 350, i 26, p $HWNDPARENT, p 0, p 0, p 0) p.s'
  Pop $StartupHeading
  SendMessage $StartupHeading ${WM_SETFONT} $StartupFont 1
  SetCtlColors $StartupHeading 8472EC F0F0F0
  ; The common control animates on the UI thread while NSIS extracts on its worker.
  System::Call 'user32::CreateWindowExW(i 0, w "msctls_progress32", w "", i 0x50000009, i 20, i 48, i 344, i 9, p $HWNDPARENT, p 0, p 0, p 0) p.s'
  Pop $StartupProgress
  SendMessage $StartupProgress 0x040A 1 30
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "Preparing the portable app. Just a moment.", i 0x50000000, i 20, i 70, i 350, i 22, p $HWNDPARENT, p 0, p 0, p 0) p.s'
  Pop $StartupHint
  SendMessage $StartupHint ${WM_SETFONT} $StartupSmallFont 1
  SetCtlColors $StartupHint 7C8595 F0F0F0
  ShowWindow $HWNDPARENT ${SW_SHOWNORMAL}
  System::Call 'user32::UpdateWindow(p $HWNDPARENT)'
FunctionEnd

Function StartupBegin
  ; NSIS shows its stock page after PageCallbacks returns; hide it now, keeping
  ; only our controls (which must be created on the GUI thread for animation).
  System::Call 'user32::GetWindow(p $HWNDPARENT, i 5) p.r0'
hide_stock:
  StrCmp $0 0 stock_hidden
  StrCmp $0 $StartupHeading next_child
  StrCmp $0 $StartupProgress next_child
  StrCmp $0 $StartupHint next_child
  System::Call 'user32::ShowWindow(p r0, i 0)'
next_child:
  System::Call 'user32::GetWindow(p r0, i 2) p.r0'
  Goto hide_stock
stock_hidden:
  SendMessage $HWNDPARENT ${WM_SETTEXT} 0 "STR:Time Tracker"
  System::Call 'user32::InvalidateRect(p $HWNDPARENT, p 0, i 1)'
  System::Call 'user32::IsWindowVisible(p $HWNDPARENT) i.r0'
  System::Call 'user32::GetWindowLongW(p $StartupProgress, i -16) i.r1'
  IntOp $1 $1 & 8
  Push "unpacking visible=$0 marquee=$1"
  Call StartupLogEvent
  ; Optional controlled pause for inspecting animation in launcher QA, never normal use.
  ReadEnvStr $R0 "TIME_TRACKER_STARTUP_TEST_HOLD"
  StrCmp $StartupLog "" no_hold
  StrCmp $R0 "1" 0 no_hold
  Sleep 60000
no_hold:
FunctionEnd

Function PortableLaunch
  SendMessage $StartupHeading ${WM_SETTEXT} 0 "STR:Starting Time Tracker..."
  Push "starting"
  Call StartupLogEvent
  StrCpy $StartupReadyFile "$PLUGINSDIR\time-tracker-ready"
  System::Call 'kernel32::SetEnvironmentVariableW(w "TIME_TRACKER_PORTABLE_READY", w "$StartupReadyFile")'
  ${StdUtils.ExecShellWaitEx} $StartupResult $StartupProcess "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "open" "$StartupArguments"
  StrCmp $StartupResult "ok" launched
  HideWindow
  MessageBox MB_OK|MB_ICONEXCLAMATION "Time Tracker could not start. Please try opening it again."
  StrCpy $StartupExitCode 1
  Return
launched:
  ; StdUtils represents handles as "hProc:XXXXXXXX"; System expects a numeric pointer.
  StrCpy $StartupNativeProcess $StartupProcess "" 6
  StrCpy $StartupNativeProcess "0x$StartupNativeProcess"
  StrCpy $StartupHidden 0
wait_for_app:
  System::Call 'kernel32::WaitForSingleObject(p $StartupNativeProcess, i 100) i.r0'
  StrCmp $0 0 app_finished
  StrCmp $StartupHidden 1 wait_for_app
  IfFileExists $StartupReadyFile 0 wait_for_app
  HideWindow
  SendMessage $StartupProgress 0x040A 0 0
  StrCpy $StartupHidden 1
  System::Call 'user32::IsWindowVisible(p $HWNDPARENT) i.r0'
  Push "ready hidden visible=$0"
  Call StartupLogEvent
  Goto app_finished
app_finished:
  ${StdUtils.WaitForProcEx} $StartupExitCode $StartupProcess
  StrCmp $StartupExitCode "error" 0 +2
  StrCpy $StartupExitCode 1
  HideWindow
  Push "finished"
  Call StartupLogEvent
FunctionEnd
