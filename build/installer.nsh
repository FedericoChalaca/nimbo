; Al desinstalar (no al actualizar) se quitan los hooks de Nimbo de ~/.claude/settings.json.
; Si quedaran, Claude Code seguiría llamando en cada evento a un programa que ya no existe.
; Se usa el propio Nimbo.exe en modo Node para correr install-hooks.js --uninstall (hace backup).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "1")i'
    nsExec::Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "$INSTDIR\resources\app\install-hooks.js" --uninstall'
    System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "")i'
  ${endIf}
!macroend
