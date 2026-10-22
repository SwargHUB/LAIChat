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

    // Unordered List
    if (/^\s*[-*+]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      out.push('<ul>' + buf.map((x) => `<li>${renderInline(x)}</li>`).join('') + '</ul>');
      continue;
    }

    // Ordered List
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      out.push('<ol>' + buf.map((x) => `<li>${renderInline(x)}</li>`).join('') + '</ol>');
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
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
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
