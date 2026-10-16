param([switch]$Install)
$ErrorActionPreference = 'Stop'
$runtime = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '.tools') -Directory -Filter 'node-*-win-x64' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
if ($runtime) { $env:PATH = $runtime.FullName + ';' + $env:PATH }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 LTS before starting Time Tracker.' }
Push-Location $PSScriptRoot
try {
  if ($Install -or -not (Test-Path -LiteralPath 'node_modules')) { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' } }
  & npm.cmd start
} finally { Pop-Location }
