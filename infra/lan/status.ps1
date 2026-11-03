<#
.SYNOPSIS  Show state, URLs, reachability and exposure of the DailyFlow LAN stack.
#>
. "$PSScriptRoot\lan-common.ps1"

$cfg = Get-LanConfig
Set-LanProcessEnv $cfg
$app = "http://$($cfg.LAN_IP):$($cfg.APP_PORT)"
$api = "http://$($cfg.LAN_IP):$($cfg.API_PORT)"
$auth = "http://$($cfg.LAN_IP):$($cfg.AUTH_PORT)"

Write-Host "LAN IP : $($cfg.LAN_IP)"
Write-Host "App URL: $app"
Write-Host ''
docker ps -a --filter "label=com.docker.compose.project=$Project" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

function Test-Url($label, $url, $ok) {
    try { $code = [int](Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop).StatusCode }
    catch { $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 } }
    $good = $ok -contains $code
    Write-Host ('  {0,-9} {1,-62} {2}' -f $label, $url, $(if ($good) { "OK ($code)" } else { "FAIL ($code)" })) -ForegroundColor $(if ($good) { 'Green' } else { 'Red' })
}
Write-Host ''
Write-Host 'Reachability (from this PC, via the LAN IP):'
Test-Url 'App' "$app/" 200, 301, 302, 304
Test-Url 'API' "$api/rest/v1/" 200, 401
Test-Url 'Keycloak' "$auth/realms/lovable/.well-known/openid-configuration" 200

Write-Host ''
Write-Host 'Exposure (host listeners):'
foreach ($p in $cfg.APP_PORT, $cfg.API_PORT, $cfg.AUTH_PORT) {
    $l = @(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
    Write-Host ('  port {0,-6} {1}' -f $p, $(if ($l) { 'listening on ' + (($l.LocalAddress | Sort-Object -Unique) -join ', ') } else { 'NOT listening' }))
}
$pg = docker port "$Project-postgres-1" 2>$null
Write-Host ('  postgres   {0}' -f $(if ($pg) { "EXPOSED: $pg" } else { 'not published (internal only)' }))

Write-Host ''
Write-Host ("Firewall rule 'DailyFlow LAN': {0}" -f $(if (Test-FirewallRule) { 'present' } else { 'MISSING - run start.ps1 -OpenFirewall as Administrator' }))
