Get-Content "$PSScriptRoot\.env.test" |
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

$env:DATABASE_URL = $env:TEST_DATABASE_URL

if ($env:TEST_DIRECT_URL) {
  $env:DIRECT_URL = $env:TEST_DIRECT_URL
}

Write-Host "TEST DATABASE ENABLED" -ForegroundColor Yellow
