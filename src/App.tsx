/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Base, Settings, ServerState, ChatMessage, ToastMessage } from './types';
import { HeaderHero } from './components/HeaderHero';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { ToastContainer } from './components/Toast';
import { DocumentConverterModal } from './components/DocumentConverterModal';
import { ArrowLeft, Sparkles, ExternalLink } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'chat' | 'settings' | 'bases'>('chat');
  const [serverState, setServerState] = useState<ServerState | null>(null);
  const [isConverterOpen, setIsConverterOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    context_size: 4096,
    threads: 8,
    max_tokens: 1024,
    temperature: 0.7,
    top_p: 0.9,
    backend_provider: 'gemini',
    llama_server_url: 'http://127.0.0.1:8080',
    model_name: 'gemini-3.5-flash',
  });
  const [bases, setBases] = useState<Base[]>([]);
  const [selectedBase, setSelectedBase] = useState<Base | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Route detection: check if URL is /chat, /chat/ or ?mode=chat / ?view=chat
  const checkIsChatOnly = (): boolean => {
    if (typeof window === 'undefined') return false;
    const path = window.location.pathname.toLowerCase().replace(/\/$/, '');
    const search = window.location.search.toLowerCase();
    return (
      path === '/chat' ||
      path.endsWith('/chat') ||
      search.includes('mode=chat') ||
      search.includes('view=chat')
    );
  };

  const [isChatOnlyMode, setIsChatOnlyMode] = useState<boolean>(checkIsChatOnly);

  useEffect(() => {
    const handleLocationChange = () => {
      setIsChatOnlyMode(checkIsChatOnly());
    };

    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  const toggleViewMode = (chatOnly: boolean) => {
    if (chatOnly) {
      window.history.pushState({}, '', '/chat');
      setIsChatOnlyMode(true);
    } else {
      window.history.pushState({}, '', '/');
      setIsChatOnlyMode(false);
    }
  };

  const chatSectionRef = useRef<HTMLDivElement>(null);

  const addToast = (text: string, type: 'ok' | 'err' | 'info' = 'ok') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3800);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Fetch initial server state & bases
  const refreshState = async () => {
    try {
      const res = await fetch('/api/state');
      if (res.ok) {
        const data: ServerState = await res.json();
        setServerState(data);
        if (data.config) {
          setSettings(data.config);
        }
      }
    } catch (err) {
      console.warn('Could not reach /api/state yet:', err);
    }
  };

  const refreshBases = async () => {
    try {
      const res = await fetch('/api/bases');
      if (res.ok) {
        const data: Base[] = await res.json();
        setBases(data);
        if (selectedBase) {
          const match = data.find((b) => b.name.toLowerCase() === selectedBase.name.toLowerCase());
          if (match) {
            handleSelectBase(match);
          }
        }
      }
    } catch (err) {
      console.warn('Could not fetch bases:', err);
    }
  };

  useEffect(() => {
    refreshState();
    refreshBases();
  }, []);

  const handleSelectBase = async (base: Base | null) => {
    if (!base) {
      setSelectedBase(null);
      return;
    }
    try {
      const res = await fetch(`/api/bases/${encodeURIComponent(base.name)}`);
      if (res.ok) {
        const fullBase: Base = await res.json();
        setSelectedBase(fullBase);
      } else {
        setSelectedBase(base);
      }
    } catch {
      setSelectedBase(base);
    }
  };

  const handleSendMessage = async (text: string) => {
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Ошибка сервера: ${res.status}`);
      }

      const data = await res.json();
      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.response,
        source: data.source,
        analyses: data.analyses,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      refreshState();
    } catch (err: any) {
      addToast(err?.message || 'Не удалось отправить сообщение', 'err');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveSettings = async (newSettings: Settings) => {
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Ошибка сохранения настроек');
      }

      setSettings(newSettings);
      refreshState();
      addToast('✓ Настройки успешно сохранены', 'ok');
    } catch (err: any) {
      addToast(err.message || 'Ошибка сохранения настроек', 'err');
    }
  };

  const handleReloadBases = async () => {
    try {
      const res = await fetch('/api/reload', { method: 'POST' });
      if (!res.ok) throw new Error('Ошибка обновления баз');
      const data = await res.json();
      await refreshBases();
      refreshState();
      addToast(`✓ Перечитано баз: ${data.count ?? bases.length}`, 'ok');
    } catch (err: any) {
      addToast(err.message || 'Ошибка обновления баз', 'err');
    }
  };

  const handleRestartServer = async () => {
    try {
      const res = await fetch('/api/restart', { method: 'POST' });
      if (!res.ok) throw new Error('Ошибка связи с сервером');
      refreshState();
      addToast('✓ Соединение с сервером проверено (активно)', 'ok');
    } catch (err: any) {
      addToast(err.message || 'Ошибка проверки соединения', 'err');
    }
  };

  const handleClearChat = async () => {
    try {
      const res = await fetch('/api/clear', { method: 'POST' });
      if (!res.ok) throw new Error('Ошибка очистки');
      setMessages([]);
      refreshState();
      addToast('✓ История диалога очищена', 'info');
    } catch (err: any) {
      addToast(err.message || 'Ошибка очистки истории', 'err');
    }
  };

  const handleSaveBase = async (name: string, description: string, content: string) => {
    const isNew = !bases.some((b) => b.name.toLowerCase() === name.toLowerCase());
    const method = isNew ? 'POST' : 'PUT';
    const endpoint = isNew ? '/api/bases' : `/api/bases/${encodeURIComponent(name)}`;

    try {
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, content }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Ошибка при сохранении базы');
      }

      await refreshBases();
      refreshState();
      const updated = { name, description, content };
      setSelectedBase(updated);
      addToast(`✓ База «${name}» успешно сохранена`, 'ok');
    } catch (err: any) {
      addToast(err.message || 'Ошибка сохранения базы', 'err');
    }
  };

  const handleDeleteBase = async (name: string) => {
    if (!confirm(`Вы действительно хотите удалить базу «${name}.md»?`)) return;

    try {
      const res = await fetch(`/api/bases/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Ошибка удаления базы');
      }

      setSelectedBase(null);
      await refreshBases();
      refreshState();
      addToast(`✓ База «${name}» удалена`, 'info');
    } catch (err: any) {
      addToast(err.message || 'Ошибка удаления базы', 'err');
    }
  };

  const scrollToChat = () => {
    if (chatSectionRef.current) {
      chatSectionRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // STANDALONE /chat MODE: Only chat, without settings, hero or footers
  if (isChatOnlyMode) {
    return (
      <div className="min-h-screen h-screen flex flex-col bg-[#0a0a0f] text-[#f4f4f6] overflow-hidden">
        {/* Minimal Standalone Header */}
        <header className="flex-none flex items-center justify-between px-5 py-3 bg-[#0a0a0f]/90 backdrop-blur-xl border-b border-[var(--border)] z-30">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[var(--prism)] grid place-items-center text-[#0a0a0f] font-mono font-bold text-sm shadow-[var(--glow-pink)]">
              L
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base tracking-tight text-white">LAIChat</span>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-[var(--prism-soft)] text-[var(--cyan)] border border-[var(--cyan)]/30">
                /chat
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center gap-2 text-xs font-mono text-[var(--muted)] px-3 py-1 rounded-full bg-white/5 border border-white/5">
              <span className="w-2 h-2 rounded-full bg-[var(--green)] anim-pulse-dot" />
              <span>{settings.model_name || 'gemini-3.5-flash'}</span>
              <span className="text-white/20">|</span>
              <span>{bases.length} баз знаний</span>
            </span>

            <button
              onClick={() => toggleViewMode(false)}
              className="btn btn-sm !px-3 !py-1.5 text-xs flex items-center gap-1.5 border-white/15 text-[var(--muted)] hover:text-white"
              title="Перейти к полной панели управления, настройкам и редактированию баз"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Панель управления (/)</span>
            </button>
          </div>
        </header>

        {/* Clean Standalone Chat Screen */}
        <main className="flex-1 max-w-5xl w-full mx-auto p-3 sm:p-5 flex flex-col min-h-0">
          <ChatArea
            messages={messages}
            isLoading={isLoading}
            onSendMessage={handleSendMessage}
            onClearChat={handleClearChat}
            contextSize={settings.context_size}
            isStandalone={true}
          />
        </main>

        <ToastContainer toasts={toasts} onDismiss={removeToast} />
      </div>
    );
  }

  // STANDARD FULL WORKSPACE VIEW (with Hero, Sidebar, Settings, Bases Editor)
  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0f] text-[#f4f4f6]">
      {/* Hero Header */}
      <HeaderHero
        serverState={serverState}
        onNavigateTab={(tab) => {
          setActiveTab(tab);
          scrollToChat();
        }}
        onScrollToChat={scrollToChat}
        onOpenChatOnly={() => toggleViewMode(true)}
      />

      {/* Main Workspace */}
      <main ref={chatSectionRef} className="max-w-6xl mx-auto px-6 pb-20 w-full flex-1">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Sidebar */}
          <div className="lg:col-span-4 sticky top-20">
            <Sidebar
              activeTab={activeTab}
              onTabChange={setActiveTab}
              serverState={serverState}
              settings={settings}
              onSaveSettings={handleSaveSettings}
              bases={bases}
              selectedBase={selectedBase}
              onSelectBase={handleSelectBase}
              onSaveBase={handleSaveBase}
              onDeleteBase={handleDeleteBase}
              onReloadBases={handleReloadBases}
              onClearChat={handleClearChat}
              onRestartServer={handleRestartServer}
              messageCount={messages.length}
              onOpenConverter={() => setIsConverterOpen(true)}
            />
          </div>

          {/* Main Chat Interface */}
          <div className="lg:col-span-8">
            <ChatArea
              messages={messages}
              isLoading={isLoading}
              onSendMessage={handleSendMessage}
              onClearChat={handleClearChat}
              contextSize={settings.context_size}
              isStandalone={false}
            />
          </div>
        </div>
      </main>

      {/* Document Converter & Chunking Modal */}
      <DocumentConverterModal
        isOpen={isConverterOpen}
        onClose={() => setIsConverterOpen(false)}
        onSuccess={() => {
          refreshBases();
          refreshState();
          addToast('✓ Базы знаний успешно импортированы', 'ok');
        }}
      />

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}
