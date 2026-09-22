$ErrorActionPreference = "Stop"

$src = "C:\Users\PC-1\Desktop\projects\zcode-operation-skill"
$dst = "C:\Users\PC-1\.zcode\workspace\default\plugins\zcode-skill-router"

# Create directory structure (excluding forbidden dirs)
Get-ChildItem -Path $src -Recurse -Directory | ForEach-Object {
    $rel = $_.FullName.Substring($src.Length).TrimStart("\")
    if ($rel -notmatch "^\\.git$" -and
        $rel -notmatch "^\\.backup$" -and
        $rel -notmatch "^node_modules$" -and
        $rel -notmatch "^\\.zcode\\workflow-drafts$" -and
        $rel -notmatch "^\\.zcode\\workflow-runs$") {
        $destDir = Join-Path $dst $rel
        if (-not (Test-Path $destDir)) {
            New-Item -ItemType Directory -Force -Path $destDir | Out-Null
            Write-Host "Created: $destDir"
        }
    }
}

# Copy files (excluding forbidden paths and reserved names)
Get-ChildItem -Path $src -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($src.Length).TrimStart("\")
    $skip = $false
    $skipReason = ""

    if ($_.Name -eq "nul") { $skip = $true; $skipReason = "reserved name" }
    elseif ($rel -match "^\\.git\\") { $skip = $true; $skipReason = "git dir" }
    elseif ($rel -match "^\\.backup\\") { $skip = $true; $skipReason = "backup dir" }
    elseif ($rel -match "^node_modules\\") { $skip = $true; $skipReason = "node_modules" }
    elseif ($rel -match "^\\.zcode\\workflow-drafts\\") { $skip = $true; $skipReason = "workflow-drafts" }
    elseif ($rel -match "^\\.zcode\\workflow-runs\\") { $skip = $true; $skipReason = "workflow-runs" }
    elseif ($rel -eq "\data\skill-index.json" -or $rel -eq "data\skill-index.json") { $skip = $true; $skipReason = "skill-index.json" }
    elseif ($rel -match "^logs\\.*\.jsonl$") { $skip = $true; $skipReason = "jsonl log" }
    elseif ($rel -match "^logs\\benchmark-.*\.json$") { $skip = $true; $skipReason = "benchmark json" }
    elseif ($rel -eq "\.zcodeignore" -or $rel -eq ".zcodeignore") { $skip = $true; $skipReason = "zcodeignore" }

    if (-not $skip) {
        $destFile = Join-Path $dst $rel
        $null = New-Item -ItemType Directory -Force -Path (Split-Path $destFile)
        Copy-Item $_.FullName $destFile -Force
        Write-Host "Copied: $rel"
    } else {
        Write-Host "Skipped ($skipReason): $rel"
    }
}

Write-Host "`n--- Copy Complete ---"
Write-Host "Source: $src"
Write-Host "Target: $dst"
