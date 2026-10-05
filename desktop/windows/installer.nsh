; electron-builder NSIS hooks (per-machine install, so these run elevated).
; The capture task points into the install dir, which only administrators can change.

!include nsDialogs.nsh

; Set by the options page; empty in a silent install (updates), which keeps the defaults.
!ifndef BUILD_UNINSTALLER
  Var noDesktopShortcut
  Var autoStart
!endif

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

; Install folder is fixed (Program Files); this page only asks for the extras.
!macro customPageAfterChangeDir
  Page custom OptionsPageShow OptionsPageLeave

  Var desktopBox
  Var autoStartBox

  Function OptionsPageShow
    !insertmacro MUI_HEADER_TEXT "Options" "Choose extras for ${PRODUCT_NAME}."
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateCheckbox} 0 0 100% 12u "Create a desktop shortcut"
    Pop $desktopBox
    ${NSD_Check} $desktopBox
    ${NSD_CreateCheckbox} 0 18u 100% 12u "Start ${PRODUCT_NAME} when I sign in to Windows"
    Pop $autoStartBox
    nsDialogs::Show
  FunctionEnd

  Function OptionsPageLeave
    ${NSD_GetState} $desktopBox $0
    ${If} $0 == ${BST_UNCHECKED}
      StrCpy $noDesktopShortcut "1"
    ${EndIf}
    ${NSD_GetState} $autoStartBox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $autoStart "1"
    ${EndIf}
  FunctionEnd
!macroend

!macro customInstall
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\windows\capture-task.ps1" install'

  ${ifNot} ${isUpdated}
    ; electron-builder has just made the desktop shortcut; drop it if declined.
    ${if} $noDesktopShortcut == "1"
      WinShell::UninstShortcut "$newDesktopLink"
      Delete "$newDesktopLink"
    ${endIf}
    ; Same value name Electron's app.setLoginItemSettings uses (the AppUserModelId).
    ; ponytail: HKCU of the elevated user, i.e. whoever approved UAC; a standard user who
    ; types an admin's password gets it on the admin's account. In-app toggle fixes that.
    ${if} $autoStart == "1"
      WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}" '"$appExe"'
    ${endIf}
  ${endIf}
!macroend

!macro customUnInstall
  ; An update runs the old uninstaller first; keep the task and its folders then.
  ${ifNot} ${isUpdated}
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\windows\capture-task.ps1" uninstall'
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
  ${endIf}
!macroend
