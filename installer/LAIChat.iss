; ============================================================
;  LAIChat — установщик (Inno Setup 6)
; ============================================================
#define MyAppName "LAIChat"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Gennadiy Pavlov"
#define MyAppURL "https://github.com/SwargHUB/LAIChat"
#define MyAppExeName "LAIChat.cmd"

[Setup]
AppId={{7C3E9A21-5D48-4F2B-9C6A-1B8D4E7F3A52}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
VersionInfoVersion={#MyAppVersion}
VersionInfoDescription={#MyAppName} — локальный AI-чат с базами знаний
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
LicenseFile=LICENSE
OutputDir=release
OutputBaseFilename=LAIChat-Setup-{#MyAppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupLogging=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

[Languages]
Name: "russian"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
russian.WelcomeLabel1=Установка {#MyAppName}
russian.WelcomeLabel2=Локальный AI-чат с базами знаний в Markdown.%(nl)Работает полностью на вашем компьютере — ни один запрос не уходит в сеть.
russian.SelectDirLabel3=Установка LAIChat
russian.FinishedHeadingLabel=Установка завершена
russian.FinishedLabel=LAIChat установлен.
russian.ReadmeLabel=Дополнительная информация
russian.ClickFinish=Нажмите «Готово», чтобы закрыть мастер.
russian.LaunchApp=Запустить LAIChat
russian.LaunchAppDesc=Открыть браузер с интерфейсом чата
russian.OpenModels=Открыть папку моделей
russian.OpenModelsDesc=Папка, куда нужно положить файл .gguf

[Types]
Name: "full"; Description: "Полная установка (рекомендуется)"
Name: "custom"; Description: "Настраиваемая установка"; Flags: iscustom

[Components]
Name: "app"; Description: "LAIChat — приложение и веб-интерфейс"; Types: full custom; Flags: fixed
Name: "llama"; Description: "llama.cpp — сервер локальной модели (45 МБ)"; Types: full custom
Name: "bases"; Description: "Примеры баз знаний (Markdown)"; Types: full custom

[Tasks]
Name: "desktopicon"; Description: "Создать ярлык на рабочем столе"; GroupDescription: "Дополнительно:"
Name: "autostart"; Description: "Запускать LAIChat при старте Windows"; GroupDescription: "Дополнительно:"; Flags: unchecked

[Files]
Source: "payload\server.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "payload\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "payload\LAIChat.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "payload\node_modules\*"; DestDir: "{app}\node_modules"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "payload\dist\*"; DestDir: "{app}\dist"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "payload\node\node.exe"; DestDir: "{app}\node"; Flags: ignoreversion
Source: "payload\bin\*"; DestDir: "{app}\bin"; Components: llama; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "payload\bases\*"; DestDir: "{app}\bases"; Components: bases; Flags: recursesubdirs createallsubdirs ignoreversion

[Dirs]
Name: "{app}\models"

[Icons]
Name: "{group}\LAIChat"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{group}\Папка моделей"; Filename: "{app}\models"
Name: "{group}\Удалить LAIChat"; Filename: "{uninstallexe}"
Name: "{autodesktop}\LAIChat"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Registry]
Root: HKA; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "LAIChat"; ValueData: """{app}\{#MyAppExeName}"""; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchApp}"; Flags: nowait postinstall skipifsilent
Filename: "explorer.exe"; Parameters: "{app}\models"; Description: "{cm:OpenModels}"; Flags: nowait postinstall skipifsilent

[Code]
var
  ModelOptionPage: TInputOptionWizardPage;
  ModelFilePage: TInputFileWizardPage;

procedure InitializeWizard;
begin
  { Страница выбора: добавлять модель сейчас или позже }
  ModelOptionPage := CreateInputOptionPage(
    wpSelectComponents,
    'Модель',
    'Нужно ли добавить файл модели прямо сейчас?',
    'Модели GGUF весят 1–2 ГБ. Если её ещё нет — выберите «добавить позже»: файл можно положить в папку models после установки.',
    True,   { Exclusive — переключатели, а не флажки }
    False);

  ModelOptionPage.Add('Указать файл модели (.gguf) сейчас');
  ModelOptionPage.Add('Добавить модель позже — положу в папку models вручную');
  ModelOptionPage.Values[1] := True;  { по умолчанию — «позже» }

  { Страница выбора файла показывается только в первом варианте }
  ModelFilePage := CreateInputFilePage(
    ModelOptionPage.ID,
    'Модель',
    'Выберите файл модели .gguf на этом компьютере.',
    'Файл будет скопирован в папку models установленной программы.');

  ModelFilePage.Add(
    'Файл модели:',
    'Модели GGUF (*.gguf)|*.gguf|Все файлы (*.*)|*.*',
    '.gguf');
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if PageID = ModelFilePage.ID then
    Result := (ModelOptionPage.SelectedValueIndex <> 0);
end;

function StripExt(const S: String): String;
var
  I: Integer;
begin
  Result := S;
  for I := Length(S) downto 1 do
    if S[I] = '.' then
    begin
      Result := Copy(S, 1, I - 1);
      Break;
    end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ModelBaseName: String;
  Json: String;
  DestModel: String;
  ChosenModel: String;
begin
  if CurStep <> ssPostInstall then
    Exit;

  ModelBaseName := '';
  ChosenModel := '';

  { Модель копируем только если пользователь её выбрал }
  if (ModelOptionPage.SelectedValueIndex = 0) and (ModelFilePage.Values[0] <> '') then
  begin
    ChosenModel := ModelFilePage.Values[0];
    DestModel := ExpandConstant('{app}\models\') + ExtractFileName(ChosenModel);
    if FileExists(ChosenModel) then
    begin
      try
        CopyFile(ChosenModel, DestModel, True);
        ModelBaseName := StripExt(ExtractFileName(ChosenModel));
      except
        Log('Не удалось скопировать модель: ' + ChosenModel);
      end;
    end
    else
    begin
      Log('Файл модели не найден: ' + ChosenModel);
    end;
  end;

  Json := '{' + #13#10 +
    '  "context_size": 16384,' + #13#10 +
    '  "threads": 8,' + #13#10 +
    '  "max_tokens": 1024,' + #13#10 +
    '  "temperature": 0.7,' + #13#10 +
    '  "top_p": 0.9,' + #13#10 +
    '  "backend_provider": "llama_cpp",' + #13#10 +
    '  "llama_server_url": "http://127.0.0.1:8080",' + #13#10 +
    '  "openai_base_url": "https://api.openai.com/v1",' + #13#10 +
    '  "openai_api_key": "",' + #13#10;

  if ModelBaseName <> '' then
    Json := Json + '  "model_name": "' + ModelBaseName + '",' + #13#10;

  Json := Json +
    '  "request_timeout": 300,' + #13#10 +
    '  "parallel_analysis": true' + #13#10 +
    '}';

  SaveStringToFile(ExpandConstant('{app}\settings.json'), Json, False);
end;
