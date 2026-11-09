export interface Base {
  name: string;
  description: string;
  path?: string;
  content?: string;
}

export type BackendProvider =
  | 'gemini'
  | 'openai_compatible'
  | 'llama_cpp'
  | 'ollama';

export interface Settings {
  context_size: number;
  threads: number;
  max_tokens: number;
  temperature: number;
  top_p: number;
  backend_provider?: BackendProvider;
  llama_server_url?: string;
  openai_base_url?: string;
  openai_api_key?: string;
  model_name?: string;
  /** Таймаут одного запроса к модели, секунды */
  request_timeout?: number;
  /** Параллельный анализ всех баз перед ответом */
  parallel_analysis?: boolean;
  /** Доступность веб-интерфейса из локальной сети (LAN) */
  lan_access?: boolean;
}

export interface BaseAnalysis {
  name: string;
  description: string;
  answer: string;
  err?: string;
  chosen: boolean;
}

/** Замеры времени выполнения одного запроса к модели */
export interface ChatTimings {
  /** Как выбиралась база: параллельный анализ или быстрый режим */
  analysis_mode: 'parallel' | 'heuristic';
  /** Вызов модели на анализ всех баз, мс */
  analysis_ms: number;
  /** Вызов модели на генерацию ответа, мс */
  answer_ms: number;
  /** Всё вместе, мс */
  total_ms: number;
  bases_count: number;
  response_chars: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  source?: string;
  analyses?: BaseAnalysis[];
  timings?: ChatTimings;
  /** Сообщение об ошибке — подсвечивается особым цветом */
  isError?: boolean;
  /** Показать кнопку «Новый чат» (после переполнения контекста/таймаута) */
  action?: 'new_chat';
  timestamp: number;
}

export interface ServerState {
  config: Settings;
  server_url: string;
  is_healthy: boolean;
  bases_count: number;
  msg_count: number;
  bases: Base[];
  issues: string[];
  openai_key_configured?: boolean;
  /** .gguf, найденные в папке models/ */
  local_models?: string[];
  /** Есть ли в папке models/ хоть одна модель */
  model_present?: boolean;
  /** Локальные IPv4-адреса в LAN */
  lan_ips?: string[];
  /** Порт веб-сервера */
  port?: number;
}

export interface ToastMessage {
  id: string;
  text: string;
  type: 'ok' | 'err' | 'info';
}

export interface HardwareSpecs {
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

export interface HuggingFaceModel {
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
  recommended_for?: ('low' | 'medium' | 'high' | 'ultra')[];
  is_downloaded?: boolean;
  fit_status?: 'optimal' | 'good' | 'heavy';
  /** Модель по умолчанию — предлагается первой */
  is_default?: boolean;
}

export interface ModelDownloadTask {
  filename: string;
  repo: string;
  status: 'downloading' | 'completed' | 'error' | 'cancelled';
  downloaded_bytes: number;
  total_bytes: number;
  progress: number;
  speed_mbps: number;
  error?: string;
}

