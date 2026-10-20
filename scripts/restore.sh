#!/usr/bin/env bash
# Pi configuration restore script (macOS / Linux / Git Bash on Windows)
# Restores this repo's Pi configuration to the current user account.
#
# Usage:
#   ./scripts/restore.sh
#   PI_DIR=/custom/path ./scripts/restore.sh          # custom agent dir
#   QSEAN_GATEWAY_KEY='...' YOUKI_FREE_GATEWAY_KEY='...' ./scripts/restore.sh
#   SKIP_PACKAGES=1 ./scripts/restore.sh              # skip `pi install`
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PI_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"

# Detect platform: "Darwin" (mac), "Linux", "MINGW*/MSYS*/CYGWIN*" (Windows Git Bash)
OS="$(uname -s)"
case "$OS" in
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
  *)                    PLATFORM="unix" ;;
esac

echo "Repo root : $REPO_ROOT"
echo "Platform  : $PLATFORM"
echo "Pi dir    : $PI_DIR"

command -v pi >/dev/null 2>&1 || {
  echo "WARNING: Pi CLI not found on PATH." >&2
  echo "  mac/linux: curl -fsSL https://pi.dev/install.sh | sh" >&2
  echo "  windows  : powershell -c \"irm https://pi.dev/install.ps1 | iex\"" >&2
  echo "Continuing with file restoration anyway." >&2
}

mkdir -p "$PI_DIR/extensions" "$PI_DIR/themes"

# ---- 1. Packages (`pi install`) ----
if [[ "${SKIP_PACKAGES:-0}" != "1" ]]; then
  echo ""
  echo "=== Installing Pi packages ==="
  while IFS= read -r package || [[ -n "$package" ]]; do
    [[ -z "$package" || "$package" == \#* ]] && continue
    echo "  pi install $package"
    pi install "$package" || echo "WARNING: pi install failed for $package (continuing)" >&2
  done < "$REPO_ROOT/packages.txt"
else
  echo "Skipping package installation (SKIP_PACKAGES=1)."
fi

# ---- 2. settings.json (platform-specific tweak) ----
echo ""
echo "=== Restoring configuration files ==="
if [[ "$PLATFORM" == "windows" ]] && ! grep -q '"defaultTools"' "$REPO_ROOT/pi/settings.json"; then
  # Native Windows: swap the model-facing bash tool for PowerShell.
  sed 's/^  "extensions": \[/  "defaultTools": [\n    "-bash",\n    "+powershell"\n  ],\n  "extensions": [/' \
    "$REPO_ROOT/pi/settings.json" > "$PI_DIR/settings.json"
  echo "  settings.json (+defaultTools: powershell tool for native Windows)"
else
  install -m 600 "$REPO_ROOT/pi/settings.json" "$PI_DIR/settings.json"
  echo "  settings.json"
fi

# ---- 3. Other configuration files ----
install -m 600 "$REPO_ROOT/pi/mcp.json" "$PI_DIR/mcp.json"
install -m 644 "$REPO_ROOT/pi/themes/"*.json "$PI_DIR/themes/"
echo "  mcp.json, extensions, themes"

# ---- 4. models.json from template (+ optional API key) ----
TEMPLATE="$REPO_ROOT/pi/models.template.json"
TARGET="$PI_DIR/models.json"
if [[ -f "$TEMPLATE" && ( ! -f "$TARGET" || -n "${QSEAN_GATEWAY_KEY:-}" || -n "${YOUKI_FREE_GATEWAY_KEY:-}" ) ]]; then
  echo ""
  echo "=== Writing models.json ==="
  PYTHON_BIN=""
  if command -v python3 >/dev/null 2>&1; then PYTHON_BIN="python3"
  elif command -v python >/dev/null 2>&1; then PYTHON_BIN="python"
  else
    echo "WARNING: python not found; copy models.template.json to models.json manually." >&2
  fi
  if [[ -n "$PYTHON_BIN" ]]; then
    QSEAN_GATEWAY_KEY="${QSEAN_GATEWAY_KEY:-}" YOUKI_FREE_GATEWAY_KEY="${YOUKI_FREE_GATEWAY_KEY:-}" "$PYTHON_BIN" - "$TEMPLATE" "$TARGET" <<'PY'
import json
import os
import pathlib
import sys

source, target = map(pathlib.Path, sys.argv[1:])
data = json.loads(source.read_text())
keys = {
    "agent2api": os.environ.get("QSEAN_GATEWAY_KEY", ""),
    "youki-free": os.environ.get("YOUKI_FREE_GATEWAY_KEY", ""),
}
for name, key in keys.items():
    if key and name in data.get("providers", {}):
        data["providers"][name]["apiKey"] = key
target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
try:
    target.chmod(0o600)
except OSError:
    pass
print("  models.json -> OK" + (" (API key embedded)" if key else " (placeholder key; set it later)"))
PY
  fi
else
  echo ""
  echo "models.json already exists; left untouched (set gateway key variables to overwrite)."
fi

# ---- Done ----
echo ""
echo "Pi configuration restored to: $PI_DIR"
case "$PLATFORM" in
  windows)
    echo "Next steps:"
    echo "  1. Restart Pi or run /reload inside Pi."
    echo "  2. Run /settings to confirm theme = ghostty-muted."
    echo "  3. Git Bash is required for ! commands; the powershell tool is enabled via defaultTools."
    ;;
  *)
    echo "Next steps:"
    echo "  1. Restart Pi or run /reload inside Pi."
    echo "  2. Run /settings to confirm theme = ghostty-muted."
    ;;
esac
