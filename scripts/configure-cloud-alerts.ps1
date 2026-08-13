[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$ProjectId = 'gen-lang-client-0815966909',
  [string]$NotificationChannel = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$gcloud = Get-Command gcloud.cmd -ErrorAction SilentlyContinue
if (-not $gcloud) {
  throw 'gcloud CLI is required to create Cloud Monitoring policies. Install it, authenticate, then rerun this script.'
}

$policyFiles = @(
  (Join-Path $repoRoot 'ops/aura-function-errors-policy.json'),
  (Join-Path $repoRoot 'ops/aura-app-check-policy.json')
)

foreach ($policyFile in $policyFiles) {
  $args = @('monitoring', 'policies', 'create', '--project', $ProjectId, '--policy-from-file', $policyFile)
  if ($NotificationChannel) { $args += @('--notification-channels', $NotificationChannel) }
  if ($PSCmdlet.ShouldProcess($policyFile, 'Create or update Cloud Monitoring policy')) {
    & gcloud.cmd @args
  }
}

Write-Host 'Cloud Monitoring policies are configured. Add a notification channel if none was supplied.'
