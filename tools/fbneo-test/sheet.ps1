param([string]$Pattern, [string]$Out, [int]$Cols = 4, [int]$Scale = 1, [string[]]$Labels = @())
# Tile screenshots matching a pattern into one labelled contact sheet.
Add-Type -AssemblyName System.Drawing
$T = $PSScriptRoot
$files = Get-ChildItem $T -Filter $Pattern | Sort-Object { [int](($_.BaseName -split '_f')[-1]) }
$first = [System.Drawing.Image]::FromFile($files[0].FullName)
$w = $first.Width * $Scale; $h = $first.Height * $Scale; $first.Dispose()
$rows = [math]::Ceiling($files.Count / $Cols)
$bmp = New-Object System.Drawing.Bitmap ($w * $Cols), (($h + 18) * $rows)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.Clear([System.Drawing.Color]::Black)
$font = New-Object System.Drawing.Font "Consolas", 10
for ($i = 0; $i -lt $files.Count; $i++) {
  $img = [System.Drawing.Image]::FromFile($files[$i].FullName)
  $x = ($i % $Cols) * $w; $y = [math]::Floor($i / $Cols) * ($h + 18)
  $g.DrawImage($img, $x, $y + 18, $w, $h)
  $label = if ($Labels.Count -gt $i) { $Labels[$i] } else { $files[$i].BaseName }
  $g.DrawString($label, $font, [System.Drawing.Brushes]::Yellow, $x + 2, $y + 2)
  $img.Dispose()
}
$bmp.Save("$T\$Out", [System.Drawing.Imaging.ImageFormat]::Png)
"$($files.Count) images -> $Out"
