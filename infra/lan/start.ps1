<#
.SYNOPSIS  Start the DailyFlow LAN stack (project dailyflow-lan) and print the URL for other devices.
.PARAMETER OpenFirewall  Also create the Windows Firewall rule (needs an elevated PowerShell).
.PARAMETER NoBuild       Skip image builds (reuse existing images).
#>
param([switch]$OpenFirewall, [switch]$NoBuild)
. "$PSScriptRoot\lan-common.ps1"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'docker not found. Install/start Docker Desktop first.' }
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker daemon is not running. Start Docker Desktop and retry.' }

$cfg = Get-LanConfig
Set-LanProcessEnv $cfg
$dump = Join-Path $LanDir $cfg.DUMP_FILE
if (-not (Test-Path $dump)) { throw "Seed dump not found: $dump (set DUMP_FILE in .env.lan)" }

$app = "http://$($cfg.LAN_IP):$($cfg.APP_PORT)"
$api = "http://$($cfg.LAN_IP):$($cfg.API_PORT)"
$auth = "http://$($cfg.LAN_IP):$($cfg.AUTH_PORT)"
Write-Host "LAN IP: $($cfg.LAN_IP)" -ForegroundColor Cyan

# Refuse to start if another process owns one of our ports (our own containers are fine).
$running = docker ps --filter "label=com.docker.compose.project=$Project" --format '{{.ID}}'
if (-not $running) {
    foreach ($p in $cfg.APP_PORT, $cfg.API_PORT, $cfg.AUTH_PORT) {
        if (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) {
            throw "Port $p is already in use on this PC. Change the ports in .env.lan (keep the 7050/7052 pattern)."
        }
    }
}

Invoke-Compose config -q
Write-Host 'Compose config OK.' -ForegroundColor Green

$build = @(if (-not $NoBuild) { '--build' })

# 1) Database first: Keycloak must find the restored realm (and its signing keys) on first boot.
Invoke-Compose up -d --wait @build postgres
$marker = "select to_regclass('keycloak.realm') is not null"
if ((Invoke-PgScalar $marker) -ne 't') {
    Write-Host 'First run: restoring the seed dump into the dailyflow-lan volume (a minute or so)...' -ForegroundColor Yellow
    # Non-fatal warnings (existing extensions/schemas) are expected; success is verified below.
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    # The dump is a PG17 archive; the server is PG16, so restore with a throwaway PG17 client on the stack network.
    $dumpFull = (Resolve-Path $dump).Path
    $env:PGPASSWORD = $cfg.POSTGRES_PASSWORD
    docker run --rm --network "${Project}_default" -e PGPASSWORD -v "${dumpFull}:/seed.dump:ro" `
        postgres:17-bookworm pg_restore -h postgres -U $cfg.POSTGRES_USER -d $cfg.POSTGRES_DB --no-owner /seed.dump 2>&1 | Select-Object -Last 8
    $ErrorActionPreference = $prev
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    if ((Invoke-PgScalar $marker) -ne 't') { throw 'Seed restore failed (keycloak.realm missing). Run stop.ps1 -Purge and retry.' }
}
# The dump predates the realtime outbox; apply the newer migrations (no-ops where already present).
if ((Invoke-PgScalar "select to_regclass('realtime.outbox') is not null") -ne 't') {
    Write-Host 'Applying post-dump migrations (realtime outbox)...' -ForegroundColor Yellow
    $migDir = Join-Path (Split-Path (Split-Path $LanDir -Parent) -Parent) 'supabase\migrations'
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'  # psql NOTICEs arrive on stderr
    foreach ($f in Get-ChildItem $migDir -Filter '2026103*.sql' | Sort-Object Name) {
        Get-Content -Raw $f.FullName | docker compose -p $Project --project-directory $LanDir --env-file $EnvFile -f "$LanDir\docker-compose.yml" `
            exec -T postgres sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -q' 2>&1 | Out-Null
    }
    $ErrorActionPreference = $prev
    if ((Invoke-PgScalar "select to_regclass('realtime.outbox') is not null") -ne 't') { Write-Warning 'realtime.outbox still missing; live updates will fall back to REST.' }
}

# 2) Point the Keycloak client at the LAN origins (SQL, so no admin password is needed), then start everything.
$kcWasRunning = [bool](docker ps -q --filter "label=com.docker.compose.project=$Project" --filter 'label=com.docker.compose.service=keycloak')
$sql = @"
update keycloak.realm set ssl_required = 'NONE' where name in ('lovable', 'master');
with c as (select cl.id from keycloak.client cl join keycloak.realm r on r.id = cl.realm_id
           where r.name = 'lovable' and cl.client_id = 'execution-os')
insert into keycloak.redirect_uris (client_id, value)
  select c.id, v from c, unnest(array['$app/*', '$api/*', '$auth/*']) v on conflict do nothing;
with c as (select cl.id from keycloak.client cl join keycloak.realm r on r.id = cl.realm_id
           where r.name = 'lovable' and cl.client_id = 'execution-os')
insert into keycloak.web_origins (client_id, value)
  select c.id, v from c, unnest(array['$app', '$api', '$auth']) v on conflict do nothing;
"@
Write-Host 'Configuring Keycloak client for the LAN origin...'
Invoke-PgScalar $sql | Out-Null
Invoke-Compose up -d --wait @build
if ($kcWasRunning) { Invoke-Compose restart keycloak; Invoke-Compose up -d --wait }  # drop Keycloak's cached client config

# 3) Firewall.
if ($OpenFirewall) {
    $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $admin) { Write-Warning 'Not elevated: re-run start.ps1 -OpenFirewall from an Administrator PowerShell.' }
    elseif (-not (Test-FirewallRule)) {
        New-NetFirewallRule -DisplayName $FirewallRuleName -Direction Inbound -Action Allow -Protocol TCP `
            -LocalPort $cfg.APP_PORT, $cfg.API_PORT, $cfg.AUTH_PORT -Profile Private | Out-Null
        Write-Host 'Firewall rule "DailyFlow LAN" created (Private networks, TCP).' -ForegroundColor Green
    }
}
if (-not (Test-FirewallRule)) {
    Write-Warning 'No firewall rule yet: other devices will be blocked. Run as Administrator: .\start.ps1 -OpenFirewall (see README.md)'
}

Write-Host ''
Write-Host 'DailyFlow is up. Open from any device on this Wi-Fi:' -ForegroundColor Green
Write-Host "  $app" -ForegroundColor Green
Write-Host '  (use the IP URL on this PC too, not localhost)'
Write-Host "Keycloak admin: $auth/admin"
