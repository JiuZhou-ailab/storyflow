#!/usr/bin/env bash
set -euo pipefail

# Keep Electron IPC sends routed through shared channel constants. A small
# allowlist remains for legacy bootstrap/transfer channels that are not part of
# the typed RPC map.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

matches="$(
  rg -n --glob '*.ts' --glob '*.tsx' \
    '(\bwebContents|\.sender)\.send\(\s*["'\'']' \
    apps/electron/src/main \
    || true
)"

if [[ -z "$matches" ]]; then
  echo "raw Electron IPC send check OK"
  exit 0
fi

violations="$(
  printf '%s\n' "$matches" |
    rg -v "transfer:progress" \
    || true
)"

if [[ -n "$violations" ]]; then
  cat <<'EOF'
Raw Electron IPC send calls were found.

Use shared channel constants or the typed RPC/event sink instead of hardcoded
string channels. If a legacy bootstrap channel is intentional, document it in
scripts/check-raw-sends.sh.
EOF
  printf '%s\n' "$violations"
  exit 1
fi

echo "raw Electron IPC send check OK"
