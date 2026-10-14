param(
  [Parameter(Mandatory = $true)]
  [string]$InputDir,
  [Parameter(Mandatory = $true)]
  [string]$OutputDir
)

$ErrorActionPreference = 'Stop'

$resolvedInput = (Resolve-Path -LiteralPath $InputDir).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDir)
if (-not (Test-Path -LiteralPath $resolvedOutput)) {
  New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
}

$files = @(Get-ChildItem -LiteralPath $resolvedInput -Filter '*.pptx' -File | Sort-Object Name)
if ($files.Count -ne 20) {
  throw "Expected exactly 20 PPTX files, found $($files.Count)."
}

$powerPoint = $null
try {
  $powerPoint = New-Object -ComObject PowerPoint.Application
  $powerPoint.Visible = 1
  $powerPoint.DisplayAlerts = 1
  $results = @()

  foreach ($file in $files) {
    if ($file.Name -notmatch '^\D*([0-9]{1,2})') {
      throw "Cannot read chapter number from $($file.Name)."
    }
    $chapter = [int]$Matches[1]
    if ($chapter -lt 1 -or $chapter -gt 20) {
      throw "Chapter number out of range in $($file.Name)."
    }
    $pdfPath = Join-Path $resolvedOutput ("chapter-{0:D2}-slides-v1.pdf" -f $chapter)
    $presentation = $null
    try {
      $presentation = $powerPoint.Presentations.Open($file.FullName, $true, $false, $false)
      $slideCount = [int]$presentation.Slides.Count
      if ($slideCount -lt 1) {
        throw "The deck has no slides."
      }
      $presentation.SaveAs($pdfPath, 32)
      $results += [pscustomobject]@{
        chapter = $chapter
        source = $file.Name
        pdf = [System.IO.Path]::GetFileName($pdfPath)
        slideCount = $slideCount
      }
    } finally {
      if ($null -ne $presentation) {
        $presentation.Close()
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($presentation) | Out-Null
      }
    }
  }

  $results | Sort-Object chapter | ConvertTo-Json -Compress
} finally {
  if ($null -ne $powerPoint) {
    $powerPoint.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($powerPoint) | Out-Null
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
