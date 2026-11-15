<#
  db-push.ps1: apply every pending Supabase migration to Ally staging and/or prod.

  Lives in the repo root. Run from anywhere:
    powershell -ExecutionPolicy Bypass -File db-push.ps1                  # staging, then prod
    powershell -ExecutionPolicy Bypass -File db-push.ps1 -Target staging
    powershell -ExecutionPolicy Bypass -File db-push.ps1 -Target prod
    powershell -ExecutionPolicy Bypass -File db-push.ps1 -DryRun          # list pending, change nothing
    powershell -ExecutionPolicy Bypass -File db-push.ps1 -Yes             # no prompts (for Claude Code)

  Connection strings come from env vars (never committed):
    $env:ALLY_STAGING_DB_URL = "postgresql://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
    $env:ALLY_PROD_DB_URL    = "postgresql://postgres.uhdwhubdeepmtjhvnctb:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
  Get them from Supabase > project > Connect > Session pooler (port 5432). If a var is unset, the script asks.

  For each target it: lists local vs remote migrations, shows a dry run, asks you to type the
  target's name, pushes, then lists again so you can see every migration recorded on the remote.
  Migrations already applied through the SQL editor (docs/sql/*.editor.sql) are recorded, so they are skipped.
#>
param(
  [ValidateSet("both", "staging", "prod")] [string] $Target = "both",
  [switch] $DryRun,
  # Unattended: skip every confirmation and fail instead of prompting for a missing URL.
  [switch] $Yes
)

$ErrorActionPreference = "Stop"
# The repo root is this script's folder (or its parent, if it is ever moved into scripts\).
$repo = if (Test-Path (Join-Path $PSScriptRoot "supabase\migrations")) { $PSScriptRoot } else { Split-Path -Parent $PSScriptRoot }
Set-Location $repo

if (-not (Test-Path "supabase\migrations")) { throw "supabase\migrations not found under $repo. Keep this script in the repo root." }

function Get-DbUrl([string] $name) {
  $var = if ($name -eq "staging") { "ALLY_STAGING_DB_URL" } else { "ALLY_PROD_DB_URL" }
  $url = [Environment]::GetEnvironmentVariable($var)
  if (-not $url -and $Yes) { throw "$var is not set. With -Yes the script never prompts; set the env var first." }
  if (-not $url) {
    $secure = Read-Host "Paste the $name connection string (session pooler, port 5432)" -AsSecureString
    $url = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  }
  if ($url -notmatch '^postgres(ql)?://') { throw "$var does not look like a Postgres connection string." }
  if ($name -eq "prod" -and $url -notmatch 'uhdwhubdeepmtjhvnctb') { throw "The prod URL does not contain the ally-prod ref (uhdwhubdeepmtjhvnctb). Refusing." }
  if ($name -eq "staging" -and $url -match 'uhdwhubdeepmtjhvnctb') { throw "The staging URL points at ally-prod. Refusing." }
  return $url
}

function Invoke-Supabase([string[]] $cliArgs) {
  # Out-Host keeps CLI output off the pipeline, so Push-Target returns only its own result.
  & npx --yes supabase @cliArgs | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "supabase $($cliArgs[0..1] -join ' ') failed (exit $LASTEXITCODE)." }
}

function Push-Target([string] $name) {
  Write-Host ""
  Write-Host "==== $name ====" -ForegroundColor Cyan
  $url = Get-DbUrl $name

  Write-Host "Local vs remote migrations:" -ForegroundColor DarkGray
  Invoke-Supabase @("migration", "list", "--db-url", $url)

  Write-Host "Dry run (what would be applied):" -ForegroundColor DarkGray
  Invoke-Supabase @("db", "push", "--db-url", $url, "--dry-run")

  if ($DryRun) { Write-Host "Dry run only. Nothing changed on $name." -ForegroundColor Yellow; return }

  if (-not $Yes) {
    $typed = Read-Host "Type '$name' to apply these migrations, anything else to skip"
    if ($typed -ne $name) { Write-Host "Skipped $name." -ForegroundColor Yellow; return $false }
  }

  Invoke-Supabase @("db", "push", "--db-url", $url)

  Write-Host "After push:" -ForegroundColor DarkGray
  Invoke-Supabase @("migration", "list", "--db-url", $url)
  Write-Host "$name is up to date." -ForegroundColor Green
  return $true
}

$targets = switch ($Target) { "both" { @("staging", "prod") } default { @($Target) } }

foreach ($t in $targets) {
  $ok = Push-Target $t
  if ($Target -eq "both" -and $t -eq "staging" -and -not $DryRun) {
    if ($ok -ne $true) { Write-Host "Staging was not pushed, so prod is skipped too." -ForegroundColor Yellow; break }
    if (-not $Yes) {
      $go = Read-Host "Staging done. Smoke-test it, then type 'prod' to continue"
      if ($go -ne "prod") { Write-Host "Stopped before prod." -ForegroundColor Yellow; break }
    }
  }
}
