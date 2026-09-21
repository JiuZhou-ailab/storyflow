# input: Current and previously published NSIS installers, on an ephemeral Windows CI runner
# output: Installed shortcut, upgrade, duplicate-launch and crash-restart evidence
# pos: Windows release gate for #45; retains one Host directory and Electron profile
param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$BaselineInstaller,
  [string]$EvidenceDirectory = 'startup-evidence'
)
$ErrorActionPreference = 'Stop'
if ($env:CI -ne 'true') { throw 'Run this installer acceptance only on an ephemeral CI runner.' }
$root = Join-Path $env:RUNNER_TEMP ('storyflow-startup-' + [guid]::NewGuid())
$installDir = Join-Path $root 'installed'
$startupProfile = Join-Path $root 'profile'
$config = Join-Path $root 'host'
New-Item -ItemType Directory -Force $root, $startupProfile, $config, $EvidenceDirectory | Out-Null
$env:CRAFT_CONFIG_DIR = $config
$env:CRAFT_CLIENT_AUTH_REQUIRED = 'false'
$env:CRAFT_DEBUG = '1'
$configPath = Join-Path $config 'config.json'
'{"workspaces":[],"activeWorkspaceId":null,"activeSessionId":null,"startupPreservationMarker":"keep-this-value"}' | Set-Content -Encoding utf8 $configPath
$exe = Join-Path $installDir 'Storyflow.exe'

function Stop-TestApp {
  Get-Process -Name Storyflow -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process -Force
  $deadline = (Get-Date).AddSeconds(10)
  while (Get-Process -Name Storyflow -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }) {
    if ((Get-Date) -gt $deadline) { throw 'Installed app did not exit' }
    Start-Sleep -Milliseconds 100
  }
}

function Install-Version([string]$path) {
  Stop-TestApp
  $installerProcess = Start-Process -FilePath (Resolve-Path $path) -ArgumentList @('/S', "/D=$installDir") -PassThru -Wait
  if ($installerProcess.ExitCode -ne 0) { throw "Installer failed: $($installerProcess.ExitCode)" }
  if (!(Test-Path $exe)) { throw 'Installed executable missing' }
  Stop-TestApp # NSIS may auto-launch; the shortcut is the entry under test.
}

function Quit-TestApp {
  & bun e2e/core/installed-startup.ts $startupProfile --quit
  if ($LASTEXITCODE -ne 0) { throw 'Could not request a normal application quit' }
  $deadline = (Get-Date).AddSeconds(10)
  while (Get-Process -Name Storyflow -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }) {
    if ((Get-Date) -gt $deadline) { throw 'Normal application quit did not complete' }
    Start-Sleep -Milliseconds 100
  }
}

function Launch-Shortcut([string]$scenario) {
  $wsh = New-Object -ComObject WScript.Shell
  $shortcut = Get-ChildItem -Path ([Environment]::GetFolderPath('Desktop')), ([Environment]::GetFolderPath('Programs')) -Filter '*.lnk' -Recurse |
    Where-Object { $wsh.CreateShortcut($_.FullName).TargetPath -eq $exe } | Select-Object -First 1
  if (!$shortcut) { throw 'Installer did not create a Storyflow shortcut' }
  $link = $wsh.CreateShortcut($shortcut.FullName)
  $link.Arguments = "--user-data-dir=`"$startupProfile`" --remote-debugging-port=0"
  $link.Save()
  Start-Process $shortcut.FullName
  & bun e2e/core/installed-startup.ts $startupProfile | Tee-Object -FilePath (Join-Path $EvidenceDirectory "$scenario.json")
  if ($LASTEXITCODE -ne 0) { throw "Application page failed in $scenario" }
  $stored = Get-Content $configPath -Raw | ConvertFrom-Json
  if ($stored.startupPreservationMarker -ne 'keep-this-value') { throw 'Host configuration was reset' }
  $owners = @(Get-Process -Name Storyflow | Where-Object { $_.Path -eq $exe -and $_.MainWindowHandle -ne 0 })
  if ($owners.Count -ne 1) { throw "Expected one visible application owner, got $($owners.Count)" }
}

try {
  Install-Version $Installer
  Launch-Shortcut 'fresh-install'
  Launch-Shortcut 'second-launch'
  Quit-TestApp
  Launch-Shortcut 'normal-restart'
  Stop-TestApp
  Launch-Shortcut 'crash-restart'
  # Upgrade is a separate retained data lineage; downgrading a new lease format
  # is not a supported migration and must not contaminate the old-version fixture.
  $config = Join-Path $root 'upgrade-host'
  $startupProfile = Join-Path $root 'upgrade-profile'
  New-Item -ItemType Directory -Force $config, $startupProfile | Out-Null
  $configPath = Join-Path $config 'config.json'
  '{"workspaces":[],"activeWorkspaceId":null,"activeSessionId":null,"startupPreservationMarker":"keep-this-value"}' | Set-Content -Encoding utf8 $configPath
  $env:CRAFT_CONFIG_DIR = $config
  Install-Version $BaselineInstaller
  Launch-Shortcut 'upgrade-baseline'
  Install-Version $Installer
  Launch-Shortcut 'upgraded-install'
  Stop-TestApp
  Launch-Shortcut 'upgraded-restart'
} finally {
  Stop-TestApp
  if (Test-Path (Join-Path $startupProfile 'logs')) { Copy-Item (Join-Path $startupProfile 'logs') $EvidenceDirectory -Recurse -Force }
}
