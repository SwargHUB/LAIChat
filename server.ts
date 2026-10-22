import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
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

// Ensure bases directory exists
if (!fs.existsSync(BASES_DIR)) {
  fs.mkdirSync(BASES_DIR, { recursive: true });
}

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

// Default settings
const DEFAULT_SETTINGS: Settings = {
  context_size: 4096,
  threads: 8,
  max_tokens: 1024,
  temperature: 0.7,
  top_p: 0.9,
  backend_provider: process.env.GEMINI_API_KEY ? 'gemini' : 'openai_compatible',
  llama_server_url: 'http://127.0.0.1:8080',
  openai_base_url: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  openai_api_key: process.env.OPENAI_API_KEY || '',
  model_name: 'gemini-3.5-flash',
};

function loadSettings(): Settings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed };
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
        signal: AbortSignal.timeout(12000),
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
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(12000),
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
      throw new Error(`LLM сервер вернул ошибку ${resp.status}: ${errText}`);
    }

    const data: any = await resp.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (err: any) {
    if (err.name === 'TimeoutError') {
      throw new Error(`Таймаут подключения к локальному серверу (${targetUrl}).`);
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
}

// Unified multi-base parallel analysis & classification
async function performMultiBaseAnalysis(
  question: string,
  bases: Base[],
  settings: Settings
): Promise<MultiBaseAnalysisResult> {
  if (bases.length === 0) {
    return { chosenName: '', analyses: [] };
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

    return { chosenName, analyses };
  } catch (err: any) {
    console.warn('Batch analysis fallback:', err);
    // Simple heuristic fallback if error
    const lowerQ = question.toLowerCase();
    const matched = bases.find((b) =>
      lowerQ.includes(b.name.toLowerCase()) ||
      (b.description && lowerQ.split(/\s+/).some((w) => w.length > 3 && b.description.toLowerCase().includes(w)))
    );

    const chosenName = matched ? matched.name : '';
    const analyses: BaseAnalysis[] = bases.map((b) => ({
      name: b.name,
      description: b.description,
      answer: b.name === chosenName ? 'Тема соответствует запросу пользователя' : 'N/A: тема не релевантна',
      chosen: b.name === chosenName,
    }));

    return { chosenName, analyses };
  }
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
    next();
  });

  // API Routes
  app.get('/api/state', (req: Request, res: Response) => {
    const bases = baseManager.all();
    const provider = appSettings.backend_provider || 'gemini';
    let serverUrl = 'Gemini (Cloud API)';
    if (provider === 'openai_compatible') {
      serverUrl = `OpenAI: ${appSettings.openai_base_url || 'https://api.openai.com/v1'} (${appSettings.model_name || 'deepseek-chat'})`;
    } else if (provider === 'llama_cpp' || provider === 'ollama') {
      serverUrl = `Local: ${appSettings.llama_server_url || 'http://127.0.0.1:8080'} (${appSettings.model_name || 'local'})`;
    }

    const hasKey = Boolean(
      process.env.OPENAI_API_KEY ||
      appSettings.openai_api_key ||
      provider === 'gemini'
    );

    res.json({
      config: {
        context_size: appSettings.context_size,
        threads: appSettings.threads,
        max_tokens: appSettings.max_tokens,
        temperature: appSettings.temperature,
        top_p: appSettings.top_p,
        backend_provider: appSettings.backend_provider || 'gemini',
        llama_server_url: appSettings.llama_server_url || 'http://127.0.0.1:8080',
        openai_base_url: appSettings.openai_base_url || 'https://api.openai.com/v1',
        openai_api_key: appSettings.openai_api_key
          ? '••••••••'
          : process.env.OPENAI_API_KEY
          ? '•••••••• (из .env)'
          : '',
        model_name: appSettings.model_name || 'gemini-3.5-flash',
      },
      server_url: serverUrl,
      is_healthy: hasKey,
      openai_key_configured: Boolean(process.env.OPENAI_API_KEY || appSettings.openai_api_key),
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

  app.post('/api/config', (req: Request, res: Response) => {
    const s = req.body;
    if (typeof s !== 'object' || !s) {
      res.status(400).json({ error: 'Неверные данные настроек' });
      return;
    }

    if (s.context_size !== undefined && (s.context_size < 256 || s.context_size > 65536)) {
      res.status(400).json({ error: 'context_size должен быть от 256 до 65536' });
      return;
    }
    if (s.max_tokens !== undefined && (s.max_tokens < 1 || s.max_tokens > 8192)) {
      res.status(400).json({ error: 'max_tokens должен быть от 1 до 8192' });
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
      chatHistory.push({ role: 'user', content: msg });
      const currentBases = baseManager.all();

      // Step 1 & 2: Multi-base parallel analysis & classification
      let analyses: BaseAnalysis[] = [];
      let chosenName = '';
      if (currentBases.length > 0) {
        const analysisResult = await performMultiBaseAnalysis(msg, currentBases, appSettings);
        analyses = analysisResult.analyses;
        chosenName = analysisResult.chosenName;
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

      const response = await runLLMWithRetry(msgsToSend, appSettings, undefined, undefined, 3);
      chatHistory.push({ role: 'assistant', content: response });

      res.json({
        response,
        source: chosenName,
        analyses,
      });
    } catch (err: any) {
      console.error('Chat error:', err);
      // Remove latest user query so it doesn't corrupt history
      if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].content === msg) {
        chatHistory.pop();
      }
      res.status(500).json({ error: err?.message || 'Внутренняя ошибка генерации ответа' });
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
