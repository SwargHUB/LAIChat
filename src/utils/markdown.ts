/**
 * Lightweight, safe Markdown to HTML renderer based on LAIChat's original MD engine.
 */
function escapeHtml(s: string): string {
  return (s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c] || c));
}

function renderInline(s: string): string {
  const codeStash: string[] = [];
  // Stash backtick inline code first so inner asterisks/underscores are preserved
  s = s.replace(/`([^`\n]+)`/g, (_, code) => {
    codeStash.push(escapeHtml(code));
    return `\x00C${codeStash.length - 1}\x00`;
  });

  s = escapeHtml(s);

  // Bold
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');

  // Italic
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');

  // Links
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => {
    const safeUrl = escapeHtml(url);
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // Restore stashed inline code
  s = s.replace(/\x00C(\d+)\x00/g, (_, idx) => {
    return `<code>${codeStash[+idx]}</code>`;
  });

  return s;
}

// Строка — элемент списка: отступ, маркер и текст
const LIST_ITEM_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

/**
 * Разбирает маркированный или нумерованный список в один HTML-элемент.
 *
 * Важно: пункты одного списка собираются в ЕДИНЫЙ <ol>/<ul>, даже если
 * между ними пустые строки. Раньше каждая пустая строка разрывала список,
 * и для каждого пункта создавался свой <ol> — браузер нумеровал каждый
 * такой список с единицы, получалось «1. 1. 1. 1.» вместо «1. 2. 3. 4.».
 * Здесь же поддерживается вложенность: подпункты с большим отступом
 * попадают внутрь родительского <li>.
 */
function parseList(
  lines: string[],
  start: number,
  baseIndent: number,
  ordered: boolean
): { html: string; next: number } {
  const items: { text: string; sub: string[] }[] = [];
  let current: { text: string; sub: string[] } | null = null;
  let startNumber = 1;
  let i = start;

  while (i < lines.length) {
    const line = lines[i];

    // Пустая строка: пропускаем её, если список дальше продолжается
    if (line.trim() === '') {
      let j = i;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j >= lines.length) {
        i = j;
        break;
      }
      const m = LIST_ITEM_RE.exec(lines[j]);
      if (m) {
        if (m[1].length < baseIndent) {
          i = j;
          break;
        }
        i = j;
        continue;
      }
      // Дальше идёт не элемент списка, а continuation с отступом —
      // присоединяем её к текущему пункту.
      if (current && /^\s+\S/.test(lines[j])) {
        current.text += ' ' + lines[j].trim();
        i = j + 1;
        continue;
      }
      i = j;
      break;
    }

    const m = LIST_ITEM_RE.exec(line);
    if (!m) {
      // Продолжение пункта: строка с отступом, но не новый элемент списка
      if (current && /^\s+\S/.test(line)) {
        const contIndent = line.length - line.trimStart().length;
        if (contIndent >= baseIndent) {
          current.text += ' ' + line.trim();
          i++;
          continue;
        }
      }
      break;
    }

    const indent = m[1].length;
    const isOrdered = /^\d/.test(m[2]);

    // Отступ меньше базового — список закончился (начался родительский)
    if (indent < baseIndent) break;

    // Больший отступ — вложенный список внутри текущего пункта
    if (indent > baseIndent) {
      if (!current) break;
      const nested = parseList(lines, i, indent, isOrdered);
      current.sub.push(nested.html);
      i = nested.next;
      continue;
    }

    // Тип списка сменился — это уже другой список
    if (ordered !== isOrdered) break;

    current = { text: m[3], sub: [] };
    items.push(current);
    if (items.length === 1 && ordered) {
      const num = parseInt(m[2], 10);
      if (Number.isFinite(num)) startNumber = num;
    }
    i++;
  }

  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && startNumber !== 1 ? ` start="${startNumber}"` : '';
  const html =
    `<${tag}${startAttr}>` +
    items
      .map((it) => `<li>${renderInline(it.text)}${it.sub.join('')}</li>`)
      .join('') +
    `</${tag}>`;

  return { html, next: i };
}

export function renderMarkdown(src: string): string {
  if (!src) return '';
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced Code Block
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || '';
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      const rawCode = buf.join('\n');
      out.push(
        `<div class="code-block-wrapper relative group my-3">
          <div class="flex items-center justify-between px-3 py-1.5 bg-[#12121c] border-b border-[var(--border)] rounded-t-lg text-xs text-[var(--muted)] font-mono">
            <span>${escapeHtml(lang || 'code')}</span>
            <button class="copy-code-btn hover:text-[var(--cyan)] transition-colors" data-code="${escapeHtml(rawCode)}">Копировать</button>
          </div>
          <pre class="!mt-0 !rounded-t-none"><code class="${lang ? `language-${escapeHtml(lang)}` : ''}">${escapeHtml(rawCode)}</code></pre>
        </div>`
      );
      continue;
    }

    // Horizontal Rule
    if (/^\s*---+\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // Headings
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) {
      const lvl = h[1].length;
      out.push(`<h${lvl}>${renderInline(h[2])}</h${lvl}>`);
      i++;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderInline(buf.join(' '))}</blockquote>`);
      continue;
    }

    // Маркированный или нумерованный список (с вложенностью и пустыми
    // строками между пунктами — всё собирается в один <ul>/<ol>)
    const listMatch = LIST_ITEM_RE.exec(line);
    if (listMatch) {
      const indent = listMatch[1].length;
      const ordered = /^\d/.test(listMatch[2]);
      const parsed = parseList(lines, i, indent, ordered);
      out.push(parsed.html);
      i = parsed.next;
      continue;
    }

    // Empty lines
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Regular Paragraph
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !LIST_ITEM_RE.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*---+\s*$/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${renderInline(buf.join(' '))}</p>`);
  }

  return out.join('\n');
}
