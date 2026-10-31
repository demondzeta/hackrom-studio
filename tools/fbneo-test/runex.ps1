param([string]$Ex, [string]$Cfg, [int]$Wait = 60)
# Put sets\<Ex>.zip in place as ROMs\kof97.zip, write the harness config and run it.
$T = $PSScriptRoot
Copy-Item "$T\sets\$Ex.zip" "$T\ROMs\kof97.zip" -Force
Set-Content "$T\harness_cfg.lua" $Cfg -Encoding ascii
Remove-Item "$T\${Ex}_*" -ErrorAction SilentlyContinue
& "$T\runtest.ps1" -Wait $Wait
