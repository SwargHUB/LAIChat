/**
 * Lightweight, zero-dependency BM25 & Semantic Section Search Engine
 * Specifically designed for fast local retrieval with low-power LLMs.
 */

export interface DocumentChunk {
  id: string;
  baseName: string;
  heading: string;
  content: string;
  tokens: string[];
  charCount: number;
}

export interface SearchResult {
  chunk: DocumentChunk;
  score: number;
  matchedTerms: string[];
}

// Common Russian and English stop words to filter out noise
const STOP_WORDS = new Set([
  'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все',
  'она', 'так', 'его', 'но', 'да', 'ты', 'к', 'у', 'же', 'вы', 'за', 'бы', 'по',
  'только', 'ее', 'мне', 'было', 'вот', 'от', 'меня', 'еще', 'нет', 'о', 'из',
  'ему', 'теперь', 'когда', 'даже', 'ну', 'вдруг', 'ли', 'если', 'уже', 'или',
  'ни', 'быть', 'был', 'него', 'до', 'вас', 'нибудь', 'опять', 'уж', 'вам', 'ведь',
  'там', 'потом', 'себя', 'ничего', 'ей', 'может', 'они', 'тут', 'где', 'есть',
  'надо', 'ней', 'для', 'мы', 'тебя', 'их', 'чем', 'была', 'сам', 'чтоб', 'без',
  'будто', 'чего', 'раз', 'тоже', 'себе', 'под', 'будет', 'ж', 'тогда', 'кто',
  'этот', 'того', 'потому', 'этого', 'какой', 'совсем', 'ним', 'здесь', 'этом',
  'один', 'почти', 'мой', 'тем', 'чтобы', 'нее', 'сейчас', 'были', 'куда', 'зачем',
  'всех', 'никогда', 'можно', 'при', 'наконец', 'два', 'об', 'другой', 'хоть',
  'после', 'над', 'больше', 'тот', 'через', 'эти', 'нас', 'про', 'всего', 'них',
  'какая', 'много', 'разве', 'три', 'эту', 'моя', 'впрочем', 'хорошо', 'свою',
  'этой', 'перед', 'иногда', 'лучше', 'чуть', 'том', 'нельзя', 'такой', 'им',
  'более', 'всегда', 'вместе', 'the', 'a', 'an', 'is', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'and', 'or', 'as', 'by', 'that', 'this', 'it', 'from', 'are', 'be',
  'toc', 'hlk', 'id', 'href', 'img', 'image', 'png', 'base64', 'data', 'span', 'div',
  'table', 'tr', 'td', 'p', 'br', 'target', 'blank', 'rel',
]);

export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ') // Strip HTML tags
    .replace(/[^\p{L}\p{N}_\s-]/gu, ' ')
    .split(/[\s,.;:!?()\[\]{}"'`«»—–\/\\]+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w) && !/^_+$/.test(w));
}

export class BM25Index {
  private chunks: DocumentChunk[] = [];
  private avgDocLength = 0;
  private docFrequencies: Map<string, number> = new Map();
  private totalDocs = 0;

  // BM25 tuning parameters
  private readonly k1 = 1.5;
  private readonly b = 0.75;

  public setChunks(chunks: DocumentChunk[]): void {
    this.chunks = chunks;
    this.totalDocs = chunks.length;
    this.docFrequencies.clear();

    if (this.totalDocs === 0) {
      this.avgDocLength = 0;
      return;
    }

    let totalTokens = 0;
    for (const chunk of chunks) {
      totalTokens += chunk.tokens.length;
      const uniqueTokens = new Set(chunk.tokens);
      for (const t of uniqueTokens) {
        this.docFrequencies.set(t, (this.docFrequencies.get(t) || 0) + 1);
      }
    }
    this.avgDocLength = totalTokens / this.totalDocs;
  }

  public search(query: string, topK = 3, baseNameFilter?: string): SearchResult[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0 || this.totalDocs === 0) {
      return [];
    }

    const scores: { chunk: DocumentChunk; score: number; matchedTerms: string[] }[] = [];

    for (const chunk of this.chunks) {
      if (baseNameFilter && chunk.baseName.toLowerCase() !== baseNameFilter.toLowerCase()) {
        continue;
      }
      let score = 0;
      const matched: string[] = [];

      // Calculate term frequencies in current chunk
      const tfMap: Map<string, number> = new Map();
      for (const t of chunk.tokens) {
        tfMap.set(t, (tfMap.get(t) || 0) + 1);
      }

      for (const qTerm of queryTokens) {
        // Direct match or prefix match (important for Russian inflections!)
        let freq = tfMap.get(qTerm) || 0;
        let matchedTerm = qTerm;

        if (freq === 0) {
          // Check for root / prefix match if length >= 4
          if (qTerm.length >= 4) {
            const stem = qTerm.slice(0, Math.min(qTerm.length - 1, 6));
            for (const [chunkTerm, count] of tfMap.entries()) {
              if (chunkTerm.startsWith(stem)) {
                freq += count * 0.75;
                matchedTerm = chunkTerm;
              }
            }
          }
        }

        if (freq > 0) {
          matched.push(matchedTerm);
          const df = this.docFrequencies.get(qTerm) || 1;
          // Standard IDF formula
          const idf = Math.log(1 + (this.totalDocs - df + 0.5) / (df + 0.5));
          const num = freq * (this.k1 + 1);
          const den = freq + this.k1 * (1 - this.b + this.b * (chunk.tokens.length / (this.avgDocLength || 1)));
          score += idf * (num / den);

          // Boost if term matches heading
          if (chunk.heading.toLowerCase().includes(qTerm)) {
            score += 2.0;
          }
        }
      }

      if (score > 0) {
        scores.push({ chunk, score, matchedTerms: Array.from(new Set(matched)) });
      }
    }

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }

  public getAllChunks(): DocumentChunk[] {
    return this.chunks;
  }
}
