#!/bin/bash
# input: Linux package target args forwarded by legacy local commands
# output: Root Electron build dispatcher invocation
# pos: Thin compatibility shim; packaging logic lives in scripts/build.ts

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$(dirname "$(dirname "$SCRIPT_DIR")")")"
ARCH="x64"

if [ "$#" -gt 0 ] && [[ "$1" != --* ]]; then
  ARCH="$1"
  shift
fi

exec bun run "$ROOT_DIR/scripts/build.ts" --platform=linux --arch="$ARCH" "$@"
