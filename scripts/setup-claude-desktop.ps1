#Requires -Version 5.1
<#
.SYNOPSIS
  Promptic - Claude Desktop MCP setup script (Windows PowerShell)

.DESCRIPTION
  Registers Promptic MCP server in claude_desktop_config.json.
  Windows-native Node.js only — uses Windows path format (C:\...).
  Preserves existing config (preferences, other MCP servers).

.PARAMETER Mode
  local (default): source mode, npx: published package, remove: unregister, check: verify

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\setup-claude-desktop.ps1
  powershell -ExecutionPolicy Bypass -File .\scripts\setup-claude-desktop.ps1 -Mode npx
  powershell -ExecutionPolicy Bypass -File .\scripts\setup-claude-desktop.ps1 -Mode remove
  powershell -ExecutionPolicy Bypass -File .\scripts\setup-claude-desktop.ps1 -Mode check
#>

param(
    [ValidateSet('local', 'npx', 'remove', 'check')]
    [string]$Mode = 'local'
)

$ErrorActionPreference = 'Stop'

# -- helpers --
function Write-OK   { param([string]$M) Write-Host $M -ForegroundColor Green }
function Write-Warn  { param([string]$M) Write-Host $M -ForegroundColor Yellow }
function Write-Err   { param([string]$M) Write-Host $M -ForegroundColor Red }
function Write-Info  { param([string]$M) Write-Host $M -ForegroundColor Cyan }

# -- paths --
$ConfigDir  = Join-Path $env:APPDATA 'Claude'
$ConfigPath = Join-Path $ConfigDir 'claude_desktop_config.json'

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerPath = Join-Path (Split-Path -Parent $ScriptDir) 'mcp-server\index.js'
$ServerPath = [System.IO.Path]::GetFullPath($ServerPath)

# -- verify Windows-native Node.js --
function Assert-WindowsNode {
    try {
        $cmd = Get-Command node -ErrorAction Stop
        $p = $cmd.Source
        if ($p -match 'System32|\\wsl|/wsl') {
            Write-Err '[ERROR] Detected WSL Node.js interop, not Windows-native Node.js.'
            Write-Err '  Install Windows Node.js from https://nodejs.org/ and ensure it is in PATH.'
            exit 1
        }
        $ver = & node --version 2>&1
        if ($LASTEXITCODE -ne 0 -or $ver -notmatch '^v\d+') {
            Write-Err '[ERROR] node --version failed. Reinstall Node.js from https://nodejs.org/'
            exit 1
        }
        Write-Info "  Detected: Windows-native Node.js $ver"
    } catch {
        Write-Err '[ERROR] Node.js not found. Install from https://nodejs.org/'
        exit 1
    }
}

# -- build promptic MCP config object --
function New-PrompticConfig {
    param([string]$CfgMode)

    if ($CfgMode -eq 'npx') {
        return [PSCustomObject]@{ command = 'npx'; args = @('-y', 'promptic') }
    } else {
        return [PSCustomObject]@{ command = 'node'; args = @($ServerPath) }
    }
}

# -- read config (BOM-free UTF-8) --
function Read-ConfigJson {
    if (Test-Path $ConfigPath) {
        try {
            $enc = [System.Text.UTF8Encoding]::new($false)
            $text = [System.IO.File]::ReadAllText($ConfigPath, $enc)
            return $text | ConvertFrom-Json
        } catch {
            Write-Warn '  Warning: Cannot parse existing config. Will create new.'
            return $null
        }
    }
    return $null
}

# -- save config (BOM-free UTF-8) --
function Save-ConfigJson {
    param($Config)
    if (-not (Test-Path $ConfigDir)) {
        New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
    }
    $json = $Config | ConvertTo-Json -Depth 10
    $enc = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($ConfigPath, $json, $enc)
}

# -- test MCP server startup --
function Test-McpServer {
    param([PSCustomObject]$Cfg)

    Write-Host ''
    Write-Info '  Verifying: MCP server startup test...'

    try {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $Cfg.command
        $argStr = ($Cfg.args | ForEach-Object { """$_""" }) -join ' '
        $psi.Arguments = $argStr
        $psi.UseShellExecute = $false
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError  = $true
        $psi.CreateNoWindow = $true

        $proc = [System.Diagnostics.Process]::Start($psi)
        $exited = $proc.WaitForExit(3000)

        if (-not $exited) {
            $proc.Kill()
            $proc.WaitForExit(2000)
            Write-OK '  Verify OK: MCP server starts successfully.'
            return $true
        } else {
            $stderr = $proc.StandardError.ReadToEnd()
            Write-Err '  Verify FAIL: MCP server exited immediately.'
            if ($stderr) { Write-Err "  stderr: $stderr" }
            return $false
        }
    } catch {
        $errMsg = $_.Exception.Message
        Write-Err "  Verify FAIL: $errMsg"

        if ($Cfg.command -eq 'node') {
            Write-Err ''
            Write-Err '  Node.js troubleshooting:'
            Write-Err '    1. node --version'
            Write-Err '    2. Check file exists: ' + $Cfg.args[0]
        }
        return $false
    }
}

# ====================================================
# MAIN
# ====================================================
Write-Host ''
Write-OK '=== Promptic - Claude Desktop MCP Setup (Windows) ==='
Write-Host ''
Write-Host "  config: " -NoNewline; Write-Warn $ConfigPath

# -- check mode --
if ($Mode -eq 'check') {
    Write-Host '  mode:   check (verify current setup)'
    Write-Host ''

    $config = Read-ConfigJson
    if (-not $config) {
        Write-Err '  Config file not found.'
        exit 1
    }

    if (-not $config.mcpServers -or -not $config.mcpServers.promptic) {
        Write-Err '  promptic MCP not configured.'
        Write-Host '  Run setup first.'
        exit 1
    }

    $pl = $config.mcpServers.promptic
    Write-Host ''
    Write-Info '  Current promptic config:'
    $pl | ConvertTo-Json -Depth 5 | ForEach-Object { Write-Host "    $_" }

    $ok = Test-McpServer -Cfg $pl

    Write-Host ''
    if ($ok) {
        Write-OK '  Status: OK. Restart Claude Desktop to use promptic.'
    } else {
        Write-Err '  Status: FAIL. Check errors above and re-run setup.'
    }
    exit 0
}

# -- remove mode --
if ($Mode -eq 'remove') {
    Write-Host '  mode:   ' -NoNewline; Write-Err 'remove'
    Write-Host ''

    $config = Read-ConfigJson
    if ($config -and $config.mcpServers -and $config.mcpServers.promptic) {
        $config.mcpServers.PSObject.Properties.Remove('promptic')
        Save-ConfigJson $config
        Write-OK '  promptic config removed.'
    } else {
        Write-Host '  promptic config not found. Nothing to remove.'
    }

    Write-Host ''
    Write-OK 'Done. Restart Claude Desktop.'
    exit 0
}

# -- local / npx mode --
Assert-WindowsNode

if ($Mode -eq 'npx') {
    Write-Host '  mode:   npx (published package)'
} else {
    Write-Host '  mode:   local (source)'
    Write-Host '  server: ' -NoNewline; Write-Warn $ServerPath

    if (-not (Test-Path $ServerPath)) {
        Write-Host ''
        Write-Err "[ERROR] File not found: $ServerPath"
        Write-Host '  Run npm install in mcp-server directory first.'
        exit 1
    }
}

# build config
$plConfig = New-PrompticConfig -CfgMode $Mode

# verify server starts
$ok = Test-McpServer -Cfg $plConfig
if (-not $ok) {
    Write-Host ''
    Write-Err 'Server verification failed. Config NOT saved.'
    Write-Err 'Fix the issue above and re-run this script.'
    exit 1
}

# load existing config (preserve preferences, other MCP servers)
$config = Read-ConfigJson
if (-not $config) {
    $config = [PSCustomObject]@{ mcpServers = [PSCustomObject]@{} }
}
if (-not $config.mcpServers) {
    $config | Add-Member -NotePropertyName 'mcpServers' -NotePropertyValue ([PSCustomObject]@{})
}

# update promptic entry
if ($config.mcpServers.PSObject.Properties['promptic']) {
    $config.mcpServers.PSObject.Properties.Remove('promptic')
}
$config.mcpServers | Add-Member -NotePropertyName 'promptic' -NotePropertyValue $plConfig

# backup
if (Test-Path $ConfigPath) {
    Copy-Item $ConfigPath "$ConfigPath.bak" -Force
    Write-Host ''
    Write-Host '  backup: claude_desktop_config.json.bak'
}

# save
Save-ConfigJson $config

Write-Host ''
Write-Info '  Saved config:'
$plConfig | ConvertTo-Json -Depth 5 | ForEach-Object { Write-Host "    $_" }
Write-Host ''
Write-OK 'Done. Restart Claude Desktop.'
Write-Host ''