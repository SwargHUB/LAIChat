@echo off
chcp 65001 >nul
setlocal
title Установка LAIChat для Windows

echo ========================================================
echo   Запуск мастера установки LAIChat (Windows GUI Setup)
echo ========================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -STA -Command ^
  "$scriptPath = Join-Path '%~dp0' 'install.ps1';" ^
  "if (Test-Path $scriptPath) { & $scriptPath } else {" ^
  "  Write-Host 'Запуск встроенного установщика LAIChat...';" ^
  "  Invoke-Expression (Get-Content '%~f0' -Raw | Select-String -Pattern '(?s)# --- PS1_START ---.*' | ForEach-Object { $_.Matches.Value })" ^
  "}"

exit /b 0

# --- PS1_START ---
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = "Мастер установки LAIChat v1.0 (Windows)"
$form.Size = New-Object System.Drawing.Size(680, 620)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(14, 14, 22)
$form.ForeColor = [System.Drawing.Color]::FromArgb(244, 244, 246)
$form.Font = New-Object System.Drawing.Font("Segoe UI", 9.5)

$accentColor = [System.Drawing.Color]::FromArgb(34, 211, 238)
$cardColor   = [System.Drawing.Color]::FromArgb(24, 24, 36)
$mutedColor  = [System.Drawing.Color]::FromArgb(160, 160, 180)
$greenColor  = [System.Drawing.Color]::FromArgb(52, 211, 153)

# Заголовок
$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = "Установка LAIChat — Локальный AI-чат"
$lblTitle.Font = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$lblTitle.ForeColor = [System.Drawing.Color]::White
$lblTitle.Location = New-Object System.Drawing.Point(24, 18)
$lblTitle.Size = New-Object System.Drawing.Size(620, 30)
$form.Controls.Add($lblTitle)

$lblSub = New-Object System.Windows.Forms.Label
$lblSub.Text = "Выберите папку установки (по умолчанию пользовательская) и начальную AI-модель"
$lblSub.ForeColor = $mutedColor
$lblSub.Location = New-Object System.Drawing.Point(24, 48)
$lblSub.Size = New-Object System.Drawing.Size(620, 22)
$form.Controls.Add($lblSub)

# 1. Папка установки (по умолчанию %USERPROFILE%\LAIChat)
$grpPath = New-Object System.Windows.Forms.GroupBox
$grpPath.Text = " 1. Папка установки (по умолчанию пользовательская) "
$grpPath.ForeColor = $accentColor
$grpPath.Location = New-Object System.Drawing.Point(24, 78)
$grpPath.Size = New-Object System.Drawing.Size(616, 76)
$form.Controls.Add($grpPath)

$defaultInstallDir = Join-Path $env:USERPROFILE "LAIChat"

$txtPath = New-Object System.Windows.Forms.TextBox
$txtPath.Text = $defaultInstallDir
$txtPath.Location = New-Object System.Drawing.Point(16, 30)
$txtPath.Size = New-Object System.Drawing.Size(470, 28)
$txtPath.BackColor = $cardColor
$txtPath.ForeColor = [System.Drawing.Color]::White
$txtPath.BorderStyle = "FixedSingle"
$grpPath.Controls.Add($txtPath)

$btnBrowse = New-Object System.Windows.Forms.Button
$btnBrowse.Text = "Обзор..."
$btnBrowse.Location = New-Object System.Drawing.Point(496, 28)
$btnBrowse.Size = New-Object System.Drawing.Size(104, 28)
$btnBrowse.FlatStyle = "Flat"
$btnBrowse.BackColor = $cardColor
$btnBrowse.ForeColor = [System.Drawing.Color]::White
$btnBrowse.Add_Click({
  $fbd = New-Object System.Windows.Forms.FolderBrowserDialog
  $fbd.Description = "Выберите папку для установки LAIChat"
  $fbd.SelectedPath = $txtPath.Text
  if ($fbd.ShowDialog() -eq "OK") {
    $txtPath.Text = $fbd.SelectedPath
  }
})
$grpPath.Controls.Add($btnBrowse)

# 2. Выбор модели или пропуск шага
$grpModel = New-Object System.Windows.Forms.GroupBox
$grpModel.Text = " 2. Настройка AI-модели (можно пропустить и настроить позже в интерфейсе) "
$grpModel.ForeColor = $accentColor
$grpModel.Location = New-Object System.Drawing.Point(24, 166)
$grpModel.Size = New-Object System.Drawing.Size(616, 290)
$form.Controls.Add($grpModel)

# Определение ОЗУ компьютера
$totalRamGb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
$lblHw = New-Object System.Windows.Forms.Label
$lblHw.Text = "Обнаружено ОЗУ вашего ПК: $totalRamGb ГБ"
$lblHw.ForeColor = $greenColor
$lblHw.Location = New-Object System.Drawing.Point(16, 24)
$lblHw.Size = New-Object System.Drawing.Size(580, 20)
$grpModel.Controls.Add($lblHw)

# Радиокнопки выбора режима
$rbLocal = New-Object System.Windows.Forms.RadioButton
$rbLocal.Text = "Скачать локальную модель GGUF с Hugging Face в папку models/"
$rbLocal.ForeColor = [System.Drawing.Color]::White
$rbLocal.Location = New-Object System.Drawing.Point(16, 50)
$rbLocal.Size = New-Object System.Drawing.Size(580, 24)
$rbLocal.Checked = $true
$grpModel.Controls.Add($rbLocal)

$cmbLocalModel = New-Object System.Windows.Forms.ComboBox
$cmbLocalModel.DropDownStyle = "DropDownList"
$cmbLocalModel.Location = New-Object System.Drawing.Point(36, 78)
$cmbLocalModel.Size = New-Object System.Drawing.Size(560, 28)
$cmbLocalModel.BackColor = $cardColor
$cmbLocalModel.ForeColor = [System.Drawing.Color]::White
[void]$cmbLocalModel.Items.Add("Qwen 2.5 1.5B Instruct (Q4_K_M, ~1.1 ГБ) — Быстрая, для любого ПК от 4 ГБ ОЗУ")
[void]$cmbLocalModel.Items.Add("Llama 3.2 3B Instruct (Q4_K_M, ~2.0 ГБ) — Сбалансированная, от 6 ГБ ОЗУ")
[void]$cmbLocalModel.Items.Add("Qwen 2.5 3B Instruct (Q4_K_M, ~2.1 ГБ) — Отличный русский язык, от 6 ГБ ОЗУ")
[void]$cmbLocalModel.Items.Add("Qwen 2.5 7B Instruct (Q4_K_M, ~4.7 ГБ) — Рекомендуется для 8–16+ ГБ ОЗУ")
[void]$cmbLocalModel.Items.Add("Qwen 2.5 Coder 7B Instruct (Q4_K_M, ~4.7 ГБ) — Для кода и тех. баз, от 8 ГБ ОЗУ")
[void]$cmbLocalModel.Items.Add("Llama 3.1 8B Instruct (Q4_K_M, ~4.9 ГБ) — Универсальная 8B, от 8 ГБ ОЗУ")
if ($totalRamGb -lt 7.5) { $cmbLocalModel.SelectedIndex = 0 } else { $cmbLocalModel.SelectedIndex = 3 }
$grpModel.Controls.Add($cmbLocalModel)

$rbCloud = New-Object System.Windows.Forms.RadioButton
$rbCloud.Text = "Выбрать облачную модель (Google Gemini / DeepSeek / OpenAI / Groq)"
$rbCloud.ForeColor = [System.Drawing.Color]::White
$rbCloud.Location = New-Object System.Drawing.Point(16, 116)
$rbCloud.Size = New-Object System.Drawing.Size(580, 24)
$grpModel.Controls.Add($rbCloud)

$lblCloudProvider = New-Object System.Windows.Forms.Label
$lblCloudProvider.Text = "Облачный провайдер:"
$lblCloudProvider.ForeColor = $mutedColor
$lblCloudProvider.Location = New-Object System.Drawing.Point(36, 146)
$lblCloudProvider.Size = New-Object System.Drawing.Size(150, 22)
$grpModel.Controls.Add($lblCloudProvider)

$cmbCloud = New-Object System.Windows.Forms.ComboBox
$cmbCloud.DropDownStyle = "DropDownList"
$cmbCloud.Location = New-Object System.Drawing.Point(190, 143)
$cmbCloud.Size = New-Object System.Drawing.Size(406, 28)
$cmbCloud.BackColor = $cardColor
$cmbCloud.ForeColor = [System.Drawing.Color]::White
[void]$cmbCloud.Items.Add("Google Gemini (gemini-3.5-flash)")
[void]$cmbCloud.Items.Add("DeepSeek API (deepseek-chat)")
[void]$cmbCloud.Items.Add("OpenRouter (deepseek/deepseek-chat)")
[void]$cmbCloud.Items.Add("Groq Cloud (llama-3.3-70b-versatile)")
[void]$cmbCloud.Items.Add("OpenAI (gpt-4o-mini)")
$cmbCloud.SelectedIndex = 0
$cmbCloud.Enabled = $false
$grpModel.Controls.Add($cmbCloud)

$lblApiKey = New-Object System.Windows.Forms.Label
$lblApiKey.Text = "API Ключ (необязательно):"
$lblApiKey.ForeColor = $mutedColor
$lblApiKey.Location = New-Object System.Drawing.Point(36, 180)
$lblApiKey.Size = New-Object System.Drawing.Size(155, 22)
$grpModel.Controls.Add($lblApiKey)

$txtApiKey = New-Object System.Windows.Forms.TextBox
$txtApiKey.Location = New-Object System.Drawing.Point(190, 177)
$txtApiKey.Size = New-Object System.Drawing.Size(406, 26)
$txtApiKey.BackColor = $cardColor
$txtApiKey.ForeColor = [System.Drawing.Color]::White
$txtApiKey.BorderStyle = "FixedSingle"
$txtApiKey.Enabled = $false
$grpModel.Controls.Add($txtApiKey)

$rbSkip = New-Object System.Windows.Forms.RadioButton
$rbSkip.Text = "Пропустить этот шаг (выбрать или скачать модель позже в веб-интерфейсе)"
$rbSkip.ForeColor = [System.Drawing.Color]::White
$rbSkip.Location = New-Object System.Drawing.Point(16, 218)
$rbSkip.Size = New-Object System.Drawing.Size(580, 24)
$grpModel.Controls.Add($rbSkip)

$chkShortcut = New-Object System.Windows.Forms.CheckBox
$chkShortcut.Text = "Создать ярлык «LAIChat» на Рабочем столе и включить доступ по LAN"
$chkShortcut.ForeColor = $mutedColor
$chkShortcut.Checked = $true
$chkShortcut.Location = New-Object System.Drawing.Point(16, 252)
$chkShortcut.Size = New-Object System.Drawing.Size(580, 24)
$grpModel.Controls.Add($chkShortcut)

$updateControls = {
  $cmbLocalModel.Enabled = $rbLocal.Checked
  $cmbCloud.Enabled = $rbCloud.Checked
  $txtApiKey.Enabled = $rbCloud.Checked
}
$rbLocal.Add_CheckedChanged($updateControls)
$rbCloud.Add_CheckedChanged($updateControls)
$rbSkip.Add_CheckedChanged($updateControls)

# Лог и прогресс-бар
$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Text = "Готов к установке в выбранную папку."
$lblStatus.ForeColor = $mutedColor
$lblStatus.Location = New-Object System.Drawing.Point(24, 468)
$lblStatus.Size = New-Object System.Drawing.Size(616, 22)
$form.Controls.Add($lblStatus)

$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Location = New-Object System.Drawing.Point(24, 494)
$progress.Size = New-Object System.Drawing.Size(616, 20)
$progress.Minimum = 0
$progress.Maximum = 100
$form.Controls.Add($progress)

$btnInstall = New-Object System.Windows.Forms.Button
$btnInstall.Text = "Установить LAIChat"
$btnInstall.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$btnInstall.Location = New-Object System.Drawing.Point(430, 528)
$btnInstall.Size = New-Object System.Drawing.Size(210, 38)
$btnInstall.FlatStyle = "Flat"
$btnInstall.BackColor = $accentColor
$btnInstall.ForeColor = [System.Drawing.Color]::FromArgb(10, 10, 15)
$form.Controls.Add($btnInstall)

$btnCancel = New-Object System.Windows.Forms.Button
$btnCancel.Text = "Выход"
$btnCancel.Location = New-Object System.Drawing.Point(310, 528)
$btnCancel.Size = New-Object System.Drawing.Size(108, 38)
$btnCancel.FlatStyle = "Flat"
$btnCancel.BackColor = $cardColor
$btnCancel.ForeColor = [System.Drawing.Color]::White
$btnCancel.Add_Click({ $form.Close() })
$form.Controls.Add($btnCancel)

$modelCatalog = @(
  @{ Name = "qwen2.5-1.5b-instruct-q4_k_m"; File = "qwen2.5-1.5b-instruct-q4_k_m.gguf"; Url = "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf" },
  @{ Name = "Llama-3.2-3B-Instruct-Q4_K_M"; File = "Llama-3.2-3B-Instruct-Q4_K_M.gguf"; Url = "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf" },
  @{ Name = "qwen2.5-3b-instruct-q4_k_m";   File = "qwen2.5-3b-instruct-q4_k_m.gguf";   Url = "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf" },
  @{ Name = "Qwen2.5-7B-Instruct-Q4_K_M";   File = "Qwen2.5-7B-Instruct-Q4_K_M.gguf";   Url = "https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf" },
  @{ Name = "qwen2.5-coder-7b-instruct-q4_k_m"; File = "qwen2.5-coder-7b-instruct-q4_k_m.gguf"; Url = "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf" },
  @{ Name = "Meta-Llama-3.1-8B-Instruct-Q4_K_M"; File = "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf"; Url = "https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf" }
)

$btnInstall.Add_Click({
  $targetDir = $txtPath.Text.Trim()
  if ([string]::IsNullOrWhiteSpace($targetDir)) {
    [System.Windows.Forms.MessageBox]::Show("Укажите папку для установки!", "Ошибка", "OK", "Warning")
    return
  }

  $btnInstall.Enabled = $false
  $grpPath.Enabled = $false
  $grpModel.Enabled = $false

  try {
    $lblStatus.Text = "Создание папок в $targetDir ..."
    $progress.Value = 10
    [System.Windows.Forms.Application]::DoEvents()

    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $targetDir "models") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $targetDir "bases") | Out-Null

    # Если запуск из локального клона репозитория — копируем файлы, иначе клонируем с GitHub
    $sourceRoot = Split-Path -Parent $PSCommandPath
    if (-not $sourceRoot) { $sourceRoot = (Get-Location).Path }
    if (Test-Path (Join-Path (Split-Path -Parent $sourceRoot) "server.ts")) {
      $sourceRoot = Split-Path -Parent $sourceRoot
    }

    if ((Test-Path (Join-Path $sourceRoot "server.ts")) -and ($sourceRoot -ne $targetDir)) {
      $lblStatus.Text = "Копирование файлов проекта LAIChat..."
      $progress.Value = 25
      [System.Windows.Forms.Application]::DoEvents()

      Get-ChildItem -Path $sourceRoot -Exclude "node_modules",".git","dist" | ForEach-Object {
        Copy-Item -Path $_.FullName -Destination $targetDir -Recurse -Force
      }
    } elseif (-not (Test-Path (Join-Path $targetDir "server.ts"))) {
      $lblStatus.Text = "Загрузка проекта из GitHub (SwargHUB/LAIChat)..."
      $progress.Value = 25
      [System.Windows.Forms.Application]::DoEvents()

      $zipUrl = "https://github.com/SwargHUB/LAIChat/archive/refs/heads/main.zip"
      $zipFile = Join-Path $env:TEMP "LAIChat-main.zip"
      Invoke-WebRequest -Uri $zipUrl -OutFile $zipFile -UseBasicParsing
      Expand-Archive -Path $zipFile -DestinationPath $env:TEMP -Force
      Copy-Item -Path (Join-Path $env:TEMP "LAIChat-main\*") -Destination $targetDir -Recurse -Force
      Remove-Item $zipFile -Force -ErrorAction SilentlyContinue
    }

    # Настройка settings.json в зависимости от выбора пользователя
    $settingsObj = @{
      context_size = 16384
      threads = [Environment]::ProcessorCount
      max_tokens = 2048
      temperature = 0.7
      top_p = 0.9
      backend_provider = "llama_cpp"
      llama_server_url = "http://127.0.0.1:8080"
      openai_base_url = "https://api.deepseek.com/v1"
      openai_api_key = ""
      model_name = "local"
      request_timeout = 300
      parallel_analysis = $true
      lan_access = $true
    }

    if ($rbLocal.Checked) {
      $selectedModel = $modelCatalog[$cmbLocalModel.SelectedIndex]
      $settingsObj.backend_provider = "llama_cpp"
      $settingsObj.model_name = $selectedModel.Name
      $destModelFile = Join-Path (Join-Path $targetDir "models") $selectedModel.File

      if (-not (Test-Path $destModelFile)) {
        $lblStatus.Text = "Скачивание модели $($selectedModel.File) с Hugging Face..."
        $progress.Value = 45
        [System.Windows.Forms.Application]::DoEvents()

        $wc = New-Object System.Net.WebClient
        $wc.DownloadFile($selectedModel.Url, $destModelFile)
      }
    } elseif ($rbCloud.Checked) {
      $idx = $cmbCloud.SelectedIndex
      $apiKey = $txtApiKey.Text.Trim()
      if ($idx -eq 0) {
        $settingsObj.backend_provider = "gemini"
        $settingsObj.model_name = "gemini-3.5-flash"
        if ($apiKey) {
          Set-Content -Path (Join-Path $targetDir ".env") -Value "GEMINI_API_KEY=$apiKey" -Encoding UTF8
        }
      } elseif ($idx -eq 1) {
        $settingsObj.backend_provider = "openai_compatible"
        $settingsObj.openai_base_url = "https://api.deepseek.com/v1"
        $settingsObj.model_name = "deepseek-chat"
        $settingsObj.openai_api_key = $apiKey
      } elseif ($idx -eq 2) {
        $settingsObj.backend_provider = "openai_compatible"
        $settingsObj.openai_base_url = "https://openrouter.ai/api/v1"
        $settingsObj.model_name = "deepseek/deepseek-chat"
        $settingsObj.openai_api_key = $apiKey
      } elseif ($idx -eq 3) {
        $settingsObj.backend_provider = "openai_compatible"
        $settingsObj.openai_base_url = "https://api.groq.com/openai/v1"
        $settingsObj.model_name = "llama-3.3-70b-versatile"
        $settingsObj.openai_api_key = $apiKey
      } elseif ($idx -eq 4) {
        $settingsObj.backend_provider = "openai_compatible"
        $settingsObj.openai_base_url = "https://api.openai.com/v1"
        $settingsObj.model_name = "gpt-4o-mini"
        $settingsObj.openai_api_key = $apiKey
      }
    }

    $settingsJson = $settingsObj | ConvertTo-Json -Depth 5
    Set-Content -Path (Join-Path $targetDir "settings.json") -Value $settingsJson -Encoding UTF8

    # Создание скрипта запуска start-laichat.bat
    $launcherContent = @"
@echo off
chcp 65001 >nul
cd /d "%~dp0"
title LAIChat Server (Port 3000)
echo Запуск LAIChat на http://localhost:3000 ...
start "" "http://localhost:3000"
call npm run dev
pause
"@
    $launcherPath = Join-Path $targetDir "start-laichat.bat"
    Set-Content -Path $launcherPath -Value $launcherContent -Encoding UTF8

    # Установка npm-зависимостей, если установлен Node.js
    if (Get-Command npm -ErrorAction SilentlyContinue) {
      $lblStatus.Text = "Установка зависимостей (npm install)..."
      $progress.Value = 80
      [System.Windows.Forms.Application]::DoEvents()
      Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm install" -WorkingDirectory $targetDir -Wait -WindowStyle Hidden
    }

    # Создание ярлыка на Рабочем столе
    if ($chkShortcut.Checked) {
      $desktop = [Environment]::GetFolderPath("Desktop")
      $shortcutPath = Join-Path $desktop "LAIChat.lnk"
      $wsh = New-Object -ComObject WScript.Shell
      $sc = $wsh.CreateShortcut($shortcutPath)
      $sc.TargetPath = $launcherPath
      $sc.WorkingDirectory = $targetDir
      $sc.Description = "Локальный AI-чат LAIChat"
      $sc.Save()
    }

    $progress.Value = 100
    $lblStatus.Text = "Установка успешно завершена! Папка: $targetDir"
    $lblStatus.ForeColor = $greenColor

    $res = [System.Windows.Forms.MessageBox]::Show(
      "LAIChat успешно установлен в папку:`n$targetDir`n`nЗапустить LAIChat сейчас?",
      "Установка завершена",
      "YesNo",
      "Information"
    )
    if ($res -eq "Yes") {
      Start-Process -FilePath $launcherPath -WorkingDirectory $targetDir
    }
    $form.Close()
  } catch {
    $lblStatus.Text = "Ошибка: $($_.Exception.Message)"
    [System.Windows.Forms.MessageBox]::Show("Ошибка при установке:`n$($_.Exception.Message)", "Ошибка", "OK", "Error")
    $btnInstall.Enabled = $true
    $grpPath.Enabled = $true
    $grpModel.Enabled = $true
  }
})

[void]$form.ShowDialog()
