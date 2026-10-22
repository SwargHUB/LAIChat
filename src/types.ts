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
}

export interface BaseAnalysis {
  name: string;
  description: string;
  answer: string;
  err?: string;
  chosen: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  source?: string;
  analyses?: BaseAnalysis[];
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
}

export interface ToastMessage {
  id: string;
  text: string;
  type: 'ok' | 'err' | 'info';
}
