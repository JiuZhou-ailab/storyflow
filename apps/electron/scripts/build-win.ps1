# input: Windows package target args forwarded by legacy local commands
# output: Root Electron build dispatcher invocation
# pos: Thin compatibility shim; packaging logic lives in scripts/build.ts

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $ScriptDir))

bun run "$RootDir\scripts\build.ts" --platform=win32 --arch=x64 @args
