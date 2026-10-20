# Pi configuration backup

Portable backup of the Pi (pi.dev) coding-agent setup using the agent2api and
opencode2api gateways, restorable on macOS, Linux, and Windows machines.

## Included

- `pi/settings.json` — UI and package settings (theme: `ghostty-muted`)
- `pi/mcp.json` — MCP server configuration (Playwright)
- `packages.txt` — installed Pi package sources
- `pi/themes/` — the `ghostty-muted` theme
- `pi/models.template.json` — sanitized agent2api/opencode2api model catalog
  (44 Agent2api models and 9 OpenCode models; `apiKey` values are environment-variable placeholders)
- `scripts/restore.sh` — restore for macOS / Linux / Git Bash
- `scripts/restore.ps1` — restore for native Windows (PowerShell)

## Deliberately excluded

- API keys and refresh/access tokens (`auth.json`, real `models.json`)
- Pi session transcripts and caches (`mcp-cache.json`, `models-store.json`, …)
- SSH keys and other private files

## Gateway setup

- agent2api API: `https://agent2api.chenyuyang.tech/v1`
- opencode2api API: `https://opencode2api.chenyuyang.tech/v1`
- The agent2api server must be populated with your own provider accounts through
  its management panel.
- The initial opencode2api server uses anonymous mode for smoke testing; add
  your own Zen/Go key and disable anonymous mode before relying on it.
- The shared default model is `agent2api/auto`; the OpenCode catalog remains
  available as a fallback.

## Restore on Windows (native)

Requirements: Node.js ≥ 22.19, Git for Windows (Bash), optional Python.

```powershell
git clone https://github.com/chenyuyang712/cyy-pi.git
cd cyy-pi
powershell -ExecutionPolicy Bypass -File scripts\restore.ps1 -QseanKey "..." -OpencodeKey "..."
```

The script:

1. installs the pinned Pi packages via `pi install`
2. writes `settings.json` / `mcp.json` / extension / themes into `~\.pi\agent`
   (adds `defaultTools: ["-bash", "+powershell"]` so the model can use
   PowerShell on native Windows)
3. writes `models.json` from the template, embedding your API key when given

Custom agent directory: `.\scripts\restore.ps1 -PiDir "D:\path\.pi\agent"`

## Restore on macOS / Linux / Git Bash

```bash
git clone https://github.com/chenyuyang712/cyy-pi.git
cd cyy-pi
QSEAN_GATEWAY_KEY='...' OPENCODE2API_GATEWAY_KEY='...' ./scripts/restore.sh
```

## Cross-platform notes

- `settings.json` in the repo is the shared baseline and already contains
  `defaultTools: ["+powershell"]`. On native Windows this enables the optional
  PowerShell tool for the model; on macOS/Linux it matches no tool and is a
  harmless no-op, so the same file works everywhere.
- `restore.ps1` additionally turns `defaultTools` into `[-bash, +powershell]`
  (bash tool fully replaced) only when the key is missing — it is present in
  the current baseline, so both platforms use the shared file as-is.
- `terminal.trueColor` / `terminal.hyperlinks` are set to `"auto"` so each
  terminal negotiates its own capabilities (the original Mac setup had
  hardcoded `true`).
- `lastChangelogVersion` is removed from the stored settings; Pi manages it
  per machine.
- The theme `ghostty-muted` is the active one.
- The repo contains reverse-engineering and security *skills* (via the
  `reverse-skill` package), but it does not install external tools such as
  Frida, Ghidra, IDA Pro, Burp Suite, jadx, or radare2. Install those
  separately only when needed.

## After restoring

1. Restart Pi or run `/reload` inside Pi.
2. Run `/settings` to confirm **Theme = ghostty-muted**.
3. Run `/models` to confirm the agent2api and opencode2api providers work.
