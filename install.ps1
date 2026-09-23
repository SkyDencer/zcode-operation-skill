# ZCode Skill Router — One-Command Install (Windows PowerShell)
#
# Usage:
#   .\install.ps1                 # interactive
#   .\install.ps1 -Yes            # skip confirmation
#   .\install.ps1 -DryRun         # show plan only
#
# Prerequisites: Node.js >= 20

param(
    [switch]$Yes,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# Resolve paths
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = $scriptDir
if ($root -match "scripts$") {
    $root = Split-Path -Parent $root
}

$installScript = Join-Path $root "scripts" "install.mjs"

if (-not (Test-Path $installScript)) {
    Write-Error "scripts/install.mjs not found at: $installScript"
    exit 1
}

$args = @($installScript)
if ($Yes)   { $args += "--yes" }
if ($DryRun) { $args += "--dry-run" }

node @args
