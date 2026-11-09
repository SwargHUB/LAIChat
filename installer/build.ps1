<#
  Сборка установщика LAIChat для Windows.

  Порядок:
    1. Прод-зависимости в отдельную папку (без dev-пакетов)
    2. Сборка фронтенда (Vite -> dist/)
    3. Сборка сервера (esbuild -> server.js)
    4. Портативный Node.js (скачивается, если не локальный)
    5. Копирование payload
    6. Компиляция .exe через Inno Setup

  Запуск:  powershell -ExecutionPolicy Bypass -File installer\build.ps1
#>
[CmdletBinding()]
param(
  [string]$Version = '1.0.0',
  [string]$NodeVersion = 'v24.13.0',
  [switch]$SkipNodeDownload
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root      = Split-Path $PSScriptRoot -Parent
$Installer = $PSScriptRoot
$Payload   = Join-Path $Installer 'payload'
$Stage     = Join-Path $env:TEMP 'laichat-stage'
$NodeDir   = Join-Path $env:TEMP 'laichat-node'

function Write-Step($text) {
  Write-Host "`n=== $text ===" -ForegroundColor Cyan
}

function Assert-Command($name, $hint) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Не найдена команда '$name'. $hint"
  }
}

# --- 0. Проверки окружения -------------------------------------------
Write-Step 'Проверка окружения'
Assert-Command 'node' 'Установите Node.js 18+.'
Assert-Command 'npm'  'Установите Node.js 18+.'

$iscc = @(
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $iscc) {
  throw "Inno Setup не найден. Установите: winget install JRSoftware.InnoSetup"
}
Write-Host "Inno Setup: $iscc"

Push-Location $Root
try {
  # --- 1. Прод-зависимости --------------------------------------------
  Write-Step 'Прод-зависимости'
  if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
  New-Item -ItemType Directory -Path $Stage -Force | Out-Null
  Copy-Item 'package.json' (Join-Path $Stage 'package.json') -Force
  Copy-Item 'package-lock.json' (Join-Path $Stage 'package-lock.json') -Force
  & npm install --prefix $Stage --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Не удалось установить прод-зависимости' }

  # --- 2. Фронтенд ----------------------------------------------------
  Write-Step 'Сборка фронтенда'
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Сборка фронтенда не удалась' }

  # --- 3. Сервер ------------------------------------------------------
  Write-Step 'Сборка сервера'
  & npm run build:server
  if ($LASTEXITCODE -ne 0) { throw 'Сборка сервера не удалась' }

  # --- 4. Портативный Node -------------------------------------------
  Write-Step 'Портативный Node.js'
  $nodeExe = Join-Path $NodeDir "node-$NodeVersion-win-x64\node.exe"
  if (-not (Test-Path $nodeExe)) {
    if ($SkipNodeDownload) {
      $nodeExe = (Get-Command node).Source
      Write-Host "Используется системный Node: $nodeExe"
    } else {
      $zip = Join-Path $env:TEMP "node-$NodeVersion-win-x64.zip"
      $url = "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip"
      Write-Host "Скачивание $url"
      $ProgressPreference = 'SilentlyContinue'
      Invoke-WebRequest -Uri $url -OutFile $zip -TimeoutSec 600
      if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
      Expand-Archive -LiteralPath $zip -DestinationPath $NodeDir -Force
    }
  } else {
    Write-Host "Node уже скачан: $nodeExe"
  }

  # --- 5. Payload -----------------------------------------------------
  Write-Step 'Подготовка payload'
  if (Test-Path $Payload) { Remove-Item -Recurse -Force $Payload }
  New-Item -ItemType Directory -Path $Payload -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $Payload 'node') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $Payload 'models') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $Payload 'bases') -Force | Out-Null

  Copy-Item 'server.js'   (Join-Path $Payload 'server.js') -Force
  Copy-Item 'package.json' (Join-Path $Payload 'package.json') -Force
  Copy-Item 'dist'        (Join-Path $Payload 'dist') -Recurse -Force
  Copy-Item (Join-Path $Stage 'node_modules') (Join-Path $Payload 'node_modules') -Recurse -Force
  Copy-Item $nodeExe      (Join-Path $Payload 'node\node.exe') -Force

  if (Test-Path 'bin') {
    Copy-Item 'bin' (Join-Path $Payload 'bin') -Recurse -Force
  } else {
    Write-Warning 'Папка bin/ не найдена — llama.cpp не попадёт в установщик'
  }

  # Примеры баз знаний (без пользовательских)
  Get-ChildItem 'bases' -Filter '*.md' -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -in @('go.md', 'python.md', 'bash.md') } |
    ForEach-Object { Copy-Item $_.FullName (Join-Path $Payload 'bases') -Force }

  # Лаунчер: CRLF обязателен, иначе goto в .cmd не работает
  Copy-Item (Join-Path $Installer 'LAIChat.cmd') (Join-Path $Payload 'LAIChat.cmd') -Force
  $bytes = [IO.File]::ReadAllBytes((Join-Path $Payload 'LAIChat.cmd'))
  $out = New-Object System.Collections.Generic.List[byte]
  for ($i = 0; $i -lt $bytes.Length; $i++) {
    if ($bytes[$i] -eq 10 -and ($i -eq 0 -or $bytes[$i - 1] -ne 13)) { $out.Add([byte]13) }
    $out.Add([byte]$bytes[$i])
  }
  [IO.File]::WriteAllBytes((Join-Path $Payload 'LAIChat.cmd'), $out.ToArray())

  # --- 6. Компиляция --------------------------------------------------
  Write-Step 'Компиляция установщика'
  & $iscc (Join-Path $Installer 'LAIChat.iss')
  if ($LASTEXITCODE -ne 0) { throw 'Компиляция установщика не удалась' }

  $exe = Join-Path $Installer "release\LAIChat-Setup-$Version.exe"
  if (Test-Path $exe) {
    $size = [Math]::Round((Get-Item $exe).Length / 1MB, 1)
    Write-Host "`nГотово: $exe ($size МБ)" -ForegroundColor Green
  }
}
finally {
  Pop-Location
}
