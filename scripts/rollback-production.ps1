[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^https://[^\s]+$')]
  [string]$VercelDeploymentUrl,

  [switch]$SkipVercel,
  [switch]$RedeployFunctions
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

if ((git status --porcelain)) {
  throw 'Rollback stopped: working tree is not clean. Commit or stash local changes first.'
}

Write-Host "Rollback target: $VercelDeploymentUrl"
Write-Host 'This keeps the current Git branch unchanged and promotes an already-built Vercel deployment.'

if (-not $SkipVercel) {
  $vercel = Get-Command vercel.cmd -ErrorAction SilentlyContinue
  if (-not $vercel) {
    throw 'Vercel CLI is required. Install it or use the Vercel dashboard to promote the target deployment.'
  }
  if ($PSCmdlet.ShouldProcess($VercelDeploymentUrl, 'Promote Vercel deployment to production')) {
    & vercel.cmd rollback $VercelDeploymentUrl --yes
  }
}

if ($RedeployFunctions) {
  $projectId = (Get-Content -LiteralPath '.firebaserc' -Raw | ConvertFrom-Json).projects.default
  if ($PSCmdlet.ShouldProcess($projectId, 'Redeploy Functions from the current checked-out release')) {
    & firebase.cmd deploy --only functions --project $projectId
  }
}

Write-Host 'Rollback command completed. Run: node scripts/production-smoke.mjs'
