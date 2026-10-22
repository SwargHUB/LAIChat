import React, { useState } from 'react';
import {
  Upload,
  FileText,
  FileCheck,
  Layers,
  Search,
  CheckCircle,
  AlertCircle,
  X,
  Sparkles,
  ArrowRight,
  BookOpen,
} from 'lucide-react';
import { renderMarkdown } from '../utils/markdown';

interface ChunkInfo {
  id: string;
  index: number;
  title: string;
  description: string;
  content: string;
  charCount: number;
  wordCount: number;
}

interface DocumentConverterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const DocumentConverterModal: React.FC<DocumentConverterModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [strategy, setStrategy] = useState<'headings' | 'size'>('headings');
  const [chunkSize, setChunkSize] = useState(1200);

  // Conversion output state
  const [baseName, setBaseName] = useState('');
  const [description, setDescription] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [chunks, setChunks] = useState<ChunkInfo[]>([]);
  const [format, setFormat] = useState<'docx' | 'pdf' | 'md' | 'txt' | ''>('');
  const [selectedChunkIdx, setSelectedChunkIdx] = useState<number | null>(null);
  const [importMode, setImportMode] = useState<'single-base' | 'split-bases'>('single-base');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Live BM25 search tester
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isGeneratingDesc, setIsGeneratingDesc] = useState(false);

  const handleGenAIDescription = async () => {
    if (!markdown.trim() && !baseName.trim()) return;
    setIsGeneratingDesc(true);
    try {
      const res = await fetch('/api/generate-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: baseName,
          content: markdown,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.description) {
          setDescription(data.description);
        }
      }
    } catch (err) {
      console.warn('Gen AI description in modal failed:', err);
    } finally {
      setIsGeneratingDesc(false);
    }
  };

  if (!isOpen) return null;

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setErrorMsg(null);
    await processConversion(selected, strategy, chunkSize);
  };

  const processConversion = async (
    fileToConvert: File,
    strat: 'headings' | 'size',
    size: number
  ) => {
    setIsConverting(true);
    setErrorMsg(null);

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const res = reader.result as string;
          const base64 = res.split(',')[1] || res;
          resolve(base64);
        };
        reader.onerror = reject;
      });
      reader.readAsDataURL(fileToConvert);
      const dataBase64 = await base64Promise;

      const resp = await fetch('/api/convert-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: fileToConvert.name,
          dataBase64,
          strategy: strat,
          chunkSize: size,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Ошибка конвертации: ${resp.status}`);
      }

      const data = await resp.json();
      setBaseName(data.cleanName || 'Новая_база');
      setDescription(`База знаний из ${fileToConvert.name}. Разделы: ${data.chunks.map((c: any) => c.title).slice(0, 4).join(', ')}`);
      setMarkdown(data.markdown);
      setChunks(data.chunks || []);
      setFormat(data.format);
      setSelectedChunkIdx(0);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Не удалось сконвертировать файл');
    } finally {
      setIsConverting(false);
    }
  };

  const handleImport = async () => {
    if (!baseName.trim() || chunks.length === 0) return;
    setIsImporting(true);
    setErrorMsg(null);

    try {
      const resp = await fetch('/api/import-chunks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseName: baseName.trim(),
          description: description.trim(),
          markdown,
          chunks,
          mode: importMode,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Ошибка импорта баз');
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Ошибка импорта');
    } finally {
      setIsImporting(false);
    }
  };

  const handleTestSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const resp = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery.trim(), topK: 3 }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setSearchResults(data.results || []);
      }
    } catch (err) {
      console.warn('Search test error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md anim-fade-up">
      <div className="glass rounded-3xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden border border-white/10 shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-black/30">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[var(--prism)] grid place-items-center text-xs font-bold text-black shadow-md">
              DOC
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Конвертер DOCX / PDF в Markdown и разбиение на чанки
              </h2>
              <p className="text-xs text-[var(--muted)]">
                Автоматическая очистка, выделение заголовков и индексация для локальных LLM
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-[var(--muted)] hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-[var(--rose)]/15 border border-[var(--rose)]/30 text-xs text-[var(--rose)] flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 flex-none" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Upload / Selector Dropzone */}
          <div className="p-6 rounded-3xl bg-black/30 border-2 border-dashed border-white/15 hover:border-[var(--accent)]/50 transition-colors text-center relative group">
            <input
              type="file"
              accept=".docx,.pdf,.md,.txt"
              onChange={handleFileSelect}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
            <div className="flex flex-col items-center gap-2 pointer-events-none">
              <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 grid place-items-center text-[var(--cyan)] group-hover:scale-110 transition-transform">
                <Upload className="w-6 h-6" />
              </div>
              <div className="text-sm font-semibold text-white">
                {file ? file.name : 'Выберите или перетащите файл DOCX, PDF, MD или TXT'}
              </div>
              <div className="text-xs text-[var(--muted)]">
                Поддерживаются официальные документы, регламенты, инструкции и книги
              </div>
            </div>
          </div>

          {/* Chunking Strategy Settings */}
          {file && (
            <div className="p-4 rounded-2xl bg-black/20 border border-white/5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-mono uppercase text-[var(--muted)] block mb-1.5">
                  Стратегия разбиения на части (RAG Chunks):
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setStrategy('headings');
                      if (file) processConversion(file, 'headings', chunkSize);
                    }}
                    className={`p-2.5 rounded-xl border text-left text-xs transition-all ${
                      strategy === 'headings'
                        ? 'border-[var(--accent)] bg-[var(--prism-soft)] text-white font-medium'
                        : 'border-white/10 bg-black/30 text-[var(--muted)] hover:text-white'
                    }`}
                  >
                    <div className="font-semibold">По разделам (#, ##)</div>
                    <div className="text-[10px] text-[var(--muted)] mt-0.5">
                      Смысловые параграфы
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setStrategy('size');
                      if (file) processConversion(file, 'size', chunkSize);
                    }}
                    className={`p-2.5 rounded-xl border text-left text-xs transition-all ${
                      strategy === 'size'
                        ? 'border-[var(--accent)] bg-[var(--prism-soft)] text-white font-medium'
                        : 'border-white/10 bg-black/30 text-[var(--muted)] hover:text-white'
                    }`}
                  >
                    <div className="font-semibold">По размеру блоков</div>
                    <div className="text-[10px] text-[var(--muted)] mt-0.5">
                      Чанки с перекрытием
                    </div>
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-mono uppercase text-[var(--muted)] block mb-1.5">
                  Целевой размер одного фрагмента: <span className="text-[var(--accent)]">{chunkSize} симв.</span>
                </label>
                <input
                  type="range"
                  min="400"
                  max="3000"
                  step="100"
                  value={chunkSize}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    setChunkSize(val);
                    if (file) processConversion(file, strategy, val);
                  }}
                  className="w-full mt-2"
                />
                <div className="text-[10px] text-[var(--muted)] mt-1">
                  Для локальных моделей (3B–7B) рекомендуется 800–1500 символов, чтобы контекст генерировался быстро и без ошибок.
                </div>
              </div>
            </div>
          )}

          {/* Results: Chunks inspection and Preview */}
          {chunks.length > 0 && (
            <div className="space-y-4 pt-2 border-t border-white/10">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-[var(--muted)] flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[var(--cyan)]" />
                  Сформировано частей: <b className="text-white">{chunks.length}</b> (Всего: {markdown.length} симв.)
                </span>

                <div className="flex items-center gap-2 text-xs">
                  <span className="text-[var(--muted)]">Режим сохранения:</span>
                  <select
                    value={importMode}
                    onChange={(e: any) => setImportMode(e.target.value)}
                    className="bg-black/40 border border-white/15 rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none"
                  >
                    <option value="single-base">Одна база с чанк-индексом (Рекомендуется)</option>
                    <option value="split-bases">Разбить на {chunks.length} отдельных баз (.md)</option>
                  </select>
                </div>
              </div>

              {/* Chunks Navigation & Preview Grid */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                {/* Chunks List */}
                <div className="md:col-span-5 space-y-2 max-h-64 overflow-y-auto pr-1">
                  {chunks.map((c, idx) => (
                    <div
                      key={c.id}
                      onClick={() => setSelectedChunkIdx(idx)}
                      className={`p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                        selectedChunkIdx === idx
                          ? 'border-[var(--accent)] bg-[var(--prism-soft)] shadow-sm'
                          : 'border-white/10 bg-black/20 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center justify-between font-mono text-[11px] mb-1">
                        <span className="font-semibold text-white truncate max-w-[170px]">
                          {idx + 1}. {c.title}
                        </span>
                        <span className="text-[var(--cyan)]">{c.charCount} симв.</span>
                      </div>
                      <div className="text-[10px] text-[var(--muted)] line-clamp-2">
                        {c.description}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Chunk Detail Preview */}
                <div className="md:col-span-7 bg-black/40 border border-white/10 rounded-2xl p-4 max-h-64 overflow-y-auto">
                  {selectedChunkIdx !== null && chunks[selectedChunkIdx] ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between pb-2 border-b border-white/10">
                        <span className="text-xs font-bold text-white">
                          {chunks[selectedChunkIdx].title}
                        </span>
                        <span className="text-[10px] font-mono text-[var(--accent)]">
                          {chunks[selectedChunkIdx].wordCount} слов
                        </span>
                      </div>
                      <div
                        className="markdown-body text-xs text-white/90 leading-relaxed"
                        dangerouslySetInnerHTML={{
                          __html: renderMarkdown(chunks[selectedChunkIdx].content),
                        }}
                      />
                    </div>
                  ) : (
                    <div className="text-xs text-[var(--muted)] p-6 text-center">
                      Выберите часть слева для просмотра
                    </div>
                  )}
                </div>
              </div>

              {/* Base Name & Description Editor */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="text-[10px] font-mono uppercase text-[var(--muted)] block mb-1">
                    Имя создаваемой базы:
                  </label>
                  <input
                    type="text"
                    value={baseName}
                    onChange={(e) => setBaseName(e.target.value)}
                    placeholder="reglament, instruktciya..."
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] font-mono uppercase text-[var(--muted)]">
                      Описание для роутинга:
                    </label>
                    <button
                      type="button"
                      onClick={handleGenAIDescription}
                      disabled={isGeneratingDesc || !markdown.trim()}
                      className="px-2 py-0.5 rounded-lg bg-[var(--prism-soft)] border border-[var(--cyan)]/40 hover:border-[var(--cyan)] text-[10px] font-mono text-[var(--cyan)] flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                      title="Сгенерировать ёмкое описание для RAG-роутера с помощью Gen AI"
                    >
                      <Sparkles className={`w-3 h-3 ${isGeneratingDesc ? 'animate-spin' : ''}`} />
                      <span>{isGeneratingDesc ? 'Генерация…' : 'Gen AI'}</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Ключевые темы и вопросы..."
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Interactive Search Verification Test */}
          <div className="p-4 rounded-2xl bg-black/25 border border-white/5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 text-[var(--cyan)]" />
                Тест локального BM25-поиска по чанкам (без обращения к интернету):
              </span>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleTestSearch()}
                placeholder="Введите тестовый вопрос (например: отпускные, заявление, горутины)..."
                className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[var(--cyan)]"
              />
              <button
                type="button"
                onClick={handleTestSearch}
                disabled={isSearching}
                className="btn btn-sm !py-1 text-xs border-[var(--cyan)]/30 text-[var(--cyan)]"
              >
                Найти
              </button>
            </div>

            {searchResults.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {searchResults.map((r, i) => (
                  <div
                    key={i}
                    className="p-2.5 rounded-xl bg-black/40 border border-white/10 text-xs flex flex-col gap-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[var(--accent)]">
                        [{r.baseName}] {r.heading}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--green)]">
                        BM25 Score: {r.score}
                      </span>
                    </div>
                    <p className="text-[11px] text-white/70">{r.snippet}</p>
                    {r.matchedTerms?.length > 0 && (
                      <div className="text-[9px] font-mono text-[var(--cyan)]">
                        Совпадения: {r.matchedTerms.join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border)] bg-black/40">
          <div className="text-xs text-[var(--muted)]">
            {format && (
              <span className="font-mono uppercase text-[var(--cyan)]">
                Формат: {format} · {chunks.length} частей
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="btn btn-sm border-white/10 text-[var(--muted)] hover:text-white"
            >
              Отмена
            </button>
            <button
              onClick={handleImport}
              disabled={isImporting || chunks.length === 0 || !baseName.trim()}
              className="btn btn-primary btn-sm"
            >
              <FileCheck className="w-4 h-4" />
              <span>
                {isImporting
                  ? 'Импорт…'
                  : importMode === 'split-bases'
                  ? `Создать ${chunks.length} отдельных баз`
                  : 'Сохранить базу с чанк-индексом'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
