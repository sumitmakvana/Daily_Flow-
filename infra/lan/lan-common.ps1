# Shared helpers for start.ps1 / stop.ps1 / status.ps1 (dot-sourced). LAN stack only.
$ErrorActionPreference = 'Stop'
$script:LanDir = $PSScriptRoot
$script:EnvFile = Join-Path $LanDir '.env.lan'
$script:Project = 'dailyflow-lan'

function Read-EnvFile([string]$Path) {
    $map = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^\s*#' -or $line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { continue }
        $v = $Matches[2].Trim()
        if ($v.Length -ge 2 -and (($v[0] -eq "'" -and $v[-1] -eq "'") -or ($v[0] -eq '"' -and $v[-1] -eq '"'))) {
            $v = $v.Substring(1, $v.Length - 2)
        }
        $map[$Matches[1]] = $v
    }
    $map
}

# Create .env.lan from the example, reusing the existing dummy/local secrets (never printed).
function New-LanEnvFile {
    $infra = Split-Path $LanDir -Parent
    $localEnv = Join-Path $infra '.env.local-test'
    $localCompose = Join-Path $infra 'docker-compose.local.yml'
    if (-not (Test-Path $localEnv) -or -not (Test-Path $localCompose)) {
        throw "Cannot bootstrap .env.lan: need infra\.env.local-test and infra\docker-compose.local.yml. Copy .env.lan.example to .env.lan and fill it in manually."
    }
    $src = Read-EnvFile $localEnv
    $jwks = $null
    foreach ($line in Get-Content -LiteralPath $localCompose) {
        if ($line -match "^\s*PGRST_JWT_SECRET:\s*'(.*)'\s*$") { $jwks = $Matches[1]; break }
    }
    if (-not $jwks) { throw "PGRST_JWT_SECRET not found in infra\docker-compose.local.yml; set it in .env.lan manually." }
    $fill = @{ PGRST_JWT_SECRET = "'$jwks'" }
    foreach ($k in 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'VITE_SUPABASE_PUBLISHABLE_KEY',
                   'SUPABASE_SERVICE_ROLE_KEY', 'KEYCLOAK_ADMIN', 'KEYCLOAK_ADMIN_PASSWORD', 'CRON_SECRET') {
        if ($src.ContainsKey($k)) { $fill[$k] = $src[$k] }
    }
    $out = foreach ($line in Get-Content -LiteralPath (Join-Path $LanDir '.env.lan.example')) {
        if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=' -and $fill.ContainsKey($Matches[1])) { "$($Matches[1])=$($fill[$Matches[1]])" } else { $line }
    }
    Set-Content -LiteralPath $EnvFile -Value $out -Encoding utf8
    Write-Host "Created .env.lan (secrets reused from infra\.env.local-test; edit it to customise)." -ForegroundColor Yellow
}

# Pick the Windows IPv4 that owns the best default route, skipping virtual/VPN adapters.
function Get-LanIp {
    $virtual = 'vEthernet|WSL|Hyper-V|VirtualBox|VMware|VPN|Loopback|Tailscale|ZeroTier|Docker|Bluetooth'
    $routes = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
        Sort-Object { $_.RouteMetric + (Get-NetIPInterface -InterfaceIndex $_.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).InterfaceMetric }
    foreach ($r in $routes) {
        $ip = Get-NetIPAddress -InterfaceIndex $r.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -notmatch '^(169\.254|127\.)' -and $_.InterfaceAlias -notmatch $virtual } |
            Select-Object -First 1
        if ($ip) { return $ip.IPAddress }
    }
    $null
}

function Get-LanConfig {
    if (-not (Test-Path $EnvFile)) { New-LanEnvFile }
    $cfg = Read-EnvFile $EnvFile
    foreach ($k in 'APP_PORT', 'API_PORT', 'AUTH_PORT') { if (-not $cfg[$k]) { throw "$k is not set in .env.lan" } }
    if ($cfg.APP_PORT -notmatch '7050') { throw "APP_PORT must contain '7050' (browser derives the Keycloak URL by replacing 7050 -> 7052)." }
    if ($cfg.AUTH_PORT -ne $cfg.APP_PORT.Replace('7050', '7052')) { throw "AUTH_PORT must be APP_PORT with 7050 replaced by 7052 (e.g. 17050 -> 17052)." }
    if (-not $cfg.LAN_IP) { $cfg.LAN_IP = Get-LanIp }
    if (-not $cfg.LAN_IP -or $cfg.LAN_IP -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
        throw "Could not detect the LAN IP. Set LAN_IP=<your Wi-Fi IPv4> in .env.lan."
    }
    $cfg
}

# docker compose scoped to this stack. LAN_IP (possibly auto-detected) is passed via the process
# environment, which takes precedence over --env-file.
function Invoke-Compose {
    $cmd = @('compose', '-p', $Project, '--project-directory', $LanDir, '--env-file', $EnvFile, '-f', (Join-Path $LanDir 'docker-compose.yml')) + $args
    & docker @cmd
    if ($LASTEXITCODE -ne 0) { throw "docker compose $($args -join ' ') failed (exit $LASTEXITCODE)" }
}

# Run a SQL scalar inside the postgres container and return its trimmed output.
function Invoke-PgScalar([string]$Sql) {
    # SQL goes over stdin so PowerShell/shell quoting cannot mangle it.
    $out = $Sql | & docker compose -p $Project --project-directory $LanDir --env-file $EnvFile -f (Join-Path $LanDir 'docker-compose.yml') `
        exec -T postgres sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -At'
    "$out".Trim()
}

function Set-LanProcessEnv($cfg) {
    $env:LAN_IP = $cfg.LAN_IP
    $env:APP_PORT = $cfg.APP_PORT; $env:API_PORT = $cfg.API_PORT; $env:AUTH_PORT = $cfg.AUTH_PORT
}

$script:FirewallRuleName = 'DailyFlow LAN'
function Test-FirewallRule { [bool](Get-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue) }
