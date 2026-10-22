import React from 'react';
import { ServerState } from '../types';
import { Sparkles, Terminal, BookOpen, Sliders, ExternalLink, ArrowDown, MessageSquare } from 'lucide-react';

interface HeaderHeroProps {
  serverState: ServerState | null;
  onNavigateTab: (tab: 'chat' | 'settings' | 'bases') => void;
  onScrollToChat: () => void;
  onOpenChatOnly?: () => void;
}

export const HeaderHero: React.FC<HeaderHeroProps> = ({
  serverState,
  onNavigateTab,
  onScrollToChat,
  onOpenChatOnly,
}) => {
  const basesCount = serverState?.bases_count ?? 3;
  const contextSize = serverState?.config?.context_size ?? 4096;
  const threads = serverState?.config?.threads ?? 8;
  const isHealthy = serverState?.is_healthy ?? true;

  return (
    <div>
      {/* Top Navigation */}
      <header className="sticky top-0 z-40 flex items-center justify-between px-6 py-3.5 bg-[#0a0a0f]/80 backdrop-blur-xl border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-[var(--prism)] grid place-items-center text-[#0a0a0f] font-mono font-bold text-sm shadow-[var(--glow-pink)]">
            L
          </div>
          <div>
            <span className="font-bold text-base tracking-tight text-white flex items-center gap-2">
              LAIChat
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-[var(--prism-soft)] text-[var(--cyan)] border border-[var(--cyan)]/30">
                v1.0
              </span>
            </span>
          </div>
        </div>

        <nav className="hidden md:flex items-center gap-1.5">
          <button
            onClick={() => {
              onNavigateTab('chat');
              onScrollToChat();
            }}
            className="px-3.5 py-1.5 rounded-full text-sm text-[var(--muted)] hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            Чат
          </button>
          <button
            onClick={() => {
              onNavigateTab('bases');
              onScrollToChat();
            }}
            className="px-3.5 py-1.5 rounded-full text-sm text-[var(--muted)] hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            Базы знаний
          </button>
          <button
            onClick={() => {
              onNavigateTab('settings');
              onScrollToChat();
            }}
            className="px-3.5 py-1.5 rounded-full text-sm text-[var(--muted)] hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            Настройки
          </button>
          {onOpenChatOnly && (
            <button
              onClick={onOpenChatOnly}
              className="px-3 py-1 rounded-full text-xs font-mono text-[var(--cyan)] bg-[var(--cyan)]/10 border border-[var(--cyan)]/30 hover:bg-[var(--cyan)]/20 transition-all cursor-pointer ml-1"
              title="Открыть чистый чат без настроек и шапки"
            >
              Только чат (/chat)
            </button>
          )}
        </nav>

        <div className="flex items-center gap-3">
          <a
            href="https://github.com/SwargHUB/LAIChat"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-sm !px-3 !py-1.5 text-xs text-[var(--muted)] hover:text-white flex items-center gap-1.5"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>SwargHUB/LAIChat</span>
          </a>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-12 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        <div className="lg:col-span-7">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[var(--prism-soft)] border border-[var(--border)] font-mono text-xs text-[var(--cyan)] mb-6">
            <span
              className={`w-2 h-2 rounded-full ${
                isHealthy ? 'bg-[var(--green)] anim-pulse-dot' : 'bg-[var(--rose)]'
              }`}
            />
            ЛОКАЛЬНЫЙ AI-ЧАТ · С БАЗАМИ ЗНАНИЙ И RAG
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-[1.15] text-white">
            Локальный AI-чат с{' '}
            <span className="bg-gradient-to-r from-[var(--cyan)] via-[var(--violet)] to-[var(--accent)] bg-clip-text text-transparent">
              параллельным анализом баз
            </span>
          </h1>

          <p className="mt-5 text-[var(--muted)] text-base sm:text-lg max-w-xl leading-relaxed">
            Архитектура с параллельным опросом независимых баз знаний в формате Markdown,
            быстрым классификатором тем и синтезом ответов с точными фактологическими ссылками.
          </p>

          <div className="mt-8 flex flex-wrap gap-3.5">
            <button
              onClick={() => {
                onNavigateTab('chat');
                onScrollToChat();
              }}
              className="btn btn-primary shadow-lg"
            >
              <Terminal className="w-4 h-4" />
              <span>Перейти к диалогу</span>
              <ArrowDown className="w-4 h-4 ml-1" />
            </button>
            <button
              onClick={() => {
                onNavigateTab('bases');
                onScrollToChat();
              }}
              className="btn btn-cyan"
            >
              <BookOpen className="w-4 h-4 text-[var(--cyan)]" />
              <span>Базы знаний ({basesCount})</span>
            </button>
            <button
              onClick={() => {
                onNavigateTab('settings');
                onScrollToChat();
              }}
              className="btn"
            >
              <Sliders className="w-4 h-4 text-[var(--violet)]" />
              <span>Параметры генерации</span>
            </button>
            {onOpenChatOnly && (
              <button
                onClick={onOpenChatOnly}
                className="btn border-[var(--cyan)]/30 text-[var(--cyan)] hover:bg-[var(--cyan)]/10"
              >
                <MessageSquare className="w-4 h-4" />
                <span>Только чат (/chat)</span>
              </button>
            )}
          </div>

          {/* Stats Bar */}
          <div className="mt-10 pt-6 border-t border-[var(--border)] grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                Базы знаний
              </span>
              <b className="block font-mono text-lg text-white mt-0.5">
                {basesCount} <em className="not-italic text-[var(--accent)]">.md</em>
              </b>
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                Контекст
              </span>
              <b className="block font-mono text-lg text-white mt-0.5">
                {contextSize} <span className="text-xs text-[var(--muted)]">tok</span>
              </b>
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                Потоки CPU
              </span>
              <b className="block font-mono text-lg text-white mt-0.5">{threads} threads</b>
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--muted)]">
                Статус
              </span>
              <b className="block font-mono text-lg text-[var(--green)] mt-0.5 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[var(--green)]" />
                Онлайн
              </b>
            </div>
          </div>
        </div>

        {/* Cyber Visual */}
        <div className="lg:col-span-5 relative flex items-center justify-center min-h-[340px]">
          {/* Glowing Ambient Blobs */}
          <div className="absolute w-48 h-48 rounded-full bg-[var(--accent)]/20 blur-3xl -top-4 -right-4 anim-float" />
          <div className="absolute w-44 h-44 rounded-full bg-[var(--cyan)]/20 blur-3xl -bottom-4 -left-4 anim-float [animation-delay:-3s]" />
          <div className="absolute w-40 h-40 rounded-full bg-[var(--violet)]/20 blur-3xl top-1/2 left-1/3 anim-float [animation-delay:-6s]" />

          {/* Rotating Ring */}
          <div className="absolute w-72 h-72 rounded-full border border-dashed border-white/10 anim-spin-slow pointer-events-none" />

          {/* Floating Mock Chat Card */}
          <div className="relative z-10 w-full max-w-sm glass rounded-2xl p-5 shadow-2xl border border-white/10">
            <div className="flex items-center gap-2 pb-3 mb-3 border-b border-white/10 text-xs font-mono text-[var(--muted)]">
              <span className="w-2 h-2 rounded-full bg-[var(--green)] anim-pulse-dot" />
              <span>Параллельный опрос баз</span>
              <span className="ml-auto text-[10px] px-2 py-0.5 rounded bg-white/5 text-[var(--cyan)]">
                RAG Pipeline
              </span>
            </div>

            <div className="space-y-3">
              {/* User bubble */}
              <div className="flex justify-end">
                <div className="max-w-[85%] bg-gradient-to-r from-[var(--accent-2)] to-[#c084fc] text-white text-xs px-3.5 py-2 rounded-2xl rounded-br-sm shadow-md">
                  Как создать горутину в Go?
                </div>
              </div>

              {/* Bot bubble */}
              <div className="flex gap-2.5 items-start">
                <div className="w-7 h-7 rounded-lg bg-[var(--prism)] grid place-items-center text-xs flex-none shadow-sm">
                  🤖
                </div>
                <div className="bg-white/5 border border-white/10 text-xs text-white/90 p-3 rounded-2xl rounded-tl-sm space-y-2">
                  <p>Горутина создаётся ключевым словом <code className="text-[var(--cyan)] font-mono bg-[var(--cyan)]/10 px-1 py-0.5 rounded">go</code> перед вызовом функции:</p>
                  <pre className="p-2 bg-black/40 rounded text-[11px] font-mono text-[var(--cyan)]">go func() &#123; ... &#125;()</pre>
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-[var(--cyan)] pt-1 border-t border-white/5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--cyan)]" />
                    <span>источник: bases/go.md</span>
                  </div>
                </div>
              </div>

              {/* Analysis pill */}
              <div className="p-2 rounded-xl bg-black/40 border border-[var(--green)]/30 text-[11px] font-mono flex items-center justify-between text-white/80">
                <div className="flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-[var(--green)] text-black font-bold text-[9px] grid place-items-center">
                    ✓
                  </span>
                  <span className="text-[var(--accent)] font-semibold">Go</span>
                  <span className="text-white/40">выбрана классификатором</span>
                </div>
                <span className="text-[10px] text-[var(--green)]">Готово</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
