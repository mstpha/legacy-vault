@'
Get-Content "$PSScriptRoot\.env" |
  Where-Object {
    $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*\s*=' -and
    $_ -notmatch '^\s*#'
  } |
  ForEach-Object {
    if ($_ -match '^\s*([^=]+?)\s*=\s*"?([^"]*)"?\s*$') {
      [Environment]::SetEnvironmentVariable(
        $matches[1].Trim(),
        $matches[2],
        "Process"
      )
    }
  }

Write-Host "DEVELOPMENT DATABASE ENABLED" -ForegroundColor Green
'@ | Set-Content .\use-dev-db.ps1