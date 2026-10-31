param([string]$Game = "kof97", [string]$Lua = "", [int]$Wait = 10, [string]$Shot = "window.png", [switch]$Keep)
# Launch the isolated FBNeo copy, wait, then capture only the emulator window.
$T = $PSScriptRoot
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public struct RECT { public int L, T, R, B; }
}
"@
$args2 = @($Game)
if ($Lua) { $args2 += $Lua }
$p = Start-Process -FilePath "$T\fcadefbneo.exe" -ArgumentList $args2 -WorkingDirectory $T -PassThru
Start-Sleep -Seconds $Wait
$p.Refresh()
$h = $p.MainWindowHandle
"title: " + $p.MainWindowTitle
$r = New-Object W+RECT
[W]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.R - $r.L; $hh = $r.B - $r.T
"rect: $w x $hh"
if ($w -gt 0 -and $hh -gt 0) {
  [W]::SetForegroundWindow($h) | Out-Null
  Start-Sleep -Milliseconds 600
  $bmp = New-Object System.Drawing.Bitmap $w, $hh
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
  $bmp.Save("$T\$Shot", [System.Drawing.Imaging.ImageFormat]::Png)
}
Get-Process | Where-Object { $_.MainWindowTitle -and $_.Id -ne $p.Id -and $_.ProcessName -like "fcade*" } | ForEach-Object { "other window: " + $_.MainWindowTitle }
if (-not $Keep) { Stop-Process -Id $p.Id -Force }
