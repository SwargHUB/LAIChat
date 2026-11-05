import React, { useState, useEffect, useRef } from 'react';
import {
  Cpu,
  HardDrive,
  Download,
  CheckCircle,
  AlertCircle,
  X,
  Search,
  Sparkles,
  FolderOpen,
  ExternalLink,
  RefreshCw,
  Zap,
  Check,
} from 'lucide-react';
import { HardwareSpecs, HuggingFaceModel, ModelDownloadTask } from '../types';

interface ModelDownloaderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onModelDownloaded: (modelBaseName?: string) => void;
}

export const ModelDownloaderModal: React.FC<ModelDownloaderModalProps> = ({
  isOpen,
  onClose,
  onModelDownloaded,
}) => {
  const [hardware, setHardware] = useState<HardwareSpecs | null>(null);
  const [recommendedModels, setRecommendedModels] = useState<HuggingFaceModel[]>([]);
  const [searchResults, setSearchResults] = useState<HuggingFaceModel[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoadingSpecs, setIsLoadingSpecs] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [filterFit, setFilterFit] = useState<'all' | 'optimal'>('all');
  const [downloads, setDownloads] = useState<Record<string, ModelDownloadTask>>({});
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [customUrl, setCustomUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pollTimerRef = useRef<number | null>(null);
  const completedRef = useRef<Set<string>>(new Set());

  const fetchHardwareAndModels = async () => {
    setIsLoadingSpecs(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/hardware');
      if (!res.ok) throw new Error('Не удалось получить параметры системы');
      const data = await res.json();
      setHardware(data.hardware);
      setRecommendedModels(data.recommended_models || []);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Ошибка чтения характеристик ПК');
    } finally {
      setIsLoadingSpecs(false);
    }
  };

  const pollDownloads = async () => {
    try {
      const res = await fetch('/api/models/downloads');
      if (!res.ok) return;
      const data = await res.json();
      const map: Record<string, ModelDownloadTask> = {};
      let newlyCompleted: string | undefined;

      for (const d of (data.downloads || []) as ModelDownloadTask[]) {
        map[d.filename.toLowerCase()] = d;
        if (d.status === 'completed' && !completedRef.current.has(d.filename.toLowerCase())) {
          completedRef.current.add(d.filename.toLowerCase());
          newlyCompleted = d.filename.replace(/\.gguf$/i, '');
        }
      }
      setDownloads(map);
      if (Array.isArray(data.local_models)) {
        setLocalModels(data.local_models);
      }
      if (newlyCompleted) {
        onModelDownloaded(newlyCompleted);
      }
    } catch {
      // ignore poll network error
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchHardwareAndModels();
      pollDownloads();
      pollTimerRef.current = window.setInterval(pollDownloads, 1200);
    } else if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSearchHF = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    setIsSearching(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/hf-search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка поиска на Hugging Face');
      setSearchResults(data.results || []);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Не удалось выполнить поиск на Hugging Face');
    } finally {
      setIsSearching(false);
    }
  };

  const handleStartDownload = async (model: {
    download_url: string;
    filename: string;
    repo: string;
  }) => {
    setErrorMsg(null);
    try {
      const res = await fetch('/api/models/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(model),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось начать скачивание');
      await pollDownloads();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Ошибка запуска скачивания');
    }
  };

  const handleDownloadCustomUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = customUrl.trim();
    if (!url) return;
    const parts = url.split('/');
    const rawName = parts[parts.length - 1]?.split('?')[0] || 'custom-model.gguf';
    const filename = rawName.toLowerCase().endsWith('.gguf') ? rawName : `${rawName}.gguf`;
    await handleStartDownload({
      download_url: url,
      filename,
      repo: 'Custom HuggingFace URL',
    });
    setCustomUrl('');
  };

  const handleCancelDownload = async (filename: string) => {
    try {
      await fetch('/api/models/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      await pollDownloads();
    } catch {
      // ignore
    }
  };

  const displayedModels = (searchResults !== null ? searchResults : recommendedModels).filter(
    (m) => (filterFit === 'optimal' ? m.fit_status === 'optimal' : true)
  );

  const isModelDownloaded = (filename: string, initialFlag?: boolean): boolean => {
    const base = filename.replace(/\.gguf$/i, '').toLowerCase();
    if (localModels.some((lm) => lm.toLowerCase() === base)) return true;
    const dl = downloads[filename.toLowerCase()];
    if (dl?.status === 'completed') return true;
    return Boolean(initialFlag);
  };

  const tierBadge = (tier?: HardwareSpecs['recommended_tier']) => {
    switch (tier) {
      case 'low':
        return { label: 'Базовый профиль (до 8 ГБ)', color: 'text-[var(--amber)] border-[var(--amber)]/30 bg-[var(--amber)]/10' };
      case 'medium':
        return { label: 'Средний профиль (8–16 ГБ)', color: 'text-[var(--cyan)] border-[var(--cyan)]/30 bg-[var(--cyan)]/10' };
      case 'high':
        return { label: 'Продвинутый профиль (16–28 ГБ)', color: 'text-[var(--green)] border-[var(--green)]/30 bg-[var(--green)]/10' };
      case 'ultra':
        return { label: 'Максимальный профиль (32+ ГБ)', color: 'text-[var(--accent)] border-[var(--accent)]/30 bg-[var(--accent)]/10' };
      default:
        return { label: 'Определение...', color: 'text-[var(--muted)] border-white/10 bg-white/5' };
    }
  };

  const badge = tierBadge(hardware?.recommended_tier);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md anim-fade-up">
      <div className="glass rounded-3xl border border-white/15 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[var(--prism-soft)] border border-[var(--cyan)]/40 grid place-items-center text-[var(--cyan)]">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>Менеджер локальных моделей (Hugging Face GGUF)</span>
              </h2>
              <p className="text-xs text-[var(--muted)]">
                Анализ параметров вашего компьютера и прямое скачивание моделей .gguf в папку <code className="text-[var(--cyan)] font-mono">models/</code>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-[var(--muted)] hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Hardware Diagnostics Card */}
          <div className="p-4 rounded-2xl bg-black/40 border border-white/10 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-white/10">
              <div className="flex items-center gap-2 text-xs font-semibold text-white">
                <Cpu className="w-4 h-4 text-[var(--cyan)]" />
                <span>Характеристики вашего компьютера</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-mono px-2.5 py-0.5 rounded-full border ${badge.color}`}>
                  {badge.label}
                </span>
                <button
                  type="button"
                  onClick={fetchHardwareAndModels}
                  disabled={isLoadingSpecs}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[var(--muted)] hover:text-white transition-colors cursor-pointer"
                  title="Обновить данные о системе"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSpecs ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {hardware ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                    <div className="text-[10px] font-mono uppercase text-[var(--muted)]">Процессор (CPU)</div>
                    <div className="text-xs font-semibold text-white mt-1 truncate" title={hardware.cpu_model}>
                      {hardware.cpu_model}
                    </div>
                    <div className="text-[10px] font-mono text-[var(--cyan)] mt-0.5">
                      {hardware.cpu_cores} потоков · {hardware.arch}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                    <div className="text-[10px] font-mono uppercase text-[var(--muted)]">Оперативная память</div>
                    <div className="text-xs font-semibold text-white mt-1">
                      {hardware.total_ram_gb} ГБ ОЗУ
                    </div>
                    <div className="text-[10px] font-mono text-[var(--green)] mt-0.5">
                      Свободно: {hardware.free_ram_gb} ГБ
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                    <div className="text-[10px] font-mono uppercase text-[var(--muted)]">Ускоритель / GPU</div>
                    <div className="text-xs font-semibold text-white mt-1 truncate" title={hardware.gpu_info}>
                      {hardware.gpu_info}
                    </div>
                    <div className="text-[10px] font-mono text-[var(--violet)] mt-0.5">
                      {hardware.vram_gb ? `VRAM: ${hardware.vram_gb} ГБ` : 'Системная память'}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                    <div className="text-[10px] font-mono uppercase text-[var(--muted)]">Диск и папка моделей</div>
                    <div className="text-xs font-semibold text-white mt-1 flex items-center gap-1">
                      <HardDrive className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                      <span>Свободно {hardware.disk_free_gb} ГБ</span>
                    </div>
                    <div
                      className="text-[10px] font-mono text-[var(--muted)] mt-0.5 truncate"
                      title={hardware.models_dir}
                    >
                      {hardware.models_dir}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-[var(--muted)]">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                    <span>{hardware.tier_description}</span>
                  </span>
                  <span className="font-mono text-[10px] text-white/60 flex items-center gap-1">
                    <FolderOpen className="w-3 h-3 text-[var(--cyan)]" />
                    В папке models/: {localModels.length} шт.
                  </span>
                </div>
              </>
            ) : (
              <div className="py-6 text-center text-xs text-[var(--muted)]">
                Анализ аппаратной конфигурации компьютера...
              </div>
            )}
          </div>

          {/* Search & Filter Controls */}
          <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
            <form onSubmit={handleSearchHF} className="flex-1 flex gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (!e.target.value.trim()) setSearchResults(null);
                  }}
                  placeholder="Поиск моделей GGUF на Hugging Face (например: qwen2.5, mistral, deepseek-r1)..."
                  className="w-full bg-black/40 border border-white/15 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-[var(--muted)] focus:outline-none focus:border-[var(--cyan)]"
                />
              </div>
              <button
                type="submit"
                disabled={isSearching}
                className="btn btn-sm !px-4 bg-[var(--cyan)]/15 border-[var(--cyan)]/40 text-[var(--cyan)] hover:bg-[var(--cyan)]/25 text-xs cursor-pointer"
              >
                {isSearching ? 'Поиск…' : 'Найти на HF'}
              </button>
              {searchResults !== null && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSearchResults(null);
                  }}
                  className="btn btn-sm !px-3 text-xs text-[var(--muted)] hover:text-white cursor-pointer"
                >
                  Сбросить
                </button>
              )}
            </form>

            <div className="flex bg-black/40 border border-white/10 rounded-xl p-1 gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setFilterFit('all')}
                className={`px-3 py-1 rounded-lg text-xs transition-all cursor-pointer ${
                  filterFit === 'all'
                    ? 'bg-[var(--prism-soft)] text-white font-semibold border border-[var(--accent)]/30'
                    : 'text-[var(--muted)] hover:text-white'
                }`}
              >
                Все ({ (searchResults !== null ? searchResults : recommendedModels).length })
              </button>
              <button
                type="button"
                onClick={() => setFilterFit('optimal')}
                className={`px-3 py-1 rounded-lg text-xs transition-all cursor-pointer flex items-center gap-1 ${
                  filterFit === 'optimal'
                    ? 'bg-[var(--green)]/20 text-[var(--green)] font-semibold border border-[var(--green)]/40'
                    : 'text-[var(--muted)] hover:text-white'
                }`}
              >
                <Zap className="w-3 h-3" />
                <span>Под моё железо</span>
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-[var(--rose)]/15 border border-[var(--rose)]/30 text-xs text-[var(--rose)] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Models Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {displayedModels.map((model) => {
              const dlTask = downloads[model.filename.toLowerCase()];
              const downloaded = isModelDownloaded(model.filename, model.is_downloaded);
              const isDownloading = dlTask?.status === 'downloading';

              return (
                <div
                  key={model.id}
                  className={`p-4 rounded-2xl border transition-all flex flex-col justify-between gap-3 ${
                    model.fit_status === 'optimal'
                      ? 'bg-black/40 border-[var(--green)]/35 hover:border-[var(--green)]/60'
                      : 'bg-black/30 border-white/10 hover:border-white/25'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-bold text-white">{model.name}</h3>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/10 text-[var(--cyan)]">
                            {model.params} · {model.quantization}
                          </span>
                        </div>
                        <a
                          href={`https://huggingface.co/${model.repo}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] font-mono text-[var(--muted)] hover:text-[var(--cyan)] inline-flex items-center gap-1 mt-0.5"
                        >
                          <span>{model.repo}</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>

                      {model.fit_status === 'optimal' && (
                        <span className="shrink-0 text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--green)]/15 border border-[var(--green)]/40 text-[var(--green)] flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          Рекомендуется
                        </span>
                      )}
                      {model.fit_status === 'heavy' && (
                        <span className="shrink-0 text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--amber)]/15 border border-[var(--amber)]/40 text-[var(--amber)]">
                          Требует {model.min_ram_gb}+ ГБ ОЗУ
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-white/80 leading-relaxed">{model.description}</p>

                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {model.tags?.map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/5 text-[var(--muted)] border border-white/5"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-white/10 space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-mono text-[var(--muted)]">
                      <span>
                        Размер: <strong className="text-white">{model.size_gb} ГБ</strong>
                      </span>
                      <span>
                        Мин. ОЗУ: <strong className="text-white">{model.min_ram_gb} ГБ</strong>
                      </span>
                      <span>
                        Контекст:{' '}
                        <strong className="text-[var(--cyan)]">
                          {Math.round(model.context_length / 1024)}K
                        </strong>
                      </span>
                    </div>

                    {isDownloading && dlTask && (
                      <div className="space-y-1.5 pt-1">
                        <div className="flex justify-between text-[10px] font-mono">
                          <span className="text-[var(--cyan)]">
                            Скачивание: {dlTask.progress}% ({dlTask.speed_mbps} МБ/с)
                          </span>
                          <span className="text-white/70">
                            {(dlTask.downloaded_bytes / 1024 ** 3).toFixed(2)} /{' '}
                            {dlTask.total_bytes
                              ? (dlTask.total_bytes / 1024 ** 3).toFixed(2)
                              : model.size_gb}{' '}
                            ГБ
                          </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-[var(--cyan)] to-[var(--accent)] transition-all duration-300"
                            style={{ width: `${Math.max(3, dlTask.progress)}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {dlTask?.status === 'error' && (
                      <div className="text-[10px] text-[var(--rose)] font-mono">
                        Ошибка: {dlTask.error}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span
                        className="text-[10px] font-mono text-[var(--muted)] truncate"
                        title={model.filename}
                      >
                        {model.filename}
                      </span>

                      {downloaded ? (
                        <button
                          type="button"
                          onClick={() => {
                            onModelDownloaded(model.filename.replace(/\.gguf$/i, ''));
                            onClose();
                          }}
                          className="btn btn-sm !py-1.5 !px-3 text-xs bg-[var(--green)]/20 border-[var(--green)]/40 text-[var(--green)] hover:bg-[var(--green)]/30 flex items-center gap-1.5 shrink-0 cursor-pointer"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>Выбрать модель</span>
                        </button>
                      ) : isDownloading ? (
                        <button
                          type="button"
                          onClick={() => handleCancelDownload(model.filename)}
                          className="btn btn-sm !py-1.5 !px-3 text-xs bg-[var(--rose)]/20 border-[var(--rose)]/40 text-[var(--rose)] hover:bg-[var(--rose)]/30 shrink-0 cursor-pointer"
                        >
                          Отменить
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            handleStartDownload({
                              download_url: model.download_url,
                              filename: model.filename,
                              repo: model.repo,
                            })
                          }
                          className="btn btn-sm !py-1.5 !px-3.5 text-xs btn-primary flex items-center gap-1.5 shrink-0 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Скачать в models/</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Direct HuggingFace GGUF URL Download */}
          <form
            onSubmit={handleDownloadCustomUrl}
            className="p-3.5 rounded-2xl bg-black/30 border border-white/10 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
          >
            <div className="text-xs text-[var(--muted)] shrink-0 font-mono">
              Прямая ссылка .gguf:
            </div>
            <input
              type="url"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="https://huggingface.co/.../resolve/main/model-q4_k_m.gguf"
              className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-1.5 text-xs font-mono text-white placeholder-[var(--muted)] focus:outline-none focus:border-[var(--accent)]"
            />
            <button
              type="submit"
              disabled={!customUrl.trim()}
              className="btn btn-sm !py-1.5 !px-3.5 text-xs border-[var(--accent)]/40 text-[var(--accent)] hover:bg-[var(--accent)]/15 disabled:opacity-40 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Скачать по ссылке</span>
            </button>
          </form>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-white/10 bg-black/40 flex items-center justify-between text-xs text-[var(--muted)]">
          <span>
            Файлы сохраняются в <code className="text-white font-mono">{hardware?.models_dir || './models'}</code>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-sm !px-4 !py-1.5 text-xs text-white cursor-pointer"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
