<#
.SYNOPSIS  Stop the DailyFlow LAN stack (project dailyflow-lan only). Data is kept.
.PARAMETER Purge           Also delete the dailyflow-lan database volume (full reset, re-seeded on next start).
.PARAMETER RemoveFirewall  Also remove the "DailyFlow LAN" firewall rule (needs an elevated PowerShell).
#>
param([switch]$Purge, [switch]$RemoveFirewall)
. "$PSScriptRoot\lan-common.ps1"

if (-not (Test-Path $EnvFile)) { Write-Host 'No .env.lan: nothing was started from here.'; return }
$cfg = Read-EnvFile $EnvFile
# Variables only need to exist for interpolation; their values are irrelevant for "down".
$env:LAN_IP = if ($cfg.LAN_IP) { $cfg.LAN_IP } else { '0.0.0.0' }

if ($Purge) {
    $a = Read-Host 'This DELETES the dailyflow-lan database volume (not local/prod). Type YES to continue'
    if ($a -ne 'YES') { Write-Host 'Aborted.'; return }
    Invoke-Compose down --volumes --remove-orphans
} else {
    Invoke-Compose down --remove-orphans
}
if ($RemoveFirewall -and (Test-FirewallRule)) {
    Remove-NetFirewallRule -DisplayName $FirewallRuleName
    Write-Host 'Firewall rule removed.'
}
Write-Host 'dailyflow-lan stopped.' -ForegroundColor Green
