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
$env:CRAFT_DISABLE_AUTO_UPDATE = '1'
$configPath = Join-Path $config 'config.json'
'{"workspaces":[],"activeWorkspaceId":null,"activeSessionId":null,"startupPreservationMarker":"keep-this-value"}' | Set-Content -Encoding utf8 $configPath
$exe = Join-Path $installDir 'Storyflow.exe'
$script:startupCdpEndpoint = $null

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
  $script:installedExeHash = (Get-FileHash $exe -Algorithm SHA256).Hash
  $script:installedCodePath = Join-Path $installDir 'resources/app.asar'
  if (!(Test-Path $script:installedCodePath)) {
    $script:installedCodePath = Join-Path $installDir 'resources/app/dist/main.cjs'
  }
  $script:installedCodeHash = (Get-FileHash $script:installedCodePath -Algorithm SHA256).Hash
  # Older upgrade baselines predate CRAFT_DISABLE_AUTO_UPDATE. Keep their feed
  # offline too, so this startup gate never depends on the current live release.
  @"
provider: generic
url: http://127.0.0.1:9/startup-gate
updaterCacheDirName: storyflow-startup-gate
"@ | Set-Content -Encoding utf8 (Join-Path $installDir 'resources/app-update.yml')
}

function Assert-TestPackage {
  if ((Get-FileHash $exe -Algorithm SHA256).Hash -ne $script:installedExeHash -or
      (Get-FileHash $script:installedCodePath -Algorithm SHA256).Hash -ne $script:installedCodeHash) {
    throw 'Installed package was replaced during startup acceptance'
  }
}

function Quit-TestApp {
  & bun e2e/core/installed-startup.ts $startupProfile "--endpoint=$script:startupCdpEndpoint" --quit
  if ($LASTEXITCODE -ne 0) { throw 'Could not request a normal application quit' }
  $deadline = (Get-Date).AddSeconds(10)
  while (Get-Process -Name Storyflow -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }) {
    if ((Get-Date) -gt $deadline) { throw 'Normal application quit did not complete' }
    Start-Sleep -Milliseconds 100
  }
  Assert-TestPackage
}

function Get-TestAppProcesses {
  @(Get-Process -Name Storyflow -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
}

function Get-VisibleOwners {
  @(Get-TestAppProcesses | Where-Object { $_.MainWindowHandle -ne 0 })
}

function Launch-Shortcut([string]$scenario, [switch]$Duplicate) {
  $existingOwners = @(Get-VisibleOwners)
  if ($Duplicate -and $existingOwners.Count -ne 1) { throw 'Duplicate launch requires one existing visible owner' }
  $wsh = New-Object -ComObject WScript.Shell
  $shortcut = Get-ChildItem -Path ([Environment]::GetFolderPath('Desktop')), ([Environment]::GetFolderPath('Programs')) -Filter '*.lnk' -Recurse |
    Where-Object { $wsh.CreateShortcut($_.FullName).TargetPath -eq $exe } | Select-Object -First 1
  if (!$shortcut) { throw 'Installer did not create a Storyflow shortcut' }
  $link = $wsh.CreateShortcut($shortcut.FullName)
  $link.Arguments = "--user-data-dir=`"$startupProfile`" --remote-debugging-port=0"
  $link.Save()
  $previousEndpoint = $script:startupCdpEndpoint
  if (!$Duplicate) {
    # The old file survives a crash. Only the new owner may publish this endpoint.
    Remove-Item (Join-Path $startupProfile 'DevToolsActivePort') -Force -ErrorAction SilentlyContinue
    $script:startupCdpEndpoint = $null
  }
  $launched = Start-Process $shortcut.FullName -PassThru
  if ($Duplicate) {
    # The existing page is already ready. Wait for the new process to hand off
    # before requesting quit, otherwise it can start after the old owner exits.
    if (!$launched -or !$launched.WaitForExit(15000)) { throw 'Second launch did not hand off to the existing instance' }
    if ($launched.ExitCode -ne 0) { throw "Second launch failed: $($launched.ExitCode)" }
  }
  $probeArgs = @($startupProfile)
  # The duplicate briefly replaces DevToolsActivePort before handing off. Probe
  # the original owner, whose endpoint was verified by the previous launch.
  if ($Duplicate) { $probeArgs += "--endpoint=$script:startupCdpEndpoint" }
  $startupResult = & bun e2e/core/installed-startup.ts @probeArgs | Tee-Object -FilePath (Join-Path $EvidenceDirectory "$scenario.json")
  if ($LASTEXITCODE -ne 0) { throw "Application page failed in $scenario" }
  $script:startupCdpEndpoint = ($startupResult | ConvertFrom-Json).endpoint
  if (!$Duplicate -and $previousEndpoint -and $script:startupCdpEndpoint -eq $previousEndpoint) {
    throw 'New application process reused the previous CDP endpoint'
  }
  Assert-TestPackage
  $stored = Get-Content $configPath -Raw | ConvertFrom-Json
  if ($stored.startupPreservationMarker -ne 'keep-this-value') { throw 'Host configuration was reset' }
  # The main window is created hidden and shown on ready-to-show, while the page
  # probe above already reports visible. Wait for the native window instead of
  # sampling once (#85); a window that never appears still fails after the deadline.
  $deadline = (Get-Date).AddSeconds(15)
  do {
    $owners = @(Get-VisibleOwners)
    if ($owners.Count -eq 1) { break }
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $deadline)
  if ($owners.Count -ne 1) {
    $snapshot = @(Get-TestAppProcesses | ForEach-Object {
      @{ pid = $_.Id; windowHandle = [int64]$_.MainWindowHandle; windowTitle = $_.MainWindowTitle; responding = $_.Responding }
    })
    ConvertTo-Json -InputObject $snapshot -Compress | Set-Content (Join-Path $EvidenceDirectory "$scenario-window-failure.json")
    throw "Expected one visible application owner, got $($owners.Count)"
  }
  if ($Duplicate -and $owners[0].Id -ne $existingOwners[0].Id) { throw 'Second launch replaced the existing owner' }
  @{ scenario = $scenario; ownerPid = $owners[0].Id; launchedPid = $launched.Id; duplicate = [bool]$Duplicate; executableSha256 = $script:installedExeHash; applicationSha256 = $script:installedCodeHash } |
    ConvertTo-Json -Compress | Set-Content (Join-Path $EvidenceDirectory "$scenario-process.json")
}

try {
  Install-Version $Installer
  Launch-Shortcut 'fresh-install'
  Launch-Shortcut 'second-launch' -Duplicate
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
  foreach ($profileName in @('profile', 'upgrade-profile')) {
    $logs = Join-Path $root "$profileName/logs"
    if (Test-Path $logs) { Copy-Item $logs (Join-Path $EvidenceDirectory "$profileName-logs") -Recurse -Force }
  }
}
