; =====================================================================
; Скрипт сборки классического установщика LAIChat-Setup.exe (Inno Setup 6)
; Позволяет выбрать папку установки (по умолчанию %USERPROFILE%\LAIChat)
; и настроить модель: скачать локальную GGUF, выбрать облачную или пропустить шаг.
; =====================================================================

#define MyAppName "LAIChat"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "SwargHUB"
#define MyAppURL "https://github.com/SwargHUB/LAIChat"

[Setup]
AppId={{8F9E4A21-5B1E-4D7A-9C3D-2A8B6E4F1092}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
; По умолчанию пользовательская папка (без прав администратора)
DefaultDirName={userpf}\{#MyAppName}
DisableDirPage=no
DefaultGroupName={#MyAppName}
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=dist-installer
OutputBaseFilename=LAIChat-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Dirs]
Name: "{app}\models"
Name: "{app}\bases"

[Files]
Source: "..\*"; DestDir: "{app}"; Excludes: "node_modules,.git,dist,dist-installer"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\installer\setup-windows.bat"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\start-laichat.bat"; Tasks: desktopicon

[Code]
var
  ModelPage: TInputOptionWizardPage;
  LocalModelPage: TInputOptionWizardPage;
  CloudModelPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  ModelPage := CreateInputOptionPage(wpSelectDir,
    'Настройка AI-модели (необязательно)',
    'Выберите способ подключения модели или пропустите этот шаг',
    'Вы можете сразу скачать рекомендуемую локальную модель GGUF в папку models/, ' +
    'настроить облачный провайдер или пропустить этот шаг и выбрать модель позже в веб-интерфейсе.',
    True, False);
  ModelPage.Add('Скачать локальную модель GGUF с Hugging Face (рекомендуется)');
  ModelPage.Add('Выбрать облачную модель (Google Gemini / DeepSeek / OpenAI / Groq)');
  ModelPage.Add('Пропустить этот шаг (настроить позже в приложении)');
  ModelPage.SelectedValueIndex := 0;

  LocalModelPage := CreateInputOptionPage(ModelPage.ID,
    'Выбор локальной модели (Hugging Face GGUF)',
    'Какую модель скачать в папку models/?',
    'Модель будет автоматически загружена в папку установки models\:',
    True, False);
  LocalModelPage.Add('Qwen 2.5 1.5B Instruct (Q4_K_M, ~1.1 ГБ) — Для слабых ПК (от 4 ГБ ОЗУ)');
  LocalModelPage.Add('Llama 3.2 3B Instruct (Q4_K_M, ~2.0 ГБ) — Сбалансированная (от 6 ГБ ОЗУ)');
  LocalModelPage.Add('Qwen 2.5 7B Instruct (Q4_K_M, ~4.7 ГБ) — Оптимальная для RAG (от 8 ГБ ОЗУ)');
  LocalModelPage.Add('Qwen 2.5 Coder 7B Instruct (Q4_K_M, ~4.7 ГБ) — Для кода и документации');
  LocalModelPage.SelectedValueIndex := 2;

  CloudModelPage := CreateInputQueryPage(ModelPage.ID,
    'Настройка облачной модели',
    'Укажите провайдера и API-ключ (можно оставить пустым)',
    'Доступные провайдеры: gemini, openai_compatible (DeepSeek, OpenRouter, Groq, OpenAI):');
  CloudModelPage.Add('Провайдер (gemini или openai_compatible):', False);
  CloudModelPage.Add('Base URL (для DeepSeek/OpenAI):', False);
  CloudModelPage.Add('Имя модели:', False);
  CloudModelPage.Add('API Ключ (необязательно):', True);
  CloudModelPage.Values[0] := 'openai_compatible';
  CloudModelPage.Values[1] := 'https://api.deepseek.com/v1';
  CloudModelPage.Values[2] := 'deepseek-chat';
  CloudModelPage.Values[3] := '';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if (PageID = LocalModelPage.ID) and (ModelPage.SelectedValueIndex <> 0) then
    Result := True;
  if (PageID = CloudModelPage.ID) and (ModelPage.SelectedValueIndex <> 1) then
    Result := True;
end;
