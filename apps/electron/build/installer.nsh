; input: Fresh per-user Storyflow installation on Windows
; output: Best-effort Git for Windows provisioning through the native WinGet client
; pos: NSIS dependency hook; runtime onboarding remains the failure fallback

!macro customInstall
  ${ifNot} ${isUpdated}
    IfFileExists "$LOCALAPPDATA\Programs\Git\bin\bash.exe" git_ready 0
    IfFileExists "$PROGRAMFILES64\Git\bin\bash.exe" git_ready 0
    IfFileExists "$PROGRAMFILES32\Git\bin\bash.exe" git_ready 0

    SearchPath $0 "winget.exe"
    StrCmp $0 "" git_ready 0

    DetailPrint "Installing Git for Windows..."
    ExecWait '"$0" install --id Git.Git --exact --source winget --scope user --silent --disable-interactivity --accept-source-agreements --accept-package-agreements --no-upgrade' $1
    DetailPrint "Git for Windows installer exited with code $1"

    git_ready:
  ${endIf}
!macroend
