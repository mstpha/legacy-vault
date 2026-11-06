<#
  Starts the HA pieces independently (nothing is installed). Each one runs in its own window so it
  can be killed on its own for the failover tests (docs/HA_SETUP.md, "Manual test plan").

    .\scripts\ha.ps1 primary        # legacy-vault-backend         (npm run dev, PORT from its .env, 4000)
    .\scripts\ha.ps1 backup         # legacy-vault-backend-backup  (npm run dev, 4001)
    .\scripts\ha.ps1 worker         # sync worker                  (npm run sync:worker, status on 4100)
    .\scripts\ha.ps1 all            # the three above
    .\scripts\ha.ps1 status         # GET /health on both servers + worker status
    .\scripts\ha.ps1 check [-DryRun]# one sync-check run (prints the JSON report)

  Prerequisites: `npm install` and `npx prisma generate` done in both backend folders, .env filled.
#>
param(
  [Parameter(Position = 0)][ValidateSet("primary", "backup", "worker", "all", "status", "check")][string]$Target = "status",
  [switch]$DryRun,
  [int]$PrimaryPort = 4000,
  [int]$BackupPort = 4001,
  [int]$WorkerPort = 4100
)

$root = Split-Path -Parent $PSScriptRoot
$primaryDir = Join-Path $root "legacy-vault-backend"
$backupDir = Join-Path $root "legacy-vault-backend-backup"

function Start-InWindow([string]$title, [string]$dir, [string]$npmScript) {
  if (-not (Test-Path (Join-Path $dir "node_modules"))) { Write-Warning "$dir has no node_modules: run npm install there first." }
  if (-not (Test-Path (Join-Path $dir ".env"))) { Write-Warning "$dir has no .env: copy .env.example and fill it in." }
  $cmd = "`$Host.UI.RawUI.WindowTitle = '$title'; Set-Location '$dir'; npm run $npmScript"
  Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmd | Out-Null
  Write-Host "started $title ($dir > npm run $npmScript)"
}

function Show-Health([string]$name, [string]$url) {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
    Write-Host "$name $($r.StatusCode) $($r.Content)"
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code) {
      $body = (New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd()
      Write-Host "$name $code $body"
    } else {
      Write-Host "$name DOWN ($($_.Exception.Message))"
    }
  }
}

switch ($Target) {
  "primary" { Start-InWindow "LV primary" $primaryDir "dev" }
  "backup"  { Start-InWindow "LV backup" $backupDir "dev" }
  "worker"  { Start-InWindow "LV sync worker" $backupDir "sync:worker" }
  "all" {
    Start-InWindow "LV primary" $primaryDir "dev"
    Start-InWindow "LV backup" $backupDir "dev"
    Start-InWindow "LV sync worker" $backupDir "sync:worker"
  }
  "status" {
    Show-Health "primary" "http://localhost:$PrimaryPort/health"
    Show-Health "backup " "http://localhost:$BackupPort/health"
    Show-Health "worker " "http://127.0.0.1:$WorkerPort/status"
  }
  "check" {
    Push-Location $backupDir
    try { if ($DryRun) { npm run --silent sync:check:dry } else { npm run --silent sync:check } } finally { Pop-Location }
  }
}
