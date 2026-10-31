param([int]$Wait = 60)
# Run the harness: start FBNeo with harness.lua, dismiss the "modified ROM" warning, stop when the log says done.
$T = $PSScriptRoot
Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class Wd {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  public static void KeepVisible(IntPtr h) { if (h == IntPtr.Zero) return; ShowWindow(h, 4); SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010); }
  public static string DismissWarnings(uint pid) {
    var log = new StringBuilder();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      var t = new StringBuilder(256); GetWindowText(h, t, 256);
      if (p == pid && IsWindowVisible(h) && t.ToString().Contains("Warning")) {
        IntPtr ok = IntPtr.Zero;
        EnumChildWindows(h, (c, l2) => {
          var cls = new StringBuilder(64); GetClassName(c, cls, 64);
          var txt = new StringBuilder(1024); GetWindowText(c, txt, 1024);
          if (txt.Length > 0) log.Append("[" + cls + "] " + txt + "\n");
          if (cls.ToString() == "Button" && ok == IntPtr.Zero) ok = c;
          return true; }, IntPtr.Zero);
        if (ok != IntPtr.Zero) SendMessage(ok, 0x00F5, IntPtr.Zero, IntPtr.Zero); // BM_CLICK
      }
      return true; }, IntPtr.Zero);
    return log.ToString();
  }
}
"@
$cfg0 = Get-Content "$T\harness_cfg.lua" -Raw; $out0 = ([regex]::Match($cfg0, 'out\s*=\s*"([^"]+)"')).Groups[1].Value; Get-ChildItem $T -Filter "${out0}_*" | Remove-Item -Force -ErrorAction SilentlyContinue
$p = Start-Process -FilePath "$T\fcadefbneo.exe" -ArgumentList "kof97", "$T\harness.lua" -WorkingDirectory $T -PassThru
$cfg = Get-Content "$T\harness_cfg.lua" -Raw
$out = ([regex]::Match($cfg, 'out\s*=\s*"([^"]+)"')).Groups[1].Value
$deadline = (Get-Date).AddSeconds($Wait)
$warned = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
  $w = [Wd]::DismissWarnings([uint32]$p.Id); $p.Refresh(); [Wd]::KeepVisible($p.MainWindowHandle)
  if ($w -and -not $warned) { "warning dismissed:"; $w; $warned = $true }
  if ((Test-Path "$T\${out}_log.txt") -and ((Get-Content "$T\${out}_log.txt" -Raw) -match "done")) { break }
}
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
Get-Content "$T\${out}_log.txt" -ErrorAction SilentlyContinue


