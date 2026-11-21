$testEnvPath = Join-Path $PSScriptRoot ".env.test"
if (-not (Test-Path -LiteralPath $testEnvPath)) {
  throw "Missing $testEnvPath. Create it from .env.test.example and set a disposable TEST_DATABASE_URL."
}

Get-Content $testEnvPath |
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

function Test-DisposablePostgresUrl([string]$connectionString) {
  $parsedUrl = $null
  if (-not $connectionString -or -not [Uri]::TryCreate($connectionString, [UriKind]::Absolute, [ref]$parsedUrl)) {
    return $false
  }
  if ($parsedUrl.Scheme -notin @("postgres", "postgresql")) {
    return $false
  }

  $databaseName = [Uri]::UnescapeDataString(($parsedUrl.AbsolutePath.Trim("/") -split "/")[-1])
  if ($databaseName -match "test") {
    return $true
  }

  foreach ($parameter in $parsedUrl.Query.TrimStart("?") -split "&") {
    $pair = $parameter -split "=", 2
    if ($pair.Count -eq 2) {
      $name = [Uri]::UnescapeDataString($pair[0].Replace("+", " "))
      $value = [Uri]::UnescapeDataString($pair[1].Replace("+", " "))
      if ($name -eq "application_name" -and $value -eq "legacy_vault_test") {
        return $true
      }
    }
  }
  return $false
}

if (-not (Test-DisposablePostgresUrl $env:TEST_DATABASE_URL)) {
  throw "Refusing to use an unmarked database. Name it *_test or add application_name=legacy_vault_test to TEST_DATABASE_URL."
}
if ($env:TEST_DIRECT_URL -and -not (Test-DisposablePostgresUrl $env:TEST_DIRECT_URL)) {
  throw "Refusing to use an unmarked direct database URL. Name its database *_test or add application_name=legacy_vault_test."
}

$env:DATABASE_URL = $env:TEST_DATABASE_URL

if ($env:TEST_DIRECT_URL) {
  $env:DIRECT_URL = $env:TEST_DIRECT_URL
}

Write-Host "TEST DATABASE ENABLED" -ForegroundColor Yellow
