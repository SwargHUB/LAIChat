import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '../types';
import { Send, Copy, Check, ChevronRight, Sparkles, Trash2, ArrowUpRight } from 'lucide-react';
import { renderMarkdown } from '../utils/markdown';

interface ChatAreaProps {
  messages: ChatMessage[];
  isLoading: boolean;
  onSendMessage: (msg: string) => Promise<void>;
  onClearChat: () => void;
  contextSize: number;
  isStandalone?: boolean;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  messages,
  isLoading,
  onSendMessage,
  onClearChat,
  contextSize,
  isStandalone = false,
}) => {
  const [inputText, setInputText] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto scroll to bottom when messages change or while loading
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTo({
        top: logRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [messages, isLoading]);

  // Adjust textarea height automatically
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = async () => {
    const text = inputText.trim();
    if (!text || isLoading) return;

    setInputText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    await onSendMessage(text);
  };

  const handleCopyMessage = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Delegated copy handler for code blocks inside rendered markdown
  useEffect(() => {
    const handleLogClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target && target.classList.contains('copy-code-btn')) {
        const code = target.getAttribute('data-code');
        if (code) {
          navigator.clipboard.writeText(code);
          const origText = target.innerText;
          target.innerText = 'Скопировано!';
          setTimeout(() => {
            target.innerText = origText;
          }, 2000);
        }
      }
    };

    const el = logRef.current;
    if (el) {
      el.addEventListener('click', handleLogClick);
    }
    return () => {
      if (el) {
        el.removeEventListener('click', handleLogClick);
      }
    };
  }, []);

  const samplePrompts = [
    'За сколько дней нужно подавать заявление на отпуск?',
    'Когда бухгалтерия выплачивает отпускные?',
    'Можно ли делить отпуск на части и какой минимум дней?',
    'Как создать горутину и канал в Go?',
  ];

  return (
    <div
      className={`glass rounded-3xl flex flex-col overflow-hidden border border-[var(--border)] shadow-2xl ${
        isStandalone ? 'h-[calc(100vh-90px)]' : 'min-h-[640px]'
      }`}
    >
      {/* Chat Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-black/25">
        <div className="flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--green)] anim-pulse-dot" />
          <span className="font-bold text-sm tracking-wide text-white">
            Диалог с ассистентом LAIChat
          </span>
        </div>

        <div className="flex items-center gap-3 font-mono text-xs">
          <span className="text-[var(--muted)] px-2.5 py-1 rounded-full bg-white/5 border border-white/5">
            ctx {contextSize} tok
          </span>
          {messages.length > 0 && (
            <button
              onClick={onClearChat}
              title="Очистить переписку"
              className="text-[var(--muted)] hover:text-[var(--rose)] transition-colors p-1"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Chat Messages Log */}
      <div
        ref={logRef}
        className={`flex-1 overflow-y-auto p-6 space-y-6 ${
          isStandalone ? '' : 'max-h-[580px] min-h-[400px]'
        }`}
      >
        {/* Welcome message if no user messages yet */}
        {messages.length === 0 && (
          <div className="space-y-6">
            <div className="flex items-start gap-3.5 max-w-[90%]">
              <div className="w-9 h-9 rounded-xl bg-[var(--prism)] grid place-items-center text-sm flex-none shadow-[var(--glow-pink)]">
                🤖
              </div>
              <div className="space-y-3">
                <div className="p-4 rounded-3xl rounded-tl-sm bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-[var(--border)] backdrop-blur-md text-sm text-[#f4f4f6] leading-relaxed shadow-lg">
                  Привет! Я локальный AI-ассистент <b>LAIChat</b>. Задайте вопрос — я параллельно
                  опрошу базы знаний из папки{' '}
                  <code className="text-[var(--cyan)] font-mono bg-[var(--cyan)]/10 px-1.5 py-0.5 rounded">
                    bases/
                  </code>
                  , автоматически выберу наиболее подходящую тему с помощью классификатора и
                  сформирую точный ответ с указанием источника.
                </div>

                {/* Quick suggestions */}
                <div className="space-y-1.5">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)] px-1">
                    Попробуйте спросить:
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {samplePrompts.map((p, idx) => (
                      <button
                        key={idx}
                        onClick={() => onSendMessage(p)}
                        className="text-left p-2.5 rounded-xl bg-black/30 border border-white/5 hover:border-[var(--accent)]/40 hover:bg-white/5 text-xs text-[var(--muted)] hover:text-white transition-all flex items-center justify-between group cursor-pointer"
                      >
                        <span className="line-clamp-2">{p}</span>
                        <ArrowUpRight className="w-3.5 h-3.5 flex-none opacity-0 group-hover:opacity-100 text-[var(--accent)] transition-opacity" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Message items */}
        {messages.map((m) => {
          const isUser = m.role === 'user';

          if (isUser) {
            return (
              <div key={m.id} className="flex justify-end anim-fade-up">
                <div className="max-w-[80%] bg-gradient-to-r from-[var(--accent-2)] to-[#c084fc] text-white text-sm px-4 py-3 rounded-2xl rounded-br-sm shadow-xl leading-relaxed whitespace-pre-wrap break-words">
                  {m.content}
                </div>
              </div>
            );
          }

          // Assistant message
          return (
            <div key={m.id} className="flex items-start gap-3.5 max-w-[90%] anim-fade-up group">
              <div className="w-9 h-9 rounded-xl bg-[var(--prism)] grid place-items-center text-sm flex-none shadow-[var(--glow-pink)]">
                🤖
              </div>

              <div className="flex-1 space-y-2 min-w-0">
                <div className="relative p-4 rounded-3xl rounded-tl-sm bg-gradient-to-br from-white/[0.08] to-white/[0.02] border border-[var(--border)] backdrop-blur-md shadow-lg">
                  {/* Quick copy button */}
                  <button
                    onClick={() => handleCopyMessage(m.id, m.content)}
                    className="absolute top-3 right-3 p-1.5 rounded-lg bg-black/40 border border-white/10 text-[var(--muted)] hover:text-white opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                    title="Скопировать ответ"
                  >
                    {copiedId === m.id ? (
                      <Check className="w-3.5 h-3.5 text-[var(--green)]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>

                  {/* Rendered text */}
                  <div
                    className="markdown-body text-white/90 text-sm"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
                  />

                  {/* Source citation */}
                  {m.source && (
                    <div className="mt-3 pt-2.5 border-t border-white/5 flex items-center gap-2 text-xs font-mono text-[var(--cyan)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--cyan)]" />
                      <span>источник: bases/{m.source.toLowerCase()}.md</span>
                    </div>
                  )}
                </div>

                {/* LAIChat Signature: Parallel Analyses Breakdown */}
                {m.analyses && m.analyses.length > 0 && (
                  <details className="analyses group/details rounded-2xl border border-[var(--border)] bg-black/20 overflow-hidden text-xs">
                    <summary className="cursor-pointer p-3 font-mono text-xs text-[var(--muted)] flex items-center gap-2 hover:bg-white/5 transition-colors select-none">
                      <ChevronRight className="w-3.5 h-3.5 text-[var(--accent)] group-open/details:rotate-90 transition-transform" />
                      <span className="text-white font-medium">Параллельный анализ баз</span>
                      <span className="ml-auto px-2 py-0.5 rounded-full bg-[var(--prism-soft)] text-[var(--cyan)] border border-[var(--cyan)]/30 text-[10px]">
                        {m.analyses.length} баз
                      </span>
                    </summary>

                    <div className="p-3 pt-1 space-y-2.5">
                      {m.analyses.map((an) => {
                        const isNA =
                          an.answer.toUpperCase().startsWith('N/A:') ||
                          an.answer.toUpperCase().startsWith('N/A ');

                        return (
                          <div
                            key={an.name}
                            className={`p-3 rounded-xl border transition-all ${
                              an.chosen
                                ? 'border-[var(--green)]/50 bg-gradient-to-r from-[var(--green)]/10 to-black/30 shadow-sm'
                                : 'border-white/5 bg-black/30'
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span
                                className={`w-4 h-4 rounded-full font-bold text-[9px] grid place-items-center ${
                                  an.chosen
                                    ? 'bg-[var(--green)] text-black'
                                    : 'bg-white/10 text-[var(--muted)]'
                                }`}
                              >
                                {an.chosen ? '✓' : '·'}
                              </span>
                              <span className="font-mono font-semibold text-xs text-[var(--accent)]">
                                {an.name}
                              </span>
                              {an.description && (
                                <span className="text-[10px] text-[var(--muted)] truncate max-w-[240px]">
                                  {an.description}
                                </span>
                              )}
                              {an.chosen && (
                                <span className="ml-auto text-[10px] font-mono text-[var(--green)] font-semibold">
                                  ВЫБРАНА
                                </span>
                              )}
                            </div>

                            {an.err ? (
                              <div className="text-[var(--rose)] italic text-xs">{an.err}</div>
                            ) : (
                              <div
                                className={`text-xs leading-relaxed ${
                                  isNA ? 'text-[var(--muted)] italic' : 'text-white/80'
                                }`}
                              >
                                {an.answer || '(пустой ответ)'}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </details>
                )}
              </div>
            </div>
          );
        })}

        {/* Loading state with typing dots */}
        {isLoading && (
          <div className="flex items-start gap-3.5 max-w-[80%] anim-fade-up">
            <div className="w-9 h-9 rounded-xl bg-[var(--prism)] grid place-items-center text-sm flex-none shadow-[var(--glow-pink)]">
              🤖
            </div>
            <div className="p-4 rounded-3xl rounded-tl-sm bg-black/30 border border-white/10 flex items-center gap-2">
              <span className="text-xs text-[var(--muted)] font-mono mr-2">
                Параллельный опрос баз и генерация ответа…
              </span>
              <span className="flex items-center gap-1.5">
                <i className="w-2 h-2 rounded-full bg-[var(--accent)] animate-bounce [animation-delay:-0.3s]" />
                <i className="w-2 h-2 rounded-full bg-[var(--accent)] animate-bounce [animation-delay:-0.15s]" />
                <i className="w-2 h-2 rounded-full bg-[var(--accent)] animate-bounce" />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Composer Input Area */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="border-t border-[var(--border)] p-4 bg-black/35"
      >
        <div className="flex items-end gap-3">
          <textarea
            ref={textareaRef}
            rows={1}
            maxLength={4000}
            value={inputText}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            placeholder="Введите вопрос… (Enter — отправить, Shift+Enter — перенос)"
            className="flex-1 bg-black/40 border border-[var(--border)] rounded-2xl px-4 py-3 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] resize-none transition-all max-h-44 disabled:opacity-50"
          />

          <button
            type="submit"
            disabled={isLoading || !inputText.trim()}
            className="btn btn-primary !h-[48px] !px-5 text-sm flex items-center gap-2 shadow-lg disabled:opacity-40 flex-none"
          >
            <span>Отправить</span>
            <Send className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center justify-between mt-2.5 px-2 text-[11px] font-mono text-[var(--muted)]">
          <span>Enter — отправить · Shift+Enter — новая строка</span>
          <span
            className={
              inputText.length > 3800
                ? 'text-[var(--rose)]'
                : inputText.length > 3000
                ? 'text-[var(--amber)]'
                : 'text-[var(--muted)]'
            }
          >
            {inputText.length} / 4000
          </span>
        </div>
      </form>
    </div>
  );
};
