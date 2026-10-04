#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PI_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"

if [[ -z "${WILDWORK_API_KEY:-}" ]]; then
  echo "WILDWORK_API_KEY is required." >&2
  echo "Example: export WILDWORK_API_KEY='your-key'" >&2
  exit 1
fi

command -v pi >/dev/null 2>&1 || {
  echo "Pi CLI is not installed or not on PATH." >&2
  exit 1
}

mkdir -p "$PI_DIR/extensions" "$PI_DIR/themes"

while IFS= read -r package || [[ -n "$package" ]]; do
  [[ -z "$package" || "$package" == \#* ]] && continue
  pi install "$package"
done < "$REPO_ROOT/packages.txt"

install -m 600 "$REPO_ROOT/pi/settings.json" "$PI_DIR/settings.json"
install -m 600 "$REPO_ROOT/pi/mcp.json" "$PI_DIR/mcp.json"
install -m 644 "$REPO_ROOT/pi/extensions/wild-work-usage.ts" "$PI_DIR/extensions/wild-work-usage.ts"
install -m 644 "$REPO_ROOT/pi/themes/ghostty-muted.json" "$PI_DIR/themes/ghostty-muted.json"

WILDWORK_API_KEY="$WILDWORK_API_KEY" python3 - "$REPO_ROOT/pi/models.template.json" "$PI_DIR/models.json" <<'PY'
import json
import os
import pathlib
import sys

source, target = map(pathlib.Path, sys.argv[1:])
data = json.loads(source.read_text())
key = os.environ["WILDWORK_API_KEY"]
for provider in data.get("providers", {}).values():
    provider["apiKey"] = key
target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
target.chmod(0o600)
PY

echo "Pi configuration restored to: $PI_DIR"
echo "Restart Pi or run /reload."
