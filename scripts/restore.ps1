# Pi configuration restore script for Windows (PowerShell 5.1+ compatible)
# Restores this repo's Pi configuration to the current Windows user account.
#
# Usage (in PowerShell):
#   .\scripts\restore.ps1
#   .\scripts\restore.ps1 -PiDir "D:\somewhere\.pi\agent"
#   .\scripts\restore.ps1 -QseanKey "..." -OpencodeKey "..."
#   .\scripts\restore.ps1 -SkipPackages             # skip `pi install`
#
# Or from Git Bash:  QSEAN_GATEWAY_KEY=... OPENCODE2API_GATEWAY_KEY=... powershell -ExecutionPolicy Bypass -File scripts/restore.ps1

param(
    [string]$PiDir = "",
    [string]$QseanKey = "",
    [string]$OpencodeKey = "",
    [switch]$SkipPackages
)

$ErrorActionPreference = "Stop"

# ---- Resolve repo root (works from any CWD) ----
$repoRoot = Split-Path -Parent $PSScriptRoot

# ---- Resolve Pi agent dir: -PiDir > PI_CODING_AGENT_DIR > ~/.pi/agent ----
if (-not $PiDir) { $PiDir = $env:PI_CODING_AGENT_DIR }
if (-not $PiDir) { $PiDir = Join-Path $HOME ".pi\agent" }

Write-Host "Repo root : $repoRoot"
Write-Host "Pi dir    : $PiDir"

# ---- Sanity checks ----
$piCmd = Get-Command pi -ErrorAction SilentlyContinue
if (-not $piCmd) {
    Write-Warning "Pi CLI not found on PATH. Install it first:"
    Write-Host '  powershell -c "irm https://pi.dev/install.ps1 | iex"   (or: npm install -g --ignore-scripts @earendil-works/pi-coding-agent)'
    Write-Host "Continuing with file restoration anyway."
}

$srcSettings = Join-Path $repoRoot "pi\settings.json"
if (-not (Test-Path $srcSettings)) { throw "Missing $srcSettings" }

# ---- Create target directories ----
foreach ($d in @("extensions", "themes", "")) {
    $p = if ($d) { Join-Path $PiDir $d } else { $PiDir }
    if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
}

# ---- 1. Packages (`pi install`) ----
if (-not $SkipPackages) {
    Write-Host "`n=== Installing Pi packages ==="
    Get-Content (Join-Path $repoRoot "packages.txt") | ForEach-Object {
        $pkg = $_.Trim()
        if ($pkg -and -not $pkg.StartsWith("#")) {
            Write-Host "  pi install $pkg"
            & pi install $pkg
            if ($LASTEXITCODE -ne 0) { Write-Warning "pi install failed for $pkg (continuing)" }
        }
    }
}
else {
    Write-Host "Skipping package installation (-SkipPackages)."
}

# ---- 2. Copy configuration files ----
Write-Host "`n=== Restoring configuration files ==="

# settings.json: apply Windows-specific tweaks
$settings = Get-Content $srcSettings -Raw | ConvertFrom-Json
if (-not $settings.PSObject.Properties["defaultTools"]) {
    # Native Windows: swap the model-facing bash tool for PowerShell.
    # On macOS/Linux this entry matches no tool and is harmless.
    $settings | Add-Member -NotePropertyName "defaultTools" -NotePropertyValue @("-bash", "+powershell")
    Write-Host "  defaultTools: enabled powershell tool (native Windows)"
}
$settingsJson = $settings | ConvertTo-Json -Depth 32
# ConvertTo-Json escapes non-ASCII; decode back for readable CJK strings
$settingsJson = [regex]::Replace($settingsJson, "\\u([0-9a-fA-F]{4})", {
    param($m) [char][Convert]::ToInt32($m.Groups[1].Value, 16)
})
[System.IO.File]::WriteAllText((Join-Path $PiDir "settings.json"), $settingsJson + "`n", (New-Object System.Text.UTF8Encoding($false)))

Copy-Item (Join-Path $repoRoot "pi\mcp.json")              (Join-Path $PiDir "mcp.json") -Force
Copy-Item (Join-Path $repoRoot "pi\themes\*.json")         (Join-Path $PiDir "themes\") -Force
Write-Host "  settings.json, mcp.json, themes -> OK"

# ---- 3. models.json from template (+ optional API key) ----
$template = Join-Path $repoRoot "pi\models.template.json"
$target   = Join-Path $PiDir "models.json"
$needModels = (Test-Path $template) -and (-not (Test-Path $target) -or $QseanKey -or $OpencodeKey)

if ($needModels) {
    Write-Host "`n=== Writing models.json ==="
    $models = Get-Content $template -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($QseanKey) { $models.providers.qsean.apiKey = $QseanKey }
    if ($OpencodeKey) { $models.providers.opencode.apiKey = $OpencodeKey }
    Write-Host "  gateway keys written into models.json (file contains secrets, do not commit it)"
    $modelsJson = $models | ConvertTo-Json -Depth 32
    $modelsJson = [regex]::Replace($modelsJson, "\\u([0-9a-fA-F]{4})", {
        param($m) [char][Convert]::ToInt32($m.Groups[1].Value, 16)
    })
    [System.IO.File]::WriteAllText($target, $modelsJson + "`n", (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "  models.json -> OK"
}
else {
    Write-Host "`nmodels.json already exists; left untouched (use gateway key options to overwrite)."
}

# ---- Done ----
Write-Host ""
Write-Host "Pi configuration restored to: $PiDir" -ForegroundColor Green
Write-Host "Next steps:"
Write-Host "  1. Restart Pi or run /reload inside Pi."
Write-Host "  2. Run /settings to confirm theme = ghostty-muted."
Write-Host "  3. If the powershell tool misbehaves, remove 'defaultTools' from settings.json."
