import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { execSync } from 'child_process';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { BM25Index, tokenize, DocumentChunk } from './searchEngine';
import {
  convertDocumentToMarkdown,
  chunkMarkdownByHeadings,
  chunkMarkdownBySize,
  ChunkInfo,
} from './converter';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);
const BASES_DIR = path.resolve(process.cwd(), 'bases');
const SETTINGS_FILE = path.resolve(process.cwd(), 'settings.json');
const MODELS_DIR = path.resolve(process.cwd(), 'models');

// Ensure bases and models directories exist
if (!fs.existsSync(BASES_DIR)) {
  fs.mkdirSync(BASES_DIR, { recursive: true });
}
if (!fs.existsSync(MODELS_DIR)) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
}

/**
 * Сканирует папку models/ и возвращает имена локальных .gguf без расширения.
 * Используется для первого запуска: если settings.json ещё нет, провайдером
 * по умолчанию становится локальный llama-server с моделью из этой папки.
 */
function discoverLocalModels(): string[] {
  try {
    if (!fs.existsSync(MODELS_DIR)) return [];
    return fs
      .readdirSync(MODELS_DIR)
      .filter((f) => f.toLowerCase().endsWith('.gguf'))
      .map((f) => path.basename(f, path.extname(f)))
      .sort();
  } catch (err) {
    console.error('Не удалось прочитать папку models/:', err);
    return [];
  }
}

/**
 * Определяет IPv4-адреса текущей машины в локальной сети (LAN),
 * чтобы пользователь мог открыть чат с других устройств (смартфона, ноутбука).
 */
function getLocalNetworkIPs(): string[] {
  const ips: string[] = [];
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          ips.push(iface.address);
        }
      }
    }
  } catch (err) {
    console.error('Ошибка получения сетевых интерфейсов:', err);
  }
  return ips;
}

// =====================================================================
// ДИАГНОСТИКА ЖЕЛЕЗА И МЕНЕДЖЕР МОДЕЛЕЙ HUGGING FACE (GGUF)
// =====================================================================

interface HardwareSpecs {
  cpu_model: string;
  cpu_cores: number;
  arch: string;
  platform: string;
  total_ram_gb: number;
  free_ram_gb: number;
  gpu_info: string;
  vram_gb?: number;
  disk_free_gb: number;
  models_dir: string;
  recommended_tier: 'low' | 'medium' | 'high' | 'ultra';
  tier_description: string;
}

function getHardwareSpecs(): HardwareSpecs {
  const cpus = os.cpus();
  const cpuModel = (cpus[0]?.model || 'CPU Processor').replace(/\s+/g, ' ').trim();
  const cpuCores = cpus.length || 4;
  const totalRamGb = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
  const freeRamGb = Math.round((os.freemem() / 1024 ** 3) * 10) / 10;

  let diskFreeGb = 50;
  try {
    if (typeof fs.statfsSync === 'function') {
      const stat = fs.statfsSync(MODELS_DIR);
      diskFreeGb = Math.round(((Number(stat.bavail) * Number(stat.bsize)) / 1024 ** 3) * 10) / 10;
    }
  } catch {
    // fallback if statfsSync is unavailable
  }

  let gpuInfo = 'CPU Inference (AVX2 / ARM NEON)';
  let vramGb: number | undefined;
  try {
    const smi = execSync(
      'nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits',
      { timeout: 1200, stdio: ['ignore', 'pipe', 'ignore'] }
    )
      .toString()
      .trim();
    if (smi) {
      const firstLine = smi.split('\n')[0];
      const [gpuName, memMb] = firstLine.split(',').map((s) => s.trim());
      if (gpuName) {
        const vram = memMb ? Math.round(( parseFloat(memMb) / 1024 ) * 10) / 10 : undefined;
        vramGb = vram;
        gpuInfo = vram ? `${gpuName} (${vram} ГБ VRAM)` : gpuName;
      }
    }
  } catch {
    if (process.platform === 'darwin' && process.arch === 'arm64') {
      gpuInfo = `Apple Silicon Unified Memory (${totalRamGb} ГБ)`;
      vramGb = totalRamGb;
    }
  }

  const effectiveMem = vramGb ? Math.max(totalRamGb, vramGb * 1.5) : totalRamGb;
  let recommendedTier: 'low' | 'medium' | 'high' | 'ultra' = 'medium';
  let tierDescription = '';

  if (effectiveMem < 7.5) {
    recommendedTier = 'low';
    tierDescription = 'Компактные модели 0.5B – 3B (Q4_K_M). Быстрый отклик при малом объёме ОЗУ.';
  } else if (effectiveMem <= 15) {
    recommendedTier = 'medium';
    tierDescription = 'Оптимальны модели 3B – 8B (Q4_K_M / Q5_K_M). Отличный баланс скорости и качества для RAG.';
  } else if (effectiveMem <= 28) {
    recommendedTier = 'high';
    tierDescription = 'Доступны мощные модели 7B – 14B (Q4_K_M / Q5_K_M) с глубоким анализом контекста.';
  } else {
    recommendedTier = 'ultra';
    tierDescription = 'Высокопроизводительная система: доступны модели 14B – 32B+ и длинный контекст до 128K–250K.';
  }

  return {
    cpu_model: cpuModel,
    cpu_cores: cpuCores,
    arch: os.arch(),
    platform: os.platform(),
    total_ram_gb: totalRamGb,
    free_ram_gb: freeRamGb,
    gpu_info: gpuInfo,
    vram_gb: vramGb,
    disk_free_gb: diskFreeGb,
    models_dir: MODELS_DIR,
    recommended_tier: recommendedTier,
    tier_description: tierDescription,
  };
}

interface CatalogModel {
  id: string;
  name: string;
  repo: string;
  filename: string;
  download_url: string;
  size_gb: number;
  min_ram_gb: number;
  params: string;
  quantization: string;
  context_length: number;
  description: string;
  tags: string[];
  recommended_for: ('low' | 'medium' | 'high' | 'ultra')[];
}

const CURATED_HF_MODELS: CatalogModel[] = [
  {
    id: 'qwen2.5-1.5b-instruct-q4',
    name: 'Qwen 2.5 1.5B Instruct',
    repo: 'Qwen/Qwen2.5-1.5B-Instruct-GGUF',
    filename: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    download_url:
      'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf',
    size_gb: 1.1,
    min_ram_gb: 3,
    params: '1.5B',
    quantization: 'Q4_K_M',
    context_length: 32768,
    description:
      'Сверхбыстрая компактная модель с отличным русским языком. Мгновенно работает даже на слабых ПК и ноутбуках без видеокарты.',
    tags: ['Русский язык', 'Быстрая', 'Для слабых ПК', '32K контекст'],
    recommended_for: ['low', 'medium'],
  },
  {
    id: 'llama-3.2-3b-instruct-q4',
    name: 'Llama 3.2 3B Instruct',
    repo: 'bartowski/Llama-3.2-3B-Instruct-GGUF',
    filename: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    download_url:
      'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    size_gb: 2.0,
    min_ram_gb: 4,
    params: '3B',
    quantization: 'Q4_K_M',
    context_length: 131072,
    description:
      'Оптимальная модель от Meta с поддержкой контекста до 128K токенов. Отлично подходит для быстрой работы с большими базами знаний.',
    tags: ['128K контекст', 'RAG', 'Сбалансированная'],
    recommended_for: ['low', 'medium', 'high'],
  },
  {
    id: 'qwen2.5-3b-instruct-q4',
    name: 'Qwen 2.5 3B Instruct',
    repo: 'Qwen/Qwen2.5-3B-Instruct-GGUF',
    filename: 'qwen2.5-3b-instruct-q4_k_m.gguf',
    download_url:
      'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf',
    size_gb: 2.1,
    min_ram_gb: 4.5,
    params: '3B',
    quantization: 'Q4_K_M',
    context_length: 32768,
    description:
      'Умная 3B-модель с глубоким пониманием русского языка, таблиц и технических инструкций. Идеальна для ноутбуков с 8 ГБ ОЗУ.',
    tags: ['Русский язык', 'RAG', 'Точные ответы'],
    recommended_for: ['low', 'medium', 'high'],
  },
  {
    id: 'qwen2.5-7b-instruct-q4',
    name: 'Qwen 2.5 7B Instruct',
    repo: 'bartowski/Qwen2.5-7B-Instruct-GGUF',
    filename: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    download_url:
      'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    size_gb: 4.7,
    min_ram_gb: 8,
    params: '7B',
    quantization: 'Q4_K_M',
    context_length: 131072,
    description:
      'Золотой стандарт для локального чата и баз знаний! Превосходное качество русского языка, классификации и контекст до 128K.',
    tags: ['Хит для RAG', 'Русский язык', '128K контекст'],
    recommended_for: ['medium', 'high', 'ultra'],
  },
  {
    id: 'qwen2.5-coder-7b-instruct-q4',
    name: 'Qwen 2.5 Coder 7B Instruct',
    repo: 'Qwen/Qwen2.5-Coder-7B-Instruct-GGUF',
    filename: 'qwen2.5-coder-7b-instruct-q4_k_m.gguf',
    download_url:
      'https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf',
    size_gb: 4.7,
    min_ram_gb: 8,
    params: '7B',
    quantization: 'Q4_K_M',
    context_length: 131072,
    description:
      'Специализированная модель для программирования, анализа кода (Go, Python, TS) и технической документации.',
    tags: ['Код и Go/TS', '128K контекст', 'Техдокументация'],
    recommended_for: ['medium', 'high', 'ultra'],
  },
  {
    id: 'llama-3.1-8b-instruct-q4',
    name: 'Llama 3.1 8B Instruct',
    repo: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF',
    filename: 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf',
    download_url:
      'https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf',
    size_gb: 4.9,
    min_ram_gb: 8,
    params: '8B',
    quantization: 'Q4_K_M',
    context_length: 131072,
    description:
      'Популярная универсальная модель 8B с большим контекстным окном 128K и надёжным следованием системным инструкциям.',
    tags: ['Универсальная', '128K контекст', '8B'],
    recommended_for: ['medium', 'high', 'ultra'],
  },
  {
    id: 'gemma-2-9b-it-q4',
    name: 'Google Gemma 2 9B Instruct',
    repo: 'bartowski/gemma-2-9b-it-GGUF',
    filename: 'gemma-2-9b-it-Q4_K_M.gguf',
    download_url:
      'https://huggingface.co/bartowski/gemma-2-9b-it-GGUF/resolve/main/gemma-2-9b-it-Q4_K_M.gguf',
    size_gb: 5.8,
    min_ram_gb: 10,
    params: '9B',
    quantization: 'Q4_K_M',
    context_length: 8192,
    description:
      'Модель от Google с высокой точностью логических рассуждений, суммаризации текста и аккуратной работой с фактами.',
    tags: ['Логика и стиль', 'Google Gemma 2', '9B'],
    recommended_for: ['high', 'ultra'],
  },
  {
    id: 'qwen2.5-14b-instruct-q4',
    name: 'Qwen 2.5 14B Instruct',
    repo: 'bartowski/Qwen2.5-14B-Instruct-GGUF',
    filename: 'Qwen2.5-14B-Instruct-Q4_K_M.gguf',
    download_url:
      'https://huggingface.co/bartowski/Qwen2.5-14B-Instruct-GGUF/resolve/main/Qwen2.5-14B-Instruct-Q4_K_M.gguf',
    size_gb: 9.0,
    min_ram_gb: 16,
    params: '14B',
    quantization: 'Q4_K_M',
    context_length: 131072,
    description:
      'Мощная 14-миллиардная модель для систем от 16 ГБ ОЗУ. Показывает уровень, близкий к облачным LLM, на сложных аналитических запросах.',
    tags: ['Высокая точность', '128K контекст', 'Для 16+ ГБ ОЗУ'],
    recommended_for: ['high', 'ultra'],
  },
];

interface DownloadTaskState {
  filename: string;
  repo: string;
  status: 'downloading' | 'completed' | 'error' | 'cancelled';
  downloaded_bytes: number;
  total_bytes: number;
  progress: number;
  speed_mbps: number;
  error?: string;
  abortController?: AbortController;
}

const activeDownloads = new Map<string, DownloadTaskState>();

interface Base {
  name: string;
  description: string;
  filePath: string;
  content: string;
}

interface Settings {
  context_size: number;
  threads: number;
  max_tokens: number;
  temperature: number;
  top_p: number;
  backend_provider?: 'gemini' | 'openai_compatible' | 'llama_cpp' | 'ollama';
  llama_server_url?: string;
  openai_base_url?: string;
  openai_api_key?: string;
  model_name?: string;
  system_prompt?: string;
  /**
   * Таймаут одного запроса к модели в секундах. Локальному серверу нужно
   * заметно больше: он обрабатывает запросы последовательно, и при параллельном
   * анализе нескольких баз ответ может ждать в очереди десятки секунд.
   */
  request_timeout?: number;
  /**
   * Параллельный анализ всех баз перед ответом. Даёт более точный выбор
   * источника, но добавляет отдельный вызов модели (секунды на локальной).
   * Выключенный режим — быстрый выбор базы по совпадению слов, без запроса к LLM.
   */
  parallel_analysis?: boolean;
  /** Доступность веб-интерфейса из локальной сети (LAN) */
  lan_access?: boolean;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface BaseAnalysis {
  name: string;
  description: string;
  answer: string;
  err?: string;
  chosen: boolean;
}

// Первая найденная локальная модель — дефолт для самого первого запуска,
// когда settings.json ещё не существует.
const FIRST_LOCAL_MODEL = discoverLocalModels()[0] || 'local';

// Default settings.
// Провайдером по умолчанию идёт локальный llama-server: приложение создано
// как локальный чат, а облачные провайдеры надо включать осознанно через UI.
// Если ключ Gemini прописан в .env — уважаем его (обратная совместимость).
const DEFAULT_SETTINGS: Settings = {
  context_size: 4096,
  threads: 8,
  max_tokens: 1024,
  temperature: 0.7,
  top_p: 0.9,
  backend_provider: process.env.GEMINI_API_KEY ? 'gemini' : 'llama_cpp',
  llama_server_url: 'http://127.0.0.1:8080',
  openai_base_url: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  openai_api_key: process.env.OPENAI_API_KEY || '',
  model_name: FIRST_LOCAL_MODEL,
  request_timeout: 300,
  parallel_analysis: true,
  lan_access: true,
};

/**
 * Таймаут запроса к модели в миллисекундах.
 * Локальный сервер обрабатывает запросы последовательно: пока генерируется
 * предыдущий базовый ответ, остальные стоят в очереди. Поэтому у локального
 * провайдера лимит заметно больше, чем у облачного.
 */
function resolveTimeoutMs(settings: Settings, provider: string): number {
  const fallback = provider === 'llama_cpp' || provider === 'ollama' ? 300 : 120;
  const seconds = settings.request_timeout ?? fallback;
  const safe = Number.isFinite(seconds) ? Math.max(5, Math.min(3600, seconds)) : fallback;
  return safe * 1000;
}

// =====================================================================
// РАСПОЗНАВАНИЕ ОШИБОК
// =====================================================================

/** Признаки переполнения контекста в теле ошибки от любого провайдера. */
const CONTEXT_OVERFLOW_MARKERS = [
  'exceed_context_size_error',
  'exceeds the available context size',
  'exceeds context size',
  'context size exceeded',
  'maximum context length',
  'context_length_exceeded',
  'prompt is too long',
  'reduce the length of the messages',
  'контекст модели переполнен',
];

/** Помеченная ошибка переполнения контекста — надёжнее, чем разбор текста. */
class ContextOverflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextOverflowError';
  }
}

export type ChatErrorCode = 'context_overflow' | 'timeout' | 'connection' | 'generic';

/** Понимает ли провайдер, что контекст переполнен. */
function isContextOverflow(text: string): boolean {
  const t = (text || '').toLowerCase();
  return CONTEXT_OVERFLOW_MARKERS.some((m) => t.includes(m));
}

/** Ошибка переполнения: наша помеченная либо распознанная по тексту ответа. */
function isOverflowErr(err: any): boolean {
  if (err?.name === 'ContextOverflowError') return true;
  return isContextOverflow(err?.message || String(err || ''));
}

/** Достаёт «60030 токенов из 16384» из тела ошибки llama.cpp, если они есть. */
function extractContextHint(text: string): string {
  const prompt = (text || '').match(/(\d+)\s+tokens?\)\s*exceeds/);
  const ctx = (text || '').match(/context size \((\d+)\s+tokens?\)/);
  if (prompt && ctx) {
    return `Запрос: ${prompt[1]} токенов, доступно: ${ctx[1]}.`;
  }
  const nPrompt = (text || '').match(/"n_prompt_tokens"\s*:\s*(\d+)/);
  const nCtx = (text || '').match(/"n_ctx"\s*:\s*(\d+)/);
  if (nPrompt && nCtx) {
    return `Запрос: ${nPrompt[1]} токенов, доступно: ${nCtx[1]}.`;
  }
  return '';
}

export interface ClassifiedError {
  code: ChatErrorCode;
  /** Стоит ли предлагать пользователю начать новый чат */
  suggestNewChat: boolean;
  /** Текст для показа пользователю */
  message: string;
  status: number;
}

/**
 * Разбирает ошибку генерации: понимает, переполнен ли контекст,
 * и готовит понятный текст с рекомендацией начать новый чат.
 */
function classifyChatError(err: any, settings: Settings): ClassifiedError {
  const raw = (err?.message || String(err || '')).trim();

  if (isOverflowErr(err)) {
    const hint = extractContextHint(raw);
    return {
      code: 'context_overflow',
      suggestNewChat: true,
      status: 400,
      message:
        'Контекст модели переполнен — диалог не помещается в окно. ' +
        (hint ? hint + ' ' : '') +
        'Начните новый чат: нажмите «Новый чат» — сессия и история будут очищены. ' +
        'Если нужно продолжить в том же диалоге — увеличьте «Контекст» в настройках ' +
        `или уменьшите «Max tokens» (сейчас контекст ${settings.context_size}, ответ до ${settings.max_tokens} токенов).`,
    };
  }

  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return {
      code: 'timeout',
      suggestNewChat: true,
      status: 504,
      message:
        'Модель не ответила вовремя. Чаще всего это перегруженный локальный сервер ' +
        'или слишком длинная база. Попробуйте начать новый чат или увеличьте таймаут в настройках.',
    };
  }

  if (raw.includes('ECONNREFUSED') || raw.includes('Не удалось подключиться')) {
    return {
      code: 'connection',
      suggestNewChat: false,
      status: 502,
      message:
        'Нет связи с моделью. Проверьте, что llama-server запущен, в разделе Настройки → Провайдер AI.',
    };
  }

  return {
    code: 'generic',
    suggestNewChat: false,
    status: 500,
    message: raw || 'Внутренняя ошибка генерации ответа',
  };
}

function loadSettings(): Settings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      // Сохранённые настройки главнее дефолтов: так запоминается последняя
      // настроенная модель и провайдер между перезапусками.
      const merged = { ...DEFAULT_SETTINGS, ...parsed };
      // Если провайдер локальный, а имя модели осталось облачным — подставляем
      // найденную локальную, чтобы в UI не светился gemini/deepseek.
      if (
        (merged.backend_provider === 'llama_cpp' || merged.backend_provider === 'ollama') &&
        (!parsed.model_name || /^(gemini|deepseek|gpt-|local-model)/i.test(parsed.model_name))
      ) {
        merged.model_name = FIRST_LOCAL_MODEL;
      }
      return merged;
    }
  } catch (err) {
    console.error('Error loading settings.json:', err);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings: Settings): void {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving settings.json:', err);
  }
}

let appSettings = loadSettings();

/** Проверяет, отвечает ли локальный llama-server / ollama. */
async function localServerReachable(isOllama: boolean): Promise<boolean> {
  const base = (appSettings.llama_server_url || 'http://127.0.0.1:8080').replace(/\/$/, '');
  const url = isOllama ? `${base}/api/tags` : `${base}/health`;
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(1500),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// In-memory conversation history
const DEFAULT_SYSTEM_PROMPT =
  'Ты полезный AI-ассистент LAIChat. Отвечай подробно, структурированно и по делу. ' +
  'Если в контексте передана база знаний — опирайся на неё и не придумывай факты, которых в ней нет.';

let chatHistory: ChatMessage[] = [
  {
    role: 'system',
    content: DEFAULT_SYSTEM_PROMPT,
  },
];

// Knowledge base frontmatter parsing & management
class BaseManager {
  private dir: string;
  private bases: Base[] = [];
  private loadErrs: string[] = [];

  constructor(dir: string) {
    this.dir = dir;
    this.reload();
  }

  public reload() {
    this.bases = [];
    this.loadErrs = [];

    if (!fs.existsSync(this.dir)) {
      return;
    }

    const files = fs.readdirSync(this.dir);
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      const fullPath = path.join(this.dir, f);
      try {
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const parsed = this.parseFrontmatter(raw, f);
        this.bases.push({
          ...parsed,
          filePath: fullPath,
        });
      } catch (err: any) {
        this.loadErrs.push(`Ошибка чтения ${f}: ${err?.message || err}`);
      }
    }

    this.bases.sort((a, b) => a.name.localeCompare(b.name));
  }

  private parseFrontmatter(raw: string, filename: string): { name: string; description: string; content: string } {
    let name = path.basename(filename, '.md');
    let description = '';
    let content = raw;

    const trimmed = raw.trim();
    if (trimmed.startsWith('---')) {
      const secondIdx = trimmed.indexOf('---', 3);
      if (secondIdx !== -1) {
        const frontmatter = trimmed.slice(3, secondIdx);
        content = trimmed.slice(secondIdx + 3).trim();

        const lines = frontmatter.split('\n');
        for (const line of lines) {
          const colonIdx = line.indexOf(':');
          if (colonIdx !== -1) {
            const key = line.slice(0, colonIdx).trim().toLowerCase();
            const val = line.slice(colonIdx + 1).trim();
            if (key === 'name' && val) {
              name = val;
            } else if (key === 'description' && val) {
              description = val;
            }
          }
        }
      }
    }

    return { name, description, content };
  }

  public all(): Base[] {
    return [...this.bases];
  }

  public count(): number {
    return this.bases.length;
  }

  public getByName(name: string): Base | undefined {
    const target = name.trim().toLowerCase();
    return this.bases.find((b) => b.name.trim().toLowerCase() === target);
  }

  public issues(): string[] {
    return [...this.loadErrs];
  }

  public save(name: string, description: string, content: string): Base {
    const cleanName = name.trim();
    if (!cleanName || cleanName.includes('/') || cleanName.includes('\\') || cleanName === '.' || cleanName === '..') {
      throw new Error('Недопустимое имя базы');
    }

    const fullPath = path.join(this.dir, `${cleanName}.md`);
    let body = '';
    if (description.trim()) {
      body += `---\nname: ${cleanName}\ndescription: ${description.trim()}\n---\n\n`;
    }
    body += content.trim() + '\n';

    fs.writeFileSync(fullPath, body, 'utf-8');

    const baseObj: Base = {
      name: cleanName,
      description: description.trim(),
      filePath: fullPath,
      content: content.trim() + '\n',
    };

    const existingIdx = this.bases.findIndex((b) => b.name.toLowerCase() === cleanName.toLowerCase());
    if (existingIdx >= 0) {
      this.bases[existingIdx] = baseObj;
    } else {
      this.bases.push(baseObj);
    }
    this.bases.sort((a, b) => a.name.localeCompare(b.name));

    return baseObj;
  }

  public delete(name: string): void {
    const cleanName = name.trim();
    const existing = this.getByName(cleanName);
    if (!existing) {
      throw new Error(`База не найдена: ${cleanName}`);
    }

    if (fs.existsSync(existing.filePath)) {
      fs.unlinkSync(existing.filePath);
    }

    this.bases = this.bases.filter((b) => b.name.toLowerCase() !== cleanName.toLowerCase());
  }
}

const baseManager = new BaseManager(BASES_DIR);

// BM25 Semantic chunk index for fast local retrieval
const bm25Index = new BM25Index();

function reindexAllBases(): void {
  const allBases = baseManager.all();
  const allChunks: DocumentChunk[] = [];
  for (const b of allBases) {
    const chunks = chunkMarkdownByHeadings(b.name, b.content);
    for (const c of chunks) {
      allChunks.push({
        id: c.id,
        baseName: b.name,
        heading: c.title,
        content: c.content,
        tokens: tokenize(c.content + ' ' + c.title),
        charCount: c.charCount,
      });
    }
  }
  bm25Index.setChunks(allChunks);
}

reindexAllBases();

// LLM execution wrapper
let geminiClient: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI {
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return geminiClient;
}

async function runLLM(
  messages: ChatMessage[],
  settings: Settings,
  overrideTemp?: number,
  overrideTokens?: number
): Promise<string> {
  const provider = settings.backend_provider || (process.env.GEMINI_API_KEY ? 'gemini' : 'llama_cpp');

  if (provider === 'gemini') {
    const ai = getGemini();
    const systemMsgs = messages.filter((m) => m.role === 'system');
    const systemInstruction = systemMsgs.map((m) => m.content).join('\n\n');

    const conversation = messages.filter((m) => m.role !== 'system');

    // Convert to Gemini contents format
    const contents = conversation.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    // If conversation is empty (e.g. system-only task), send prompt as user
    if (contents.length === 0) {
      contents.push({
        role: 'user',
        parts: [{ text: systemInstruction || 'Привет!' }],
      });
    }

    const modelsToTry = [
      'gemini-3.1-flash-lite-preview',
      'gemini-3-flash-preview',
      settings.model_name || 'gemini-3.5-flash',
    ].filter((m, idx, arr) => arr.indexOf(m) === idx);

    let lastError: any = null;
    for (const model of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: systemInstruction || undefined,
            temperature: overrideTemp !== undefined ? overrideTemp : (settings.temperature ?? 0.7),
            maxOutputTokens: overrideTokens !== undefined ? overrideTokens : (settings.max_tokens ?? 1024),
            topP: settings.top_p ?? 0.9,
          },
        });
        return response.text || '';
      } catch (err: any) {
        lastError = err;
        const errStr = (err?.message || '') + ' ' + (err?.status || '') + ' ' + JSON.stringify(err);
        const shouldFailover =
          errStr.includes('429') ||
          errStr.includes('RESOURCE_EXHAUSTED') ||
          errStr.includes('Quota') ||
          errStr.includes('503') ||
          errStr.includes('UNAVAILABLE') ||
          errStr.includes('high demand');

        if (shouldFailover) {
          console.warn(`Model ${model} unavailable (${errStr.slice(0, 80)}), failing over to next model...`);
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  // Cloud OpenAI-Compatible API (DeepSeek, OpenRouter, Groq, Together AI, OpenAI, vLLM, etc.)
  if (provider === 'openai_compatible') {
    const rawUrl = (settings.openai_base_url || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/$/, '');
    const endpoint = rawUrl.endsWith('/chat/completions')
      ? rawUrl
      : rawUrl.endsWith('/v1')
      ? `${rawUrl}/chat/completions`
      : `${rawUrl}/v1/chat/completions`;

    const apiKey = (settings.openai_api_key || process.env.OPENAI_API_KEY || '').trim();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    headers['HTTP-Referer'] = 'https://aistudio.google.com';
    headers['X-Title'] = 'LAIChat';

    const model = settings.model_name || 'deepseek-chat';

try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(resolveTimeoutMs(settings, 'gemini')),
      body: JSON.stringify({
          model,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          temperature: overrideTemp !== undefined ? overrideTemp : (settings.temperature ?? 0.7),
          max_tokens: overrideTokens !== undefined ? overrideTokens : (settings.max_tokens ?? 1024),
          top_p: settings.top_p ?? 0.9,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`OpenAI-compatible API (${rawUrl}) вернул статус ${resp.status}: ${errText.slice(0, 300)}`);
      }

      const data: any = await resp.json();
      return data.choices?.[0]?.message?.content || '';
    } catch (err: any) {
      if (err.name === 'TimeoutError') {
        throw new Error(`Таймаут соединения с OpenAI API (${rawUrl}). Сервер не ответил за 12 секунд.`);
      }
      if (err.message && err.message.includes('ECONNREFUSED')) {
        throw new Error(`Не удалось подключиться к OpenAI API по адресу ${rawUrl}. Проверьте адрес и доступность сервера.`);
      }
      throw err;
    }
  }

  // Local llama.cpp / Ollama endpoint
  const targetUrl = (settings.llama_server_url || 'http://127.0.0.1:8080').replace(/\/$/, '');
  const endpoint = targetUrl.endsWith('/chat/completions')
    ? targetUrl
    : `${targetUrl}/v1/chat/completions`;

try {
    const timeoutMs = resolveTimeoutMs(settings, provider);
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: settings.model_name || 'default',
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: overrideTemp !== undefined ? overrideTemp : settings.temperature,
        max_tokens: overrideTokens !== undefined ? overrideTokens : settings.max_tokens,
        top_p: settings.top_p,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      if (isContextOverflow(errText)) {
        throw new ContextOverflowError(
          `Контекст модели переполнен. ${extractContextHint(errText) || ''}`.trim()
        );
      }
      throw new Error(`LLM сервер вернул ошибку ${resp.status}: ${errText}`);
    }

    const data: any = await resp.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (err: any) {
    const timeoutSec = Math.round(resolveTimeoutMs(settings, provider) / 1000);
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      // Сохраняем name, чтобы classifyChatError узнал таймаут, а не «generic».
      const timeoutErr = new Error(
        `Локальный сервер ${targetUrl} не ответил за ${timeoutSec} сек. ` +
          `Увеличьте таймаут в настройках (сейчас ${timeoutSec} сек) или уменьшите Max tokens.`
      );
      timeoutErr.name = 'TimeoutError';
      throw timeoutErr;
    }
    if (err.message && err.message.includes('ECONNREFUSED')) {
      throw new Error(
        `Не удалось подключиться к ${targetUrl}. Убедитесь, что llama-server запущен, или переключитесь на Gemini/OpenAI в Настройках.`
      );
    }
    throw err;
  }
}

async function runLLMWithRetry(
  messages: ChatMessage[],
  settings: Settings,
  overrideTemp?: number,
  overrideTokens?: number,
  retries = 3
): Promise<string> {
  let lastErr: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await runLLM(messages, settings, overrideTemp, overrideTokens);
    } catch (err: any) {
      lastErr = err;
      const isRetryable =
        err?.message?.includes('503') ||
        err?.message?.includes('429') ||
        err?.message?.includes('UNAVAILABLE') ||
        err?.message?.includes('RESOURCE_EXHAUSTED');
      if (i < retries - 1 && isRetryable) {
        await new Promise((res) => setTimeout(res, 800 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

interface MultiBaseAnalysisResult {
  chosenName: string;
  analyses: BaseAnalysis[];
  /** Сколько занял вызов модели на анализ всех баз, мс */
  analysisMs: number;
}

// Unified multi-base parallel analysis & classification
async function performMultiBaseAnalysis(
  question: string,
  bases: Base[],
  settings: Settings
): Promise<MultiBaseAnalysisResult> {
  if (bases.length === 0) {
    return { chosenName: '', analyses: [], analysisMs: 0 };
  }

  const basesSummary = bases
    .map((b) => {
      let snippet = b.content.slice(0, 1500);
      if (b.content.length > 2000) {
        const baseMatches = bm25Index.search(question, 2, b.name);
        if (baseMatches.length > 0 && baseMatches[0].score > 0) {
          const topChunks = baseMatches
            .map((m) => `[Раздел: ${m.chunk.heading}]:\n${m.chunk.content.slice(0, 600)}`)
            .join('\n\n');
          snippet = `Вводная часть:\n${b.content.slice(0, 500)}\n\nНаиболее релевантные разделы по вопросу:\n${topChunks}`;
        }
      }
      return `### База: «${b.name}»\nТематика: ${b.description || 'Общие сведения'}\nСодержимое:\n${snippet}`;
    })
    .join('\n\n');

  const system =
    'Ты — аналитический модуль поиска и классификации знаний LAIChat.\n' +
    'Тебе даны базы знаний и вопрос пользователя.\n' +
    'Твоя задача — проанализировать ВСЕ базы параллельно:\n' +
    '1. Для КАЖДОЙ базы:\n' +
    '   - Если вопрос относится к этой базе и в ней есть факты — дать КРАТКИЙ ответ (1-2 предложения), опираясь на базу.\n' +
    '   - Если вопрос НЕ относится к этой базе — вернуть строго: N/A: <кратко причина>\n' +
    '2. Выбрать ОДНУ наиболее подходящую тему (поле chosen). Если ни одна не подходит — указать NONE.\n\n' +
    'Формат ответа — строго валидный JSON:\n' +
    '{\n' +
    '  "chosen": "Имя темы строго из списка или NONE",\n' +
    '  "analyses": [\n' +
    '    {"name": "Имя базы", "answer": "Краткий ответ или N/A: причина"}\n' +
    '  ]\n' +
    '}\n' +
    'Только чистый JSON без разметки markdown.';

  const user = `Базы знаний:\n${basesSummary}\n\nВопрос пользователя: ${question}`;

  const analysisStart = Date.now();
  try {
    const raw = await runLLMWithRetry(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      settings,
      0.2,
      1000,
      3
    );
    const analysisMs = Date.now() - analysisStart;

    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(cleaned);
    let chosenName = (parsed.chosen || '').trim();
    if (chosenName.toUpperCase() === 'NONE') chosenName = '';

    const validBase = bases.find((b) => b.name.toLowerCase() === chosenName.toLowerCase());
    if (validBase) {
      chosenName = validBase.name;
    } else {
      chosenName = '';
    }

    const analyses: BaseAnalysis[] = bases.map((b) => {
      const match = (parsed.analyses || []).find(
        (a: any) => a.name && a.name.toLowerCase() === b.name.toLowerCase()
      );
      const answer = match ? match.answer : 'N/A: вопрос не по теме';
      return {
        name: b.name,
        description: b.description,
        answer,
        chosen: chosenName ? b.name.toLowerCase() === chosenName.toLowerCase() : false,
      };
    });

    // If classifier did not choose, pick first non-N/A
    if (!chosenName) {
      for (const an of analyses) {
        const s = an.answer.trim().toUpperCase();
        if (!s.startsWith('N/A:') && !s.startsWith('N/A ')) {
          chosenName = an.name;
          an.chosen = true;
          break;
        }
      }
    }

    return { chosenName, analyses, analysisMs };
  } catch (err: any) {
    // Переполнение контекста при анализе: следующий вызов тоже не пройдёт,
    // поэтому показываем пользователю понятную ошибку, а не маскируем fallback'ом.
    if (isOverflowErr(err)) {
      throw err;
    }
    console.warn('Batch analysis fallback:', err);
    // Простой эвристический выбор, если модель не ответила
    const chosenName = heuristicSelectBase(question, bases);
    const analyses: BaseAnalysis[] = bases.map((b) => ({
      name: b.name,
      description: b.description,
      answer: b.name === chosenName ? 'Тема соответствует запросу пользователя' : 'N/A: тема не релевантна',
      chosen: b.name === chosenName,
    }));

    return { chosenName, analyses, analysisMs: Date.now() - analysisStart };
  }
}

/**
 * Выбор базы без обращения к модели — по вхождению имени базы в вопрос
 * или совпадению слов с её описанием. Используется как fallback и как
 * быстрый режим при отключённом параллельном анализе.
 */
function heuristicSelectBase(question: string, bases: Base[]): string {
  const lowerQ = question.toLowerCase();
  const matched = bases.find((b) =>
    lowerQ.includes(b.name.toLowerCase()) ||
    (b.description && lowerQ.split(/\s+/).some((w) => w.length > 3 && b.description.toLowerCase().includes(w)))
  );
  return matched ? matched.name : '';
}

function buildOtherHints(chosenName: string, analyses: BaseAnalysis[]): string {
  const hints: string[] = [];
  for (const a of analyses) {
    if (a.name.toLowerCase() === chosenName.toLowerCase()) continue;
    if (a.err || !a.answer) continue;

    const s = a.answer.trim();
    if (s.toUpperCase().startsWith('N/A:') || s.toUpperCase().startsWith('N/A ')) {
      continue;
    }
    hints.push(`- ${a.name}: ${s}`);
  }

  if (hints.length === 0) return '';
  return (
    '\n\n## Сводка ответов из других баз\n' +
    'Если одна из этих баз на самом деле релевантнее основной — упомяни это в ответе и предложи обратиться к ней.\n' +
    hints.join('\n')
  );
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Allow iframe embedding and cross-origin API calls
  app.use((req: Request, res: Response, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    // Если доступ из локальной сети (LAN) отключён пользователем,
    // блокируем прямые подключения с других устройств локальной сети (не loopback и не облачный прокси).
    if (appSettings.lan_access === false) {
      const forwarded = req.headers['x-forwarded-for'];
      const remoteAddr = req.socket.remoteAddress || '';
      const isLoopback =
        remoteAddr === '127.0.0.1' ||
        remoteAddr === '::1' ||
        remoteAddr === '::ffff:127.0.0.1';
      if (!isLoopback && !forwarded) {
        res.status(403).send('Доступ из локальной сети отключён в настройках LAIChat.');
        return;
      }
    }

    next();
  });

  // API Routes
  app.get('/api/state', async (req: Request, res: Response) => {
    const bases = baseManager.all();
    const provider = appSettings.backend_provider || DEFAULT_SETTINGS.backend_provider!;
    let serverUrl = 'Gemini (Cloud API)';
    if (provider === 'openai_compatible') {
      serverUrl = `OpenAI: ${appSettings.openai_base_url || 'https://api.openai.com/v1'} (${appSettings.model_name || 'deepseek-chat'})`;
    } else if (provider === 'llama_cpp' || provider === 'ollama') {
      serverUrl = `Local: ${appSettings.llama_server_url || 'http://127.0.0.1:8080'} (${appSettings.model_name || 'local'})`;
    }

    // Облаку нужен ключ, локальному серверу — только живой процесс.
    const isLocal = provider === 'llama_cpp' || provider === 'ollama';
    const hasKey = Boolean(
      process.env.OPENAI_API_KEY ||
      appSettings.openai_api_key ||
      provider === 'gemini'
    );
    const isHealthy = isLocal ? await localServerReachable(provider === 'ollama') : hasKey;

    res.json({
      config: {
        context_size: appSettings.context_size,
        threads: appSettings.threads,
        max_tokens: appSettings.max_tokens,
        temperature: appSettings.temperature,
        top_p: appSettings.top_p,
        backend_provider: provider,
        llama_server_url: appSettings.llama_server_url || 'http://127.0.0.1:8080',
        openai_base_url: appSettings.openai_base_url || 'https://api.openai.com/v1',
        openai_api_key: appSettings.openai_api_key
          ? '••••••••'
          : process.env.OPENAI_API_KEY
          ? '•••••••• (из .env)'
          : '',
        model_name: appSettings.model_name || DEFAULT_SETTINGS.model_name,
        request_timeout: Math.round(resolveTimeoutMs(appSettings, provider) / 1000),
        parallel_analysis: appSettings.parallel_analysis !== false,
        lan_access: appSettings.lan_access !== false,
      },
      server_url: serverUrl,
      is_healthy: isHealthy,
      openai_key_configured: Boolean(process.env.OPENAI_API_KEY || appSettings.openai_api_key),
      local_models: discoverLocalModels(),
      lan_ips: getLocalNetworkIPs(),
      port: PORT,
      bases_count: bases.length,
      msg_count: chatHistory.length,
      bases: bases.map((b) => ({
        name: b.name,
        description: b.description,
        path: b.filePath,
      })),
      issues: baseManager.issues(),
    });
  });

  // Локальные .gguf из папки models/ — для выбора модели в UI
  app.get('/api/models', (req: Request, res: Response) => {
    const models = discoverLocalModels();
    res.json({
      models,
      models_dir: MODELS_DIR,
      current: appSettings.model_name,
    });
  });

  // Характеристики железа ПК и список рекомендованных моделей с Hugging Face
  app.get('/api/hardware', (req: Request, res: Response) => {
    const specs = getHardwareSpecs();
    const downloadedFiles = new Set(
      discoverLocalModels().map((m) => `${m.toLowerCase()}.gguf`)
    );

    const models = CURATED_HF_MODELS.map((m) => {
      const isDownloaded = downloadedFiles.has(m.filename.toLowerCase());
      let fitStatus: 'optimal' | 'good' | 'heavy' = 'good';
      if (m.recommended_for.includes(specs.recommended_tier)) {
        fitStatus = 'optimal';
      } else if (m.min_ram_gb > specs.total_ram_gb) {
        fitStatus = 'heavy';
      }
      return {
        ...m,
        is_downloaded: isDownloaded,
        fit_status: fitStatus,
      };
    });

    res.json({
      hardware: specs,
      recommended_models: models,
    });
  });

  // Живой поиск GGUF-моделей на Hugging Face Hub API
  app.get('/api/hf-search', async (req: Request, res: Response) => {
    const q = String(req.query.q || '').trim();
    if (!q) {
      res.json({ results: [] });
      return;
    }

    try {
      const searchUrl = `https://huggingface.co/api/models?search=${encodeURIComponent(
        q + ' GGUF'
      )}&filter=gguf&sort=downloads&direction=-1&limit=8`;
      const resp = await fetch(searchUrl, {
        headers: { 'User-Agent': 'LAIChat-Model-Manager/1.0' },
        signal: AbortSignal.timeout(8000),
      });

      if (!resp.ok) {
        throw new Error(`Hugging Face API вернул статус ${resp.status}`);
      }

      const repos: any[] = await resp.json();
      const specs = getHardwareSpecs();
      const downloadedFiles = new Set(
        discoverLocalModels().map((m) => `${m.toLowerCase()}.gguf`)
      );

      // Для каждого найденного репозитория получаем список .gguf файлов
      const results: any[] = [];
      for (const r of repos.slice(0, 6)) {
        try {
          const detailResp = await fetch(`https://huggingface.co/api/models/${r.id}`, {
            headers: { 'User-Agent': 'LAIChat-Model-Manager/1.0' },
            signal: AbortSignal.timeout(5000),
          });
          if (!detailResp.ok) continue;
          const detail: any = await detailResp.json();
          const siblings: any[] = Array.isArray(detail.siblings) ? detail.siblings : [];
          const ggufFiles = siblings.filter(
            (s) => typeof s.rfilename === 'string' && s.rfilename.toLowerCase().endsWith('.gguf')
          );
          if (ggufFiles.length === 0) continue;

          // Предпочитаем Q4_K_M или Q4_0 или первый доступный .gguf
          const preferred =
            ggufFiles.find((f) => /q4_k_m/i.test(f.rfilename)) ||
            ggufFiles.find((f) => /q4/i.test(f.rfilename)) ||
            ggufFiles.find((f) => /q5_k_m/i.test(f.rfilename)) ||
            ggufFiles[0];

          const filename = path.basename(preferred.rfilename);
          const quantMatch = filename.match(/(Q[0-9]_[A-Z0-9_]+|F16|BF16|IQ[0-9]_[A-Z0-9_]+)/i);
          const quantization = quantMatch ? quantMatch[1].toUpperCase() : 'GGUF';

          const sizeBytes = preferred.size || 0;
          const sizeGb = sizeBytes
            ? Math.round((sizeBytes / 1024 ** 3) * 10) / 10
            : 3.5;
          const minRamGb = Math.max(2, Math.round(sizeGb * 1.4 * 10) / 10);

          let fitStatus: 'optimal' | 'good' | 'heavy' = 'good';
          if (minRamGb <= specs.total_ram_gb * 0.75) {
            fitStatus = 'optimal';
          } else if (minRamGb > specs.total_ram_gb) {
            fitStatus = 'heavy';
          }

          results.push({
            id: `${r.id}/${filename}`,
            name: r.id.split('/')[1] || r.id,
            repo: r.id,
            filename,
            download_url: `https://huggingface.co/${r.id}/resolve/main/${preferred.rfilename}`,
            size_gb: sizeGb,
            min_ram_gb: minRamGb,
            params: 'GGUF',
            quantization,
            context_length: 32768,
            description: `Репозиторий Hugging Face: ${r.id} (скачиваний: ${(
              r.downloads || 0
            ).toLocaleString('ru-RU')}, лайков: ${r.likes || 0})`,
            tags: ['HuggingFace Hub', quantization],
            is_downloaded: downloadedFiles.has(filename.toLowerCase()),
            fit_status: fitStatus,
          });
        } catch {
          // ignore individual repo fetch error
        }
      }

      res.json({ results });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Ошибка поиска на Hugging Face' });
    }
  });

  // Список активных и завершённых загрузок моделей
  app.get('/api/models/downloads', (req: Request, res: Response) => {
    const list = Array.from(activeDownloads.values()).map((d) => ({
      filename: d.filename,
      repo: d.repo,
      status: d.status,
      downloaded_bytes: d.downloaded_bytes,
      total_bytes: d.total_bytes,
      progress: d.progress,
      speed_mbps: d.speed_mbps,
      error: d.error,
    }));
    res.json({
      downloads: list,
      local_models: discoverLocalModels(),
    });
  });

  // Запуск скачивания выбранной GGUF-модели с Hugging Face в папку models/
  app.post('/api/models/download', async (req: Request, res: Response) => {
    const { download_url, filename, repo } = req.body || {};
    if (!download_url || !filename) {
      res.status(400).json({ error: 'Не указан URL или имя файла модели' });
      return;
    }

    const safeFilename = path.basename(String(filename)).replace(/[^a-zA-Z0-9._-]/g, '_');
    const finalFilename = safeFilename.toLowerCase().endsWith('.gguf')
      ? safeFilename
      : `${safeFilename}.gguf`;

    const existingTask = activeDownloads.get(finalFilename);
    if (existingTask && existingTask.status === 'downloading') {
      res.json({ ok: true, message: 'Модель уже скачивается', filename: finalFilename });
      return;
    }

    const destPath = path.join(MODELS_DIR, finalFilename);
    const tempPath = `${destPath}.part`;
    const abortController = new AbortController();

    const taskState: DownloadTaskState = {
      filename: finalFilename,
      repo: repo || 'HuggingFace',
      status: 'downloading',
      downloaded_bytes: 0,
      total_bytes: 0,
      progress: 0,
      speed_mbps: 0,
      abortController,
    };
    activeDownloads.set(finalFilename, taskState);

    // Запускаем потоковое скачивание в фоне
    (async () => {
      const startTime = Date.now();
      try {
        const response = await fetch(String(download_url), {
          headers: { 'User-Agent': 'LAIChat-Model-Downloader/1.0' },
          signal: abortController.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`Сервер Hugging Face вернул статус ${response.status}`);
        }

        const totalBytes = parseInt(response.headers.get('content-length') || '0', 10);
        taskState.total_bytes = totalBytes;

        const fileStream = fs.createWriteStream(tempPath);
        const reader = response.body.getReader();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            fileStream.write(Buffer.from(value));
            taskState.downloaded_bytes += value.byteLength;
            const elapsedSec = Math.max(0.5, (Date.now() - startTime) / 1000);
            taskState.speed_mbps =
              Math.round((taskState.downloaded_bytes / (1024 * 1024) / elapsedSec) * 10) / 10;
            if (taskState.total_bytes > 0) {
              taskState.progress = Math.min(
                99,
                Math.round((taskState.downloaded_bytes / taskState.total_bytes) * 100)
              );
            }
          }
        }

        await new Promise<void>((resolve, reject) => {
          fileStream.end(() => resolve());
          fileStream.on('error', reject);
        });

        fs.renameSync(tempPath, destPath);
        taskState.status = 'completed';
        taskState.progress = 100;
      } catch (err: any) {
        try {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch {
          // ignore cleanup error
        }
        if (err?.name === 'AbortError') {
          taskState.status = 'cancelled';
          taskState.error = 'Загрузка отменена пользователем';
        } else {
          taskState.status = 'error';
          taskState.error = err?.message || 'Ошибка при скачивании файла';
        }
      }
    })();

    res.json({
      ok: true,
      filename: finalFilename,
      models_dir: MODELS_DIR,
    });
  });

  // Отмена активного скачивания модели
  app.post('/api/models/cancel', (req: Request, res: Response) => {
    const { filename } = req.body || {};
    const task = activeDownloads.get(String(filename));
    if (task && task.status === 'downloading' && task.abortController) {
      task.abortController.abort();
      task.status = 'cancelled';
    }
    res.json({ ok: true });
  });

  // Скачивание готового установочного файла для Windows (LAIChat-Windows-Setup.bat)
  app.get('/api/installer/windows', (req: Request, res: Response) => {
    const installerPath = path.resolve(process.cwd(), 'installer', 'setup-windows.bat');
    if (!fs.existsSync(installerPath)) {
      res.status(404).json({ error: 'Файл установщика не найден' });
      return;
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="LAIChat-Windows-Setup.bat"');
    res.sendFile(installerPath);
  });

  // Включение/отключение доступа из локальной сети (LAN)
  app.post('/api/lan-access', (req: Request, res: Response) => {
    const enabled = req.body?.enabled !== undefined ? Boolean(req.body.enabled) : !(appSettings.lan_access !== false);
    appSettings = {
      ...appSettings,
      lan_access: enabled,
    };
    saveSettings(appSettings);
    const lanIps = getLocalNetworkIPs();
    res.json({
      ok: true,
      lan_access: enabled,
      lan_ips: lanIps,
      port: PORT,
      urls: lanIps.map((ip) => `http://${ip}:${PORT}`),
    });
  });

  app.post('/api/config', (req: Request, res: Response) => {
    const s = req.body;
    if (typeof s !== 'object' || !s) {
      res.status(400).json({ error: 'Неверные данные настроек' });
      return;
    }

    if (s.context_size !== undefined && (s.context_size < 256 || s.context_size > 262144)) {
      res.status(400).json({ error: 'context_size должен быть от 256 до 262144' });
      return;
    }
    if (s.max_tokens !== undefined && (s.max_tokens < 1 || s.max_tokens > 32768)) {
      res.status(400).json({ error: 'max_tokens должен быть от 1 до 32768' });
      return;
    }
    if (s.temperature !== undefined && (s.temperature < 0 || s.temperature > 2)) {
      res.status(400).json({ error: 'temperature должен быть от 0 до 2' });
      return;
    }
    if (s.top_p !== undefined && (s.top_p < 0 || s.top_p > 1)) {
      res.status(400).json({ error: 'top_p должен быть от 0 до 1' });
      return;
    }

    const updatedSettings = {
      ...appSettings,
      ...s,
    };

    // If client sent masked key or empty key but old key exists, retain old key
    if (
      s.openai_api_key !== undefined &&
      (s.openai_api_key.includes('••••') || s.openai_api_key.trim() === '')
    ) {
      updatedSettings.openai_api_key = appSettings.openai_api_key;
    }

    appSettings = updatedSettings;
    saveSettings(appSettings);
    res.json({ ok: true, settings: appSettings });
  });

  // Test provider connection
  app.post('/api/test-connection', async (req: Request, res: Response) => {
    try {
      const {
        backend_provider,
        openai_base_url,
        openai_api_key,
        model_name,
        llama_server_url,
      } = req.body;

      const testSettings: Settings = {
        ...appSettings,
        backend_provider: backend_provider || appSettings.backend_provider,
        openai_base_url: openai_base_url || appSettings.openai_base_url,
        openai_api_key:
          openai_api_key && !openai_api_key.includes('••••')
            ? openai_api_key
            : appSettings.openai_api_key || process.env.OPENAI_API_KEY,
        model_name: model_name || appSettings.model_name,
        llama_server_url: llama_server_url || appSettings.llama_server_url,
      };

      const testMsg: ChatMessage[] = [
        { role: 'user', content: 'Ответь кратко на русском: "Соединение успешно установлено"' },
      ];

      const reply = await runLLM(testMsg, testSettings, 0.1, 50);
      res.json({ ok: true, message: 'Соединение успешно проверено!', reply });
    } catch (err: any) {
      console.warn('Test connection error:', err);
      res.status(400).json({ ok: false, error: err?.message || 'Не удалось установить соединение' });
    }
  });

  app.post('/api/clear', (req: Request, res: Response) => {
    chatHistory = [
      {
        role: 'system',
        content: DEFAULT_SYSTEM_PROMPT,
      },
    ];
    res.json({ ok: true, msg_count: chatHistory.length });
  });

  app.post('/api/reload', (req: Request, res: Response) => {
    baseManager.reload();
    res.json({ ok: true, count: baseManager.count(), issues: baseManager.issues() });
  });

  app.post('/api/restart', (req: Request, res: Response) => {
    // Health check / server refresh
    baseManager.reload();
    res.json({ ok: true, message: 'Сервер и базы знаний обновлены' });
  });

  app.post('/api/chat', async (req: Request, res: Response) => {
    const { message } = req.body;
    const msg = (message || '').trim();
    if (!msg) {
      res.status(400).json({ error: 'Пустое сообщение' });
      return;
    }

    try {
      const requestStart = Date.now();
      chatHistory.push({ role: 'user', content: msg });
      const currentBases = baseManager.all();

      // Step 1 & 2: Multi-base parallel analysis & classification
      let analyses: BaseAnalysis[] = [];
      let chosenName = '';
      let analysisMs = 0;
      const parallelEnabled = appSettings.parallel_analysis !== false;

      if (currentBases.length > 0 && !parallelEnabled) {
        // Быстрый режим: база выбирается по словам, без вызова модели.
        // analyses остаётся пустым — панель параллельного анализа не нужна.
        chosenName = heuristicSelectBase(msg, currentBases);
      } else if (currentBases.length > 0) {
        const analysisResult = await performMultiBaseAnalysis(msg, currentBases, appSettings);
        analyses = analysisResult.analyses;
        chosenName = analysisResult.chosenName;
        analysisMs = analysisResult.analysisMs;
      }

      // Step 3: Synthesis with chosen base context
      const msgsToSend: ChatMessage[] = [];
      const historyCopy = [...chatHistory];

      // Add prior history
      msgsToSend.push(...historyCopy.slice(0, -1));

      if (chosenName) {
        const chosenBase = baseManager.getByName(chosenName);
        if (chosenBase) {
          const otherHints = buildOtherHints(chosenName, analyses);

          // Smart Section Retrieval for low-power local LLMs:
          // If the chosen base is larger than 1800 chars (e.g. multi-page document or converted DOCX/PDF),
          // retrieve the top 2-3 most relevant sections via BM25 instead of passing the entire document!
          let contextBody = chosenBase.content;
          if (chosenBase.content.length > 1800) {
            const matches = bm25Index.search(msg, 3, chosenName);

            if (matches.length > 0 && matches[0].score > 0) {
              contextBody = matches
                .map(
                  (m) =>
                    `### [Фрагмент из базы «${chosenBase.name}»: ${m.chunk.heading}]\n${m.chunk.content}`
                )
                .join('\n\n---\n\n');
            } else {
              contextBody = chosenBase.content.slice(0, 3000);
            }
          }

          const basePrompt =
            `Используй следующую базу знаний по теме «${chosenBase.name}» как ОСНОВНОЙ источник фактов. ` +
            `Если в ней нет ответа — так и скажи.\n\n` +
            `## База «${chosenBase.name}»\n${contextBody}${otherHints}`;

          msgsToSend.push({ role: 'system', content: basePrompt });
        }
      }

      // Add latest user query
      msgsToSend.push(historyCopy[historyCopy.length - 1]);

      const answerStart = Date.now();
      const response = await runLLMWithRetry(msgsToSend, appSettings, undefined, undefined, 3);
      const answerMs = Date.now() - answerStart;
      const totalMs = Date.now() - requestStart;
      chatHistory.push({ role: 'assistant', content: response });

      const timings = {
        analysis_mode: parallelEnabled ? ('parallel' as const) : ('heuristic' as const),
        analysis_ms: analysisMs,
        answer_ms: answerMs,
        total_ms: totalMs,
        bases_count: currentBases.length,
        response_chars: response.length,
      };
      console.log(
        `[chat] total=${totalMs}ms (${parallelEnabled ? `анализ ${analysisMs}ms по ${currentBases.length} базам` : 'анализ отключён'} + ответ ${answerMs}ms), ` +
          `источник=${chosenName || '—'}, ${response.length} симв.`
      );

      res.json({
        response,
        source: chosenName,
        analyses,
        timings,
      });
    } catch (err: any) {
      console.error('Chat error:', err);
      // Remove latest user query so it doesn't corrupt history
      if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].content === msg) {
        chatHistory.pop();
      }
      const classified = classifyChatError(err, appSettings);
      if (classified.suggestNewChat) {
        console.warn(`[chat] ${classified.code}: рекомендуем новый чат`);
      }
      res.status(classified.status).json({
        error: classified.message,
        code: classified.code,
        suggest_new_chat: classified.suggestNewChat,
      });
    }
  });

  // Fast BM25 Search endpoint
  app.post('/api/search', (req: Request, res: Response) => {
    const { query, topK, baseName } = req.body;
    const q = (query || '').trim();
    if (!q) {
      res.json({ results: [], totalChunks: bm25Index.getAllChunks().length });
      return;
    }
    const results = bm25Index.search(q, topK || 5, baseName);
    res.json({
      query: q,
      results: results.map((r) => ({
        baseName: r.chunk.baseName,
        heading: r.chunk.heading,
        snippet: r.chunk.content.slice(0, 300) + (r.chunk.content.length > 300 ? '…' : ''),
        score: Math.round(r.score * 100) / 100,
        matchedTerms: r.matchedTerms,
      })),
      totalChunks: bm25Index.getAllChunks().length,
    });
  });

  // Document conversion (DOCX/PDF to Markdown & chunks)
  app.post('/api/convert-doc', async (req: Request, res: Response) => {
    try {
      const { filename, dataBase64, strategy, chunkSize } = req.body;
      if (!filename || !dataBase64) {
        res.status(400).json({ error: 'Не передано имя файла или содержимое' });
        return;
      }

      const buffer = Buffer.from(dataBase64, 'base64');
      const { markdown, format } = await convertDocumentToMarkdown(filename, buffer);
      const cleanName = path.basename(filename, path.extname(filename));

      let chunks: ChunkInfo[] = [];
      if (strategy === 'size') {
        chunks = chunkMarkdownBySize(cleanName, markdown, chunkSize || 900);
      } else {
        chunks = chunkMarkdownByHeadings(cleanName, markdown, chunkSize || 1500);
      }

      res.json({
        filename,
        cleanName,
        format,
        markdown,
        charCount: markdown.length,
        chunks,
      });
    } catch (err: any) {
      console.error('Conversion error:', err);
      res.status(500).json({ error: `Ошибка конвертации документа: ${err?.message || err}` });
    }
  });

  // Import chunks into knowledge bases
  app.post('/api/import-chunks', (req: Request, res: Response) => {
    try {
      const { baseName, description, markdown, chunks, mode } = req.body;
      const cleanBase = (baseName || '').trim();
      if (!cleanBase) {
        res.status(400).json({ error: 'Укажите имя базы' });
        return;
      }

      if (mode === 'split-bases' && Array.isArray(chunks) && chunks.length > 0) {
        // Save each chunk as a separate sub-base with routing description
        const savedBases: string[] = [];
        for (let i = 0; i < chunks.length; i++) {
          const c: ChunkInfo = chunks[i];
          const subName = `${cleanBase}_раздел_${i + 1}`;
          const subDesc = c.description || `${cleanBase} - ${c.title}`;
          baseManager.save(subName, subDesc, c.content);
          savedBases.push(subName);
        }
        reindexAllBases();
        res.json({ ok: true, mode: 'split-bases', count: savedBases.length, bases: savedBases });
      } else {
        // Save as single base (with heading sections for BM25 retrieval)
        baseManager.save(cleanBase, description || '', markdown || '');
        reindexAllBases();
        res.json({ ok: true, mode: 'single-base', name: cleanBase });
      }
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Ошибка сохранения базы' });
    }
  });

  // Knowledge bases CRUD
  app.get('/api/bases', (req: Request, res: Response) => {
    const bases = baseManager.all();
    res.json(
      bases.map((b) => ({
        name: b.name,
        description: b.description,
        path: b.filePath,
      }))
    );
  });

  app.get('/api/bases/:name', (req: Request, res: Response) => {
    const base = baseManager.getByName(req.params.name);
    if (!base) {
      res.status(404).json({ error: 'База не найдена' });
      return;
    }
    res.json({
      name: base.name,
      description: base.description,
      content: base.content,
      path: base.filePath,
    });
  });

  app.post('/api/bases', (req: Request, res: Response) => {
    const { name, description, content } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Необходимо указать имя базы' });
      return;
    }
    try {
      const saved = baseManager.save(name, description || '', content || '');
      reindexAllBases();
      res.json({ name: saved.name, path: saved.filePath });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Ошибка создания базы' });
    }
  });

  app.put('/api/bases/:name', (req: Request, res: Response) => {
    const { description, content } = req.body;
    const name = req.params.name;
    try {
      const saved = baseManager.save(name, description || '', content || '');
      reindexAllBases();
      res.json({ ok: true, name: saved.name });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Ошибка обновления базы' });
    }
  });

  app.delete('/api/bases/:name', (req: Request, res: Response) => {
    const name = req.params.name;
    try {
      baseManager.delete(name);
      reindexAllBases();
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Ошибка удаления базы' });
    }
  });

  // Generate description for base using LLM
  app.post('/api/generate-description', async (req: Request, res: Response) => {
    try {
      const { name, content } = req.body;
      const cleanContent = (content || '').trim();
      const cleanName = (name || '').trim();

      if (!cleanContent && !cleanName) {
        res.status(400).json({ error: 'Заполните название или содержимое базы' });
        return;
      }

      const sample = cleanContent.slice(0, 3500);
      const system =
        'Ты — эксперт по информационному поиску и RAG-системам.\n' +
        'Тебе дано содержимое (или черновик) базы знаний.\n' +
        'Твоя задача — составить связное и ёмкое описание (1-2 полных предложения, 25-45 слов) для классификатора тем LAIChat.\n' +
        'Правила:\n' +
        '- Описание должно перечислять ключевые темы, термины и типичные вопросы пользователей, на которые отвечает эта база.\n' +
        '- Верни ТОЛЬКО законченный текст описания на русском языке.\n' +
        '- Не обрывай предложение на середине, без кавычек и префиксов.';

      const user = `Название базы: ${cleanName || 'База знаний'}\n\nФрагмент содержимого:\n${sample || 'Общие сведения'}`;

      const generated = await runLLMWithRetry(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        appSettings,
        0.3,
        300,
        3
      );

      const description = generated.trim().replace(/^["'`«]+|["'`»]+$/g, '');
      res.json({ ok: true, description });
    } catch (err: any) {
      console.error('Error generating description:', err);
      res.status(500).json({ error: err?.message || 'Не удалось сгенерировать описание' });
    }
  });

  // Vite middleware in dev or static files in production
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`LAIChat server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
