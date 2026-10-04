# Pi configuration backup

This repository contains a portable backup of the local Pi setup used with the
wild-work provider.

## Included

- Pi UI and package settings
- MCP server configuration
- Installed Pi package sources
- The wild-work usage extension
- The `ghostty-muted` Pi theme
- A sanitized model catalog template
- `scripts/restore.sh` for rebuilding the setup on another host

## Deliberately excluded

- API keys and refresh/access tokens
- `auth.json` and login sessions
- Pi session transcripts
- Local MCP caches
- SSH keys, server passwords, and private files

## Restore

Set the provider key in the environment of the destination machine, then run:

```bash
export WILDWORK_API_KEY='replace-with-your-key'
./scripts/restore.sh
```

The script installs the pinned Pi packages, writes the sanitized configuration,
restores the usage extension and theme, and configures the Playwright MCP.
Restart Pi or run `/reload` after restoration.

The repository contains reverse-engineering and security skills, but it does
not install external tools such as Frida, Ghidra, IDA Pro, Burp Suite, jadx or
radare2. Install those separately only when needed.

