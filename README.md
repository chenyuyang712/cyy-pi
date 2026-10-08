# Pi configuration backup

Portable backup of the Pi (pi.dev) coding-agent setup, synced from a Windows
machine and restorable on macOS, Linux, and other Windows machines.

## Included

- `pi/settings.json` — UI and package settings (theme: `terminal-flat`)
- `pi/mcp.json` — MCP server configuration (Playwright)
- `packages.txt` — installed Pi package sources
- `pi/extensions/wild-work-usage.ts` — the wild-work usage extension
- `pi/themes/` — both themes (`terminal-flat`, `ghostty-muted`)
- `pi/models.template.json` — sanitized wild-work model catalog
  (`apiKey` is the `${WILDWORK_API_KEY}` placeholder)
- `scripts/restore.sh` — restore for macOS / Linux / Git Bash
- `scripts/restore.ps1` — restore for native Windows (PowerShell)

## Deliberately excluded

- API keys and refresh/access tokens (`auth.json`, real `models.json`)
- Pi session transcripts and caches (`mcp-cache.json`, `models-store.json`, …)
- SSH keys and other private files

## Restore on Windows (native)

Requirements: Node.js ≥ 22.19, Git for Windows (Bash), optional Python.

```powershell
git clone https://github.com/chenyuyang712/cyy-pi.git
cd cyy-pi
powershell -ExecutionPolicy Bypass -File scripts\restore.ps1 -ApiKey "sk-..."
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
WILDWORK_API_KEY='sk-...' ./scripts/restore.sh
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
- The theme `terminal-flat` is the active one; `ghostty-muted` is kept as an
  alternative (it was the original Mac setup's theme).
- The repo contains reverse-engineering and security *skills* (via the
  `reverse-skill` package), but it does not install external tools such as
  Frida, Ghidra, IDA Pro, Burp Suite, jadx, or radare2. Install those
  separately only when needed.

## After restoring

1. Restart Pi or run `/reload` inside Pi.
2. Run `/settings` to confirm **Theme = terminal-flat** (user input renders in
   sky blue, AI output in the normal text color).
3. Run `/models` to confirm the wild-work provider works.
