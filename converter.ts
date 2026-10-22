import * as mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { DocumentChunk, tokenize } from './searchEngine';

export interface ChunkInfo {
  id: string;
  index: number;
  title: string;
  description: string;
  content: string;
  charCount: number;
  wordCount: number;
}

export interface ConversionResult {
  filename: string;
  originalFormat: 'docx' | 'pdf' | 'md' | 'txt';
  markdown: string;
  charCount: number;
  chunks: ChunkInfo[];
}

/**
 * Completely removes images, HTML img tags, and base64 image data from markdown
 */
export function cleanMarkdownImages(text: string): string {
  if (!text) return '';
  return text
    // Remove base64 data URIs in markdown images: *![alt](data:image/...)* or ![alt](data:image/...)
    .replace(/\*?!\[[^\]]*\]\(data:image\/[^)]+\)\*?/gi, '')
    // Remove any standard markdown images: *![alt](url)* or ![alt](url)
    .replace(/\*?!\[[^\]]*\]\([^)]+\)\*?/gi, '')
    // Remove reference-style markdown images: ![alt][ref]
    .replace(/\*?!\[[^\]]*\]\[[^\]]*\]\*?/gi, '')
    // Remove HTML img tags: <img ... />
    .replace(/<img\b[^>]*\/?>/gi, '')
    // Remove standalone base64 blobs (leaked image strings)
    .replace(/data:image\/[a-zA-Z0-9+\\/_-]+;base64,[A-Za-z0-9+/=\s\\]{40,}/gi, '')
    // Remove raw embedded SVG tags
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '')
    // Clean up empty emphasis markers on their own lines (e.g. leftover ** or _)
    .replace(/^\s*[*_]{1,4}\s*$/gm, '')
    // Clean up excessive blank lines left behind
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function convertDocumentToMarkdown(
  filename: string,
  buffer: Buffer
): Promise<{ markdown: string; format: 'docx' | 'pdf' | 'md' | 'txt' }> {
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  if (ext === 'docx') {
    const customOptions = {
      ignoreEmptyParagraphs: true,
      convertImage: (mammoth as any).images?.imgElement
        ? (mammoth as any).images.imgElement(() => Promise.resolve({}))
        : undefined,
    };
    const result = await (mammoth as any).convertToMarkdown({ buffer }, customOptions);
    let md = (result.value || '').trim();
    md = cleanMarkdownImages(md);
    return { markdown: md, format: 'docx' };
  }

  if (ext === 'pdf') {
    try {
      const parser = new (PDFParse as any)({ data: buffer, verbosity: 0 });
      await parser.load();
      const textResult = await parser.getText();
      const text = typeof textResult === 'string' ? textResult : (textResult?.text || '');

      const rawPages: string[] = text.split(/\f|\n(?=Page \d+|\f|\d+\s+of\s+\d+)/i);
      let md = '';

      if (rawPages.length > 1) {
        md = rawPages
          .map((p: string, idx: number) => {
            const trimmed = p.trim();
            if (!trimmed) return '';
            return `## Раздел (Страница ${idx + 1})\n\n${trimmed}`;
          })
          .filter(Boolean)
          .join('\n\n---\n\n');
      } else {
        const lines: string[] = text.split('\n');
        const formattedLines: string[] = [];
        for (const line of lines) {
          const trimmed = line.trim();
          if (
            /^(\d+\.|\d+\.\d+\.?|[A-ZА-ЯЁ\s]{4,}|Глава|Раздел|Статья)\s+[A-ZА-ЯЁ]/u.test(trimmed) &&
            trimmed.length < 80
          ) {
            formattedLines.push(`\n## ${trimmed}\n`);
          } else {
            formattedLines.push(trimmed);
          }
        }
        md = formattedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
      }

      md = cleanMarkdownImages(md || text);
      return { markdown: md, format: 'pdf' };
    } catch (err: any) {
      console.warn('PDF parsing error fallback:', err);
      const rawText = buffer.toString('utf-8');
      return { markdown: cleanMarkdownImages(rawText), format: 'pdf' };
    }
  }

  // Fallback for .md, .txt
  const text = buffer.toString('utf-8');
  return { markdown: cleanMarkdownImages(text), format: ext === 'md' ? 'md' : 'txt' };
}

/**
 * Splits Markdown into semantic chunks by headings (#, ##, ###)
 */
export function chunkMarkdownByHeadings(
  baseName: string,
  markdown: string,
  maxChunkSize = 1500
): ChunkInfo[] {
  const lines = markdown.split('\n');
  const sections: { title: string; lines: string[] }[] = [];
  let currentTitle = 'Введение';
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      if (currentLines.length > 0) {
        sections.push({ title: currentTitle, lines: currentLines });
      }
      const rawTitle = headingMatch[2]
        .replace(/<[^>]+>/g, '')
        .replace(/\\([._\-[\]()])/g, '$1')
        .replace(/[*_`]/g, '')
        .trim();
      currentTitle = rawTitle || 'Раздел';
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    sections.push({ title: currentTitle, lines: currentLines });
  }

  if (sections.length <= 1 && markdown.length > maxChunkSize) {
    return chunkMarkdownBySize(baseName, markdown, maxChunkSize);
  }

  const chunks: ChunkInfo[] = [];
  let chunkIdx = 1;

  for (const s of sections) {
    const text = s.lines.join('\n').trim();
    if (!text) continue;

    if (text.length <= maxChunkSize) {
      const words = text.split(/\s+/).filter(Boolean);
      chunks.push({
        id: `${baseName}_part${chunkIdx}`,
        index: chunkIdx,
        title: s.title,
        description: generateSectionDescription(s.title, text),
        content: text,
        charCount: text.length,
        wordCount: words.length,
      });
      chunkIdx++;
    } else {
      const paragraphs = text.split(/\n\s*\n/);
      let buf: string[] = [];
      let subIdx = 1;

      for (const p of paragraphs) {
        if ((buf.join('\n\n') + p).length > maxChunkSize && buf.length > 0) {
          const subText = buf.join('\n\n').trim();
          chunks.push({
            id: `${baseName}_part${chunkIdx}_${subIdx}`,
            index: chunkIdx,
            title: `${s.title} (часть ${subIdx})`,
            description: generateSectionDescription(s.title, subText),
            content: subText,
            charCount: subText.length,
            wordCount: subText.split(/\s+/).filter(Boolean).length,
          });
          subIdx++;
          buf = [p];
        } else {
          buf.push(p);
        }
      }

      if (buf.length > 0) {
        const subText = buf.join('\n\n').trim();
        chunks.push({
          id: `${baseName}_part${chunkIdx}_${subIdx}`,
          index: chunkIdx,
          title: subIdx === 1 ? s.title : `${s.title} (часть ${subIdx})`,
          description: generateSectionDescription(s.title, subText),
          content: subText,
          charCount: subText.length,
          wordCount: subText.split(/\s+/).filter(Boolean).length,
        });
      }
      chunkIdx++;
    }
  }

  return chunks;
}

/**
 * Splits Markdown into fixed-size chunks with overlapping context window
 */
export function chunkMarkdownBySize(
  baseName: string,
  markdown: string,
  chunkSize = 900,
  overlap = 150
): ChunkInfo[] {
  const chunks: ChunkInfo[] = [];
  const paragraphs = markdown.split(/\n\s*\n/);
  let currentChunk: string[] = [];
  let currentLen = 0;
  let chunkIdx = 1;

  for (const p of paragraphs) {
    if (currentLen + p.length > chunkSize && currentChunk.length > 0) {
      const text = currentChunk.join('\n\n').trim();
      const firstLine = text.split('\n')[0].replace(/^#+\s*/, '').slice(0, 50);
      chunks.push({
        id: `${baseName}_chunk${chunkIdx}`,
        index: chunkIdx,
        title: firstLine || `Фрагмент ${chunkIdx}`,
        description: generateSectionDescription(firstLine, text),
        content: text,
        charCount: text.length,
        wordCount: text.split(/\s+/).filter(Boolean).length,
      });
      chunkIdx++;

      const lastP = currentChunk[currentChunk.length - 1];
      if (lastP && lastP.length < overlap) {
        currentChunk = [lastP, p];
        currentLen = lastP.length + p.length;
      } else {
        currentChunk = [p];
        currentLen = p.length;
      }
    } else {
      currentChunk.push(p);
      currentLen += p.length;
    }
  }

  if (currentChunk.length > 0) {
    const text = currentChunk.join('\n\n').trim();
    const firstLine = text.split('\n')[0].replace(/^#+\s*/, '').slice(0, 50);
    chunks.push({
      id: `${baseName}_chunk${chunkIdx}`,
      index: chunkIdx,
      title: firstLine || `Фрагмент ${chunkIdx}`,
      description: generateSectionDescription(firstLine, text),
      content: text,
      charCount: text.length,
      wordCount: text.split(/\s+/).filter(Boolean).length,
    });
  }

  return chunks;
}

function generateSectionDescription(title: string, content: string): string {
  const cleanTitle = (title || '')
    .replace(/<[^>]+>/g, '')
    .replace(/[#*`_\[\]]/g, '')
    .replace(/\\([._\-[\]()])/g, '$1')
    .trim();

  const tokens = tokenize(content);
  const freq: Map<string, number> = new Map();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  const topKeywords = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map((e) => e[0]);

  const preview = content
    .replace(/^#+\s+[^\n]+\n*/, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[#*`_\[\]]/g, '')
    .replace(/\\([._\-[\]()])/g, '$1')
    .slice(0, 160)
    .replace(/\s+/g, ' ')
    .trim();

  const keywordsStr = topKeywords.length > 0 ? ` Ключевые понятия: ${topKeywords.join(', ')}.` : '';
  return `${cleanTitle}.${keywordsStr} ${preview}`.trim();
}
