# Sets up game capture on Windows. Capturing needs a raw socket, which Windows only
# gives to administrators, so capture runs as a scheduled task with the highest run
# level: registered once here (elevated), then started and stopped by the app without
# a UAC prompt. Run elevated by the installer (install/uninstall) and by the app's
# "Grant capture permission" tray item.
#
#   capture-task.ps1 install     register the task and the firewall rule
#   capture-task.ps1 uninstall   remove them
#
# Lives in <install dir>\resources\windows; Python and the capture script are next to it.
param([Parameter(Mandatory)][ValidateSet('install', 'uninstall')][string]$Action)

$ErrorActionPreference = 'Stop'
$TaskName = 'Horazon Capture'
$RuleName = 'Horazon Capture'
$Resources = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $Resources 'python\pythonw.exe'
$Script = Join-Path $Resources 'capture\pd2capture.py'
$Data = Join-Path $env:ProgramData 'Horazon'
# The app writes run.json (its port) and the stop flag here; the task only reads them.
$Control = Join-Path $Data 'capture'
# Written by the elevated task; readable, not writable, by users.
$Logs = Join-Path $Data 'logs'

if ($Action -eq 'uninstall') {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $Data -ErrorAction SilentlyContinue
  exit 0
}

New-Item -ItemType Directory -Force $Control, $Logs | Out-Null
# Users (S-1-5-32-545) may write the control folder.
icacls $Control /grant '*S-1-5-32-545:(OI)(CI)M' | Out-Null
# Logs: Administrators and SYSTEM full control, Users read only.
icacls $Logs /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null

$user = "$env:USERDOMAIN\$env:USERNAME"
$taskAction = New-ScheduledTaskAction -Execute $Python -Argument "`"$Script`" live --control-dir `"$Control`" --log-dir `"$Logs`""
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Principal $principal -Settings $settings -Force | Out-Null

# Without a rule, Windows Firewall drops inbound game packets before the raw socket sees them.
Remove-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Program $Python -Action Allow -Profile Any | Out-Null
