Add-Type -AssemblyName System.Drawing

function New-AuraIcon([int]$Size, [string]$OutputPath) {
  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#09090B'))

  $haloBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(30, 255, 255, 255))
  $haloInset = [int]($Size * 0.20)
  $graphics.FillEllipse($haloBrush, $haloInset, $haloInset, $Size - (2 * $haloInset), $Size - (2 * $haloInset))

  $whitePen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, [single]($Size * 0.105))
  $whitePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $whitePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $whitePen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $graphics.DrawLine($whitePen, [single]($Size * 0.25), [single]($Size * 0.75), [single]($Size * 0.50), [single]($Size * 0.23))
  $graphics.DrawLine($whitePen, [single]($Size * 0.50), [single]($Size * 0.23), [single]($Size * 0.75), [single]($Size * 0.75))
  $graphics.DrawLine($whitePen, [single]($Size * 0.37), [single]($Size * 0.56), [single]($Size * 0.63), [single]($Size * 0.56))

  $accentBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml('#FF2D91'))
  $accentSize = [int]($Size * 0.12)
  $graphics.FillEllipse($accentBrush, [int]($Size * 0.70), [int]($Size * 0.18), $accentSize, $accentSize)

  $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $accentBrush.Dispose()
  $whitePen.Dispose()
  $haloBrush.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

$iconsDirectory = Resolve-Path (Join-Path $PSScriptRoot '..\public\icons')
New-AuraIcon 192 (Join-Path $iconsDirectory 'aura-icon-192.png')
New-AuraIcon 512 (Join-Path $iconsDirectory 'aura-icon-512.png')
