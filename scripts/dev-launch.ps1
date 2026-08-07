# Molcraft dev launcher — proper detached start.
# Invoked as:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-launch.ps1
#
# Why so convoluted: this Windows host's PowerShell 5.1 Start-Process
# rejects multi-element ArgumentList when any token contains "tmp" (a
# known quirk on machines with PSReadLine/PSv5 + GPO-injected modules).
# Workaround: hand cmd.exe a single full command line. cmd is happy to
# accept arbitrary characters and the /c flag exits after the inner
# command is launched.
$ErrorActionPreference = "Stop"

$ProjectDir = "D:\AI-web-app\Molcraft"
$Port = 3015
$LogFile = Join-Path $ProjectDir "dev.log"
$LogFileErr = Join-Path $ProjectDir "dev.err.log"
$NextCache = Join-Path $ProjectDir ".next"

# Pre-flight: kill anything holding $Port.
$holding = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
if ($holding) {
  $holding | ForEach-Object {
    try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
  }
  Start-Sleep -Seconds 1
}

if (Test-Path $NextCache) { Remove-Item -Recurse -Force $NextCache }

"" | Set-Content -Path $LogFile -Encoding UTF8
"" | Set-Content -Path $LogFileErr -Encoding UTF8

$nodeBin = "node"
$nextBin = Join-Path $ProjectDir "node_modules\next\dist\bin\next"

# Build a one-shot .cmd that backgrounds next dev and writes both streams
# to dev.log. The .cmd exits immediately; the launched process keeps
# running because we use `start /b` (no parent-child tie).
#
# We export PYTHONIOENCODING=PYTHONUTF8 explicitly because the Windows
# Python interpreter (which Hermes ships as a venv) defaults to cp936
# on this host, which garbles UTF-8 Chinese in stdin. Setting these in
# the cmd's env (not just the parent shell) ensures the child processes
# Hermes spawns also inherit them.
$cmdScript = Join-Path $ProjectDir "scripts\.run-dev.cmd"
@"
@echo off
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
set LANG=zh_CN.UTF-8
cd /d "$ProjectDir"
"$nodeBin" "$nextBin" dev -p $Port > "$LogFile" 2> "$LogFileErr"
"@ | Set-Content -Path $cmdScript -Encoding ASCII

# Launch via cmd /c start /b — completely detached, no MSYS, no PowerShell
# parameter parsing. `start` itself returns immediately.
Start-Process -FilePath "cmd.exe" -ArgumentList "/c start /b cmd /c `"$cmdScript`"" -WindowStyle Hidden

Write-Host "next dev launched on port $Port (cmd script: $cmdScript)"
Write-Host "Waiting up to 30s for port $Port to be ready..."

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($conn) {
    Write-Host "Port $Port is listening (PID=$($conn.OwningProcess))"
    $ready = $true
    break
  }
}
if (-not $ready) {
  Write-Warning "Port $Port not ready after 30s. Check dev.log."
  Get-Content $LogFile -ErrorAction SilentlyContinue | Select-Object -First 40
  Get-Content $LogFileErr -ErrorAction SilentlyContinue | Select-Object -First 40
  exit 1
}
