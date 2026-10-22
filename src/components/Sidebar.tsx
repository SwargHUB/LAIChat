import React, { useState } from 'react';
import { Base, Settings, ServerState } from '../types';
import {
  MessageSquare,
  Sliders,
  Database,
  RefreshCw,
  Trash2,
  Save,
  Plus,
  FileCode,
  FileText,
  Search,
  Server,
  Cpu,
  Zap,
  FileUp,
  Layers,
  Sparkles,
  Cloud,
  Key,
  Globe,
  CheckCircle,
  AlertCircle,
  Play,
} from 'lucide-react';
import { renderMarkdown } from '../utils/markdown';

interface SidebarProps {
  activeTab: 'chat' | 'settings' | 'bases';
  onTabChange: (tab: 'chat' | 'settings' | 'bases') => void;
  serverState: ServerState | null;
  settings: Settings;
  onSaveSettings: (newSettings: Settings) => Promise<void>;
  bases: Base[];
  selectedBase: Base | null;
  onSelectBase: (base: Base | null) => void;
  onSaveBase: (name: string, description: string, content: string) => Promise<void>;
  onDeleteBase: (name: string) => Promise<void>;
  onReloadBases: () => Promise<void>;
  onClearChat: () => Promise<void>;
  onRestartServer: () => Promise<void>;
  messageCount: number;
  onOpenConverter?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  serverState,
  settings,
  onSaveSettings,
  bases,
  selectedBase,
  onSelectBase,
  onSaveBase,
  onDeleteBase,
  onReloadBases,
  onClearChat,
  onRestartServer,
  messageCount,
  onOpenConverter,
}) => {
  // Settings local state
  const [localSettings, setLocalSettings] = useState<Settings>(settings);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Bases editor local state
  const [editorName, setEditorName] = useState('');
  const [editorDesc, setEditorDesc] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editorTab, setEditorTab] = useState<'write' | 'preview'>('write');
  const [isSavingBase, setIsSavingBase] = useState(false);
  const [isGeneratingDesc, setIsGeneratingDesc] = useState(false);

  const handleGenAIDescription = async () => {
    if (!editorContent.trim() && !editorName.trim()) return;
    setIsGeneratingDesc(true);
    try {
      const res = await fetch('/api/generate-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editorName,
          content: editorContent,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.description) {
          setEditorDesc(data.description);
        }
      }
    } catch (err) {
      console.warn('Gen AI description failed:', err);
    } finally {
      setIsGeneratingDesc(false);
    }
  };

  // Test connection state
  const [testConnStatus, setTestConnStatus] = useState<{
    loading: boolean;
    success?: boolean;
    message?: string;
  } | null>(null);

  const handleTestConnection = async () => {
    setTestConnStatus({ loading: true });
    try {
      const res = await fetch('/api/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backend_provider: localSettings.backend_provider,
          openai_base_url: localSettings.openai_base_url,
          openai_api_key: localSettings.openai_api_key,
          model_name: localSettings.model_name,
          llama_server_url: localSettings.llama_server_url,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setTestConnStatus({
          loading: false,
          success: true,
          message: data.message || 'Связь успешно установлена!',
        });
      } else {
        setTestConnStatus({
          loading: false,
          success: false,
          message: data.error || 'Ошибка проверки соединения',
        });
      }
    } catch (err: any) {
      setTestConnStatus({
        loading: false,
        success: false,
        message: err?.message || 'Сетевая ошибка при проверке',
      });
    }
  };

  // Sync editor with selectedBase
  React.useEffect(() => {
    if (selectedBase) {
      setEditorName(selectedBase.name);
      setEditorDesc(selectedBase.description || '');
      setEditorContent(selectedBase.content || '');
      setIsEditing(true);
    }
  }, [selectedBase]);

  // Sync local settings with props
  React.useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleStartNewBase = () => {
    onSelectBase(null);
    setEditorName('');
    setEditorDesc('');
    setEditorContent('# Заголовок базы\n\nОпишите ключевые факты и примеры кода здесь.');
    setIsEditing(true);
  };

  const handleSaveBaseSubmit = async () => {
    if (!editorName.trim()) return;
    setIsSavingBase(true);
    try {
      await onSaveBase(editorName.trim(), editorDesc.trim(), editorContent);
    } finally {
      setIsSavingBase(false);
    }
  };

  const filteredBases = bases.filter(
    (b) =>
      b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (b.description || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <aside className="glass rounded-3xl p-5 w-full flex flex-col gap-4 max-h-[820px] overflow-y-auto">
      {/* 3 Main Tabs */}
      <div className="flex bg-black/40 border border-[var(--border)] rounded-2xl p-1 gap-1">
        <button
          onClick={() => onTabChange('chat')}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeTab === 'chat'
              ? 'bg-[var(--prism-soft)] text-white shadow-inner border border-[var(--accent)]/30'
              : 'text-[var(--muted)] hover:text-white'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Чат</span>
        </button>
        <button
          onClick={() => onTabChange('settings')}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeTab === 'settings'
              ? 'bg-[var(--prism-soft)] text-white shadow-inner border border-[var(--accent)]/30'
              : 'text-[var(--muted)] hover:text-white'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Настройки</span>
        </button>
        <button
          onClick={() => onTabChange('bases')}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeTab === 'bases'
              ? 'bg-[var(--prism-soft)] text-white shadow-inner border border-[var(--accent)]/30'
              : 'text-[var(--muted)] hover:text-white'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>Базы ({bases.length})</span>
        </button>
      </div>

      {/* TAB: CHAT */}
      {activeTab === 'chat' && (
        <div className="space-y-4 anim-fade-up">
          {/* Status Card */}
          <div className="p-4 rounded-2xl bg-black/30 border border-[var(--border)] space-y-2.5">
            <div className="flex justify-between items-center text-xs pb-2 border-b border-dashed border-white/10">
              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
                Модель
              </span>
              <span className="font-mono text-white text-xs truncate max-w-[150px]">
                {localSettings.model_name || 'gemini-3.5-flash'}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs pb-2 border-b border-dashed border-white/10">
              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
                Сервер
              </span>
              <span className="font-mono text-[var(--cyan)] text-xs truncate max-w-[150px]">
                {serverState?.server_url || 'Cloud AI API'}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs pb-2 border-b border-dashed border-white/10">
              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
                Статус
              </span>
              <span className="badge ok text-xs">готов к работе</span>
            </div>
            <div className="flex justify-between items-center text-xs pb-2 border-b border-dashed border-white/10">
              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
                Баз в индексе
              </span>
              <span className="font-mono text-white">{bases.length}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
                Сообщений
              </span>
              <span className="font-mono text-[var(--accent)] font-semibold">{messageCount}</span>
            </div>
          </div>

          {/* Session selection */}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] mb-2">
              Диалог
            </div>
            <div className="p-3 rounded-2xl bg-[var(--prism-soft)] border border-[var(--accent)]/30 text-xs font-medium text-white flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
                Текущий сеанс
              </span>
              <span className="font-mono text-[11px] text-[var(--muted)]">{messageCount} реплик</span>
            </div>
            <button
              onClick={onClearChat}
              className="mt-2.5 w-full btn btn-sm border-dashed border-white/20 text-xs text-[var(--muted)] hover:text-white"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Очистить и начать новый диалог</span>
            </button>
          </div>

          {/* Side Actions */}
          <div className="pt-2 border-t border-[var(--border)] space-y-2">
            <button
              onClick={onReloadBases}
              className="w-full btn btn-sm !py-2 text-xs flex items-center justify-center gap-2 hover:border-[var(--cyan)] hover:text-[var(--cyan)]"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Перечитать базы из папки bases/</span>
            </button>
            <button
              onClick={onRestartServer}
              className="w-full btn btn-sm !py-2 text-xs flex items-center justify-center gap-2 hover:border-[var(--amber)] hover:text-[var(--amber)]"
            >
              <Server className="w-3.5 h-3.5" />
              <span>Проверить соединение с LLM</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB: SETTINGS */}
      {activeTab === 'settings' && (
        <div className="space-y-4 anim-fade-up">
          {/* Provider selector */}
          <div className="p-3.5 rounded-2xl bg-black/30 border border-[var(--border)] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-[var(--accent)]" />
                Провайдер AI
              </span>
              <span className="text-[10px] font-mono text-[var(--cyan)]">
                {localSettings.backend_provider === 'gemini'
                  ? 'Gemini'
                  : localSettings.backend_provider === 'openai_compatible'
                  ? 'OpenAI API'
                  : 'Локальный'}
              </span>
            </div>

            {/* 3 Provider Options */}
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setLocalSettings({
                    ...localSettings,
                    backend_provider: 'gemini',
                    model_name: 'gemini-3.5-flash',
                  })
                }
                className={`p-2 rounded-xl text-left border text-xs transition-all cursor-pointer ${
                  localSettings.backend_provider === 'gemini'
                    ? 'border-[var(--accent)] bg-[var(--prism-soft)] text-white font-medium'
                    : 'border-white/10 bg-black/20 text-[var(--muted)] hover:text-white'
                }`}
              >
                <div className="font-semibold text-white text-[11px]">Gemini</div>
                <div className="text-[9px] text-[var(--muted)] mt-0.5">Google Cloud</div>
              </button>

              <button
                type="button"
                onClick={() =>
                  setLocalSettings({
                    ...localSettings,
                    backend_provider: 'openai_compatible',
                    openai_base_url: localSettings.openai_base_url || 'https://api.deepseek.com/v1',
                    model_name: localSettings.model_name === 'gemini-3.5-flash' || !localSettings.model_name ? 'deepseek-chat' : localSettings.model_name,
                  })
                }
                className={`p-2 rounded-xl text-left border text-xs transition-all cursor-pointer ${
                  localSettings.backend_provider === 'openai_compatible'
                    ? 'border-[var(--cyan)] bg-[var(--prism-soft)] text-white font-medium shadow-[var(--glow-cyan)]'
                    : 'border-white/10 bg-black/20 text-[var(--muted)] hover:text-white'
                }`}
              >
                <div className="font-semibold text-white text-[11px] flex items-center gap-1">
                  <Cloud className="w-3 h-3 text-[var(--cyan)]" />
                  <span>OpenAI</span>
                </div>
                <div className="text-[9px] text-[var(--muted)] mt-0.5">DeepSeek, Groq...</div>
              </button>

              <button
                type="button"
                onClick={() =>
                  setLocalSettings({
                    ...localSettings,
                    backend_provider: 'llama_cpp',
                    llama_server_url: localSettings.llama_server_url || 'http://127.0.0.1:8080',
                    model_name: 'local-model',
                  })
                }
                className={`p-2 rounded-xl text-left border text-xs transition-all cursor-pointer ${
                  localSettings.backend_provider === 'llama_cpp' || localSettings.backend_provider === 'ollama'
                    ? 'border-[var(--accent)] bg-[var(--prism-soft)] text-white font-medium'
                    : 'border-white/10 bg-black/20 text-[var(--muted)] hover:text-white'
                }`}
              >
                <div className="font-semibold text-white text-[11px] flex items-center gap-1">
                  <Cpu className="w-3 h-3 text-[var(--violet)]" />
                  <span>Local</span>
                </div>
                <div className="text-[9px] text-[var(--muted)] mt-0.5">llama.cpp / Ollama</div>
              </button>
            </div>

            {/* Cloud OpenAI-Compatible Settings Block */}
            {localSettings.backend_provider === 'openai_compatible' && (
              <div className="pt-2.5 border-t border-white/10 space-y-2.5 anim-fade-up">
                {/* Provider Quick Presets */}
                <div>
                  <label className="text-[10px] font-mono uppercase text-[var(--muted)] block mb-1">
                    Быстрые пресеты провайдеров:
                  </label>
                  <div className="grid grid-cols-3 gap-1 text-[10px]">
                    <button
                      type="button"
                      onClick={() =>
                        setLocalSettings({
                          ...localSettings,
                          openai_base_url: 'https://api.deepseek.com/v1',
                          model_name: 'deepseek-chat',
                        })
                      }
                      className="px-2 py-1 rounded-lg bg-black/40 border border-white/10 hover:border-[var(--cyan)] text-white/90 hover:text-white transition-all text-center"
                    >
                      DeepSeek
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setLocalSettings({
                          ...localSettings,
                          openai_base_url: 'https://openrouter.ai/api/v1',
                          model_name: 'deepseek/deepseek-chat',
                        })
                      }
                      className="px-2 py-1 rounded-lg bg-black/40 border border-white/10 hover:border-[var(--cyan)] text-white/90 hover:text-white transition-all text-center"
                    >
                      OpenRouter
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setLocalSettings({
                          ...localSettings,
                          openai_base_url: 'https://api.groq.com/openai/v1',
                          model_name: 'llama-3.3-70b-versatile',
                        })
                      }
                      className="px-2 py-1 rounded-lg bg-black/40 border border-white/10 hover:border-[var(--cyan)] text-white/90 hover:text-white transition-all text-center"
                    >
                      Groq
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setLocalSettings({
                          ...localSettings,
                          openai_base_url: 'https://api.openai.com/v1',
                          model_name: 'gpt-4o-mini',
                        })
                      }
                      className="px-2 py-1 rounded-lg bg-black/40 border border-white/10 hover:border-[var(--cyan)] text-white/90 hover:text-white transition-all text-center"
                    >
                      OpenAI
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setLocalSettings({
                          ...localSettings,
                          openai_base_url: 'https://api.together.xyz/v1',
                          model_name: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
                        })
                      }
                      className="px-2 py-1 rounded-lg bg-black/40 border border-white/10 hover:border-[var(--cyan)] text-white/90 hover:text-white transition-all text-center"
                    >
                      Together AI
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setLocalSettings({
                          ...localSettings,
                          openai_base_url: 'http://127.0.0.1:11434/v1',
                          model_name: 'llama3.2',
                        })
                      }
                      className="px-2 py-1 rounded-lg bg-black/40 border border-white/10 hover:border-[var(--cyan)] text-white/90 hover:text-white transition-all text-center"
                    >
                      Ollama / vLLM
                    </button>
                  </div>
                </div>

                {/* Base URL */}
                <div>
                  <label className="text-[10px] font-mono uppercase text-[var(--muted)] flex items-center justify-between mb-1">
                    <span>Base URL (API Endpoint):</span>
                    <Globe className="w-3 h-3 text-[var(--cyan)]" />
                  </label>
                  <input
                    type="text"
                    value={localSettings.openai_base_url || ''}
                    onChange={(e) =>
                      setLocalSettings({ ...localSettings, openai_base_url: e.target.value })
                    }
                    placeholder="https://api.deepseek.com/v1"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[var(--cyan)]"
                  />
                </div>

                {/* Model Name */}
                <div>
                  <label className="text-[10px] font-mono uppercase text-[var(--muted)] block mb-1">
                    Имя модели (Model Name):
                  </label>
                  <input
                    type="text"
                    value={localSettings.model_name || ''}
                    onChange={(e) =>
                      setLocalSettings({ ...localSettings, model_name: e.target.value })
                    }
                    placeholder="deepseek-chat, gpt-4o-mini, llama-3.3-70b-versatile..."
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[var(--cyan)]"
                  />
                </div>

                {/* API Key */}
                <div>
                  <label className="text-[10px] font-mono uppercase text-[var(--muted)] flex items-center justify-between mb-1">
                    <span>API Ключ (Bearer Token):</span>
                    {serverState?.openai_key_configured && (
                      <span className="text-[9px] text-[var(--green)] flex items-center gap-1">
                        <CheckCircle className="w-2.5 h-2.5" /> Активен
                      </span>
                    )}
                  </label>
                  <div className="relative">
                    <Key className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                    <input
                      type="password"
                      value={localSettings.openai_api_key || ''}
                      onChange={(e) =>
                        setLocalSettings({ ...localSettings, openai_api_key: e.target.value })
                      }
                      placeholder={serverState?.openai_key_configured ? '•••••••• (Сохранён на сервере)' : 'sk-...'}
                      className="w-full bg-black/40 border border-white/10 rounded-xl pl-9 pr-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[var(--cyan)]"
                    />
                  </div>
                  <div className="text-[9px] text-[var(--muted)] mt-1">
                    Хранится безопасно на стороне сервера или в переменной OPENAI_API_KEY.
                  </div>
                </div>

                {/* Test Connection Button */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={testConnStatus?.loading}
                    className="w-full btn btn-sm !py-1.5 text-xs border-[var(--cyan)]/40 text-[var(--cyan)] hover:bg-[var(--cyan)]/10 flex items-center justify-center gap-1.5"
                  >
                    <Play className={`w-3.5 h-3.5 ${testConnStatus?.loading ? 'animate-spin' : ''}`} />
                    <span>{testConnStatus?.loading ? 'Проверка соединения…' : '⚡ Проверить подключение'}</span>
                  </button>

                  {testConnStatus?.message && (
                    <div
                      className={`mt-2 p-2 rounded-xl text-[10px] flex items-center gap-1.5 ${
                        testConnStatus.success
                          ? 'bg-[var(--green)]/15 border border-[var(--green)]/30 text-[var(--green)]'
                          : 'bg-[var(--rose)]/15 border border-[var(--rose)]/30 text-[var(--rose)]'
                      }`}
                    >
                      {testConnStatus.success ? (
                        <CheckCircle className="w-3 h-3 flex-none" />
                      ) : (
                        <AlertCircle className="w-3 h-3 flex-none" />
                      )}
                      <span className="truncate">{testConnStatus.message}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Local llama-server / Ollama Settings Block */}
            {(localSettings.backend_provider === 'llama_cpp' || localSettings.backend_provider === 'ollama') && (
              <div className="pt-2 border-t border-white/10 space-y-2.5 anim-fade-up">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setLocalSettings({
                        ...localSettings,
                        llama_server_url: 'http://127.0.0.1:8080',
                      })
                    }
                    className="flex-1 py-1 rounded-lg bg-black/40 border border-white/10 hover:border-white/20 text-[10px] text-white/80"
                  >
                    llama-server (8080)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setLocalSettings({
                        ...localSettings,
                        llama_server_url: 'http://127.0.0.1:11434',
                      })
                    }
                    className="flex-1 py-1 rounded-lg bg-black/40 border border-white/10 hover:border-white/20 text-[10px] text-white/80"
                  >
                    Ollama (11434)
                  </button>
                </div>

                <div>
                  <label className="text-[10px] font-mono text-[var(--muted)] block mb-1">
                    Адрес локального сервера:
                  </label>
                  <input
                    type="text"
                    value={localSettings.llama_server_url || ''}
                    onChange={(e) =>
                      setLocalSettings({ ...localSettings, llama_server_url: e.target.value })
                    }
                    placeholder="http://127.0.0.1:8080"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-mono text-[var(--muted)] block mb-1">
                    Имя модели:
                  </label>
                  <input
                    type="text"
                    value={localSettings.model_name || ''}
                    onChange={(e) =>
                      setLocalSettings({ ...localSettings, model_name: e.target.value })
                    }
                    placeholder="qwen2.5-coder, mistral, llama3.2..."
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testConnStatus?.loading}
                  className="w-full btn btn-sm !py-1 text-xs border-white/20 text-white/80 hover:text-white flex items-center justify-center gap-1.5"
                >
                  <Play className={`w-3.5 h-3.5 ${testConnStatus?.loading ? 'animate-spin' : ''}`} />
                  <span>{testConnStatus?.loading ? 'Проверка…' : '⚡ Проверить сервер'}</span>
                </button>

                {testConnStatus?.message && (
                  <div
                    className={`p-2 rounded-xl text-[10px] flex items-center gap-1.5 ${
                      testConnStatus.success
                        ? 'bg-[var(--green)]/15 border border-[var(--green)]/30 text-[var(--green)]'
                        : 'bg-[var(--rose)]/15 border border-[var(--rose)]/30 text-[var(--rose)]'
                    }`}
                  >
                    {testConnStatus.success ? (
                      <CheckCircle className="w-3 h-3 flex-none" />
                    ) : (
                      <AlertCircle className="w-3 h-3 flex-none" />
                    )}
                    <span className="truncate">{testConnStatus.message}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Context size */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs font-semibold">
              <span>Контекст</span>
              <span className="font-mono text-[var(--accent)]">{localSettings.context_size}</span>
            </div>
            <input
              type="range"
              min="512"
              max="16384"
              step="128"
              value={localSettings.context_size}
              style={{
                ['--val' as any]: `${((localSettings.context_size - 512) / (16384 - 512)) * 100}%`,
              }}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, context_size: parseInt(e.target.value, 10) })
              }
            />
            <small className="block text-[10px] text-[var(--muted)]">
              Сколько токенов модель помнит в диалоге.
            </small>
          </div>

          {/* Threads */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs font-semibold">
              <span>Потоки CPU</span>
              <span className="font-mono text-[var(--cyan)]">{localSettings.threads}</span>
            </div>
            <input
              type="range"
              min="1"
              max="32"
              step="1"
              value={localSettings.threads}
              style={{
                ['--val' as any]: `${((localSettings.threads - 1) / 31) * 100}%`,
              }}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, threads: parseInt(e.target.value, 10) })
              }
            />
            <small className="block text-[10px] text-[var(--muted)]">
              Число потоков для локального инференса.
            </small>
          </div>

          {/* Temperature */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs font-semibold">
              <span>Температура</span>
              <span className="font-mono text-[var(--violet)]">
                {localSettings.temperature.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={localSettings.temperature}
              style={{
                ['--val' as any]: `${(localSettings.temperature / 2) * 100}%`,
              }}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, temperature: parseFloat(e.target.value) })
              }
            />
            <small className="block text-[10px] text-[var(--muted)]">
              Выше — креативнее, ниже — точнее и строже по базам.
            </small>
          </div>

          {/* Max tokens */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs font-semibold">
              <span>Max tokens</span>
              <span className="font-mono text-[var(--accent)]">{localSettings.max_tokens}</span>
            </div>
            <input
              type="range"
              min="64"
              max="4096"
              step="32"
              value={localSettings.max_tokens}
              style={{
                ['--val' as any]: `${((localSettings.max_tokens - 64) / (4096 - 64)) * 100}%`,
              }}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, max_tokens: parseInt(e.target.value, 10) })
              }
            />
          </div>

          {/* Top-p */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs font-semibold">
              <span>Top-p</span>
              <span className="font-mono text-[var(--green)]">
                {localSettings.top_p.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={localSettings.top_p}
              style={{
                ['--val' as any]: `${localSettings.top_p * 100}%`,
              }}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, top_p: parseFloat(e.target.value) })
              }
            />
          </div>

          <button
            onClick={async () => {
              setIsSavingSettings(true);
              try {
                await onSaveSettings(localSettings);
              } finally {
                setIsSavingSettings(false);
              }
            }}
            disabled={isSavingSettings}
            className="w-full btn btn-primary mt-2"
          >
            <Save className="w-4 h-4" />
            <span>{isSavingSettings ? 'Сохранение…' : 'Сохранить настройки'}</span>
          </button>
        </div>
      )}

      {/* TAB: BASES */}
      {activeTab === 'bases' && (
        <div className="space-y-4 anim-fade-up">
          {/* Header & New Base CTA */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--muted)]">
              Файлы ({bases.length})
            </span>
            <div className="flex items-center gap-1.5">
              {onOpenConverter && (
                <button
                  onClick={onOpenConverter}
                  className="btn btn-sm !px-2.5 !py-1 text-xs text-[var(--accent)] border-[var(--accent)]/30 hover:border-[var(--accent)]"
                  title="Импорт DOCX / PDF и разбиение на части"
                >
                  <FileUp className="w-3.5 h-3.5" />
                  <span>Импорт DOCX/PDF</span>
                </button>
              )}
              <button
                onClick={handleStartNewBase}
                className="btn btn-sm !px-2.5 !py-1 text-xs text-[var(--cyan)] border-[var(--cyan)]/30 hover:border-[var(--cyan)]"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Создать</span>
              </button>
            </div>
          </div>

          {/* Search box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск по названию или описанию..."
              className="w-full bg-black/30 border border-white/10 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-[var(--muted)] focus:outline-none focus:border-[var(--cyan)] font-sans"
            />
          </div>

          {/* Bases List */}
          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {filteredBases.map((b, idx) => {
              const isSelected = selectedBase?.name.toLowerCase() === b.name.toLowerCase();
              const colors = [
                'bg-[var(--cyan)]/15 text-[var(--cyan)]',
                'bg-[var(--violet)]/15 text-[var(--violet)]',
                'bg-[var(--accent)]/15 text-[var(--accent)]',
              ];
              const colorClass = colors[idx % colors.length];

              return (
                <div
                  key={b.name}
                  onClick={() => onSelectBase(b)}
                  className={`p-2.5 rounded-xl border flex items-center gap-2.5 cursor-pointer transition-all ${
                    isSelected
                      ? 'border-[var(--accent)] bg-[var(--prism-soft)] shadow-sm'
                      : 'border-white/5 bg-black/20 hover:border-white/20'
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-lg grid place-items-center font-mono font-bold text-[10px] flex-none ${colorClass}`}
                  >
                    MD
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs font-semibold text-white truncate">
                      {b.name}.md
                    </div>
                    <div className="text-[10px] text-[var(--muted)] truncate">
                      {b.description || 'Без описания'}
                    </div>
                  </div>
                </div>
              );
            })}

            {filteredBases.length === 0 && (
              <div className="p-4 text-center text-xs text-[var(--muted)]">Базы не найдены</div>
            )}
          </div>

          <button
            onClick={onReloadBases}
            className="w-full btn btn-sm border-[var(--cyan)]/30 text-[var(--cyan)] hover:bg-[var(--cyan)]/10 text-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>⟳ Перечитать все базы с диска</span>
          </button>

          {/* Knowledge Base Editor */}
          <div className="pt-3 border-t border-[var(--border)] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                <FileCode className="w-3.5 h-3.5 text-[var(--accent)]" />
                {selectedBase ? `Редактор: ${selectedBase.name}` : 'Новая база знаний'}
              </span>

              {isEditing && (
                <div className="flex bg-black/40 rounded-lg p-0.5 border border-white/10 text-[10px]">
                  <button
                    onClick={() => setEditorTab('write')}
                    className={`px-2 py-0.5 rounded cursor-pointer ${
                      editorTab === 'write' ? 'bg-white/10 text-white font-medium' : 'text-[var(--muted)]'
                    }`}
                  >
                    Правка
                  </button>
                  <button
                    onClick={() => setEditorTab('preview')}
                    className={`px-2 py-0.5 rounded cursor-pointer ${
                      editorTab === 'preview' ? 'bg-white/10 text-white font-medium' : 'text-[var(--muted)]'
                    }`}
                  >
                    Просмотр
                  </button>
                </div>
              )}
            </div>

            {isEditing ? (
              <div className="space-y-2.5">
                <div>
                  <label className="text-[10px] font-mono uppercase text-[var(--muted)] block mb-1">
                    Имя файла (без .md)
                  </label>
                  <input
                    type="text"
                    value={editorName}
                    disabled={Boolean(selectedBase)}
                    onChange={(e) => setEditorName(e.target.value)}
                    placeholder="go, python, sql..."
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[var(--accent)] disabled:opacity-60"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] font-mono uppercase text-[var(--muted)]">
                      Краткое описание (для классификатора тем)
                    </label>
                    <button
                      type="button"
                      onClick={handleGenAIDescription}
                      disabled={isGeneratingDesc || (!editorContent.trim() && !editorName.trim())}
                      className="px-2 py-0.5 rounded-lg bg-[var(--prism-soft)] border border-[var(--cyan)]/40 hover:border-[var(--cyan)] text-[10px] font-mono text-[var(--cyan)] flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                      title="Сгенерировать ёмкое описание для RAG-роутера с помощью Gen AI"
                    >
                      <Sparkles className={`w-3 h-3 ${isGeneratingDesc ? 'animate-spin' : ''}`} />
                      <span>{isGeneratingDesc ? 'Генерация…' : 'Gen AI'}</span>
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    value={editorDesc}
                    onChange={(e) => setEditorDesc(e.target.value)}
                    placeholder="Ключевые слова, темы и концепции..."
                    className="w-full bg-black/40 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-[var(--accent)] resize-none"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-mono uppercase text-[var(--muted)] block mb-1">
                    Содержимое базы (Markdown)
                  </label>

                  {editorTab === 'write' ? (
                    <textarea
                      rows={9}
                      value={editorContent}
                      onChange={(e) => setEditorContent(e.target.value)}
                      placeholder="# Заголовок\n\nФакты, документация, примеры кода..."
                      className="w-full bg-black/40 border border-white/10 rounded-xl p-2.5 text-xs font-mono text-white focus:outline-none focus:border-[var(--accent)] resize-y leading-relaxed"
                    />
                  ) : (
                    <div
                      className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-white max-h-56 overflow-y-auto markdown-body"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(editorContent) }}
                    />
                  )}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={handleSaveBaseSubmit}
                    disabled={isSavingBase || !editorName.trim()}
                    className="btn btn-primary btn-sm flex-1 text-xs"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{isSavingBase ? 'Сохранение…' : '💾 Сохранить'}</span>
                  </button>

                  {selectedBase && (
                    <button
                      onClick={() => onDeleteBase(selectedBase.name)}
                      className="btn btn-sm !px-3 text-xs text-[var(--rose)] border-[var(--rose)]/30 hover:bg-[var(--rose)]/15"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Удалить</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-[var(--muted)] border border-dashed border-white/10 rounded-2xl space-y-2">
                <FileText className="w-8 h-8 mx-auto text-[var(--muted)]/50" />
                <p>Выберите базу из списка выше для редактирования</p>
                <button
                  onClick={handleStartNewBase}
                  className="btn btn-sm border-white/20 text-white"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Создать новую базу</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
