"use strict";

/* ================= HELPERS ================= */
const $  = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const chatLog = $('#chatLog'), input = $('#input'), sendBtn = $('#sendBtn');
let msgCount = 1, busy = false, currentBase = null;

function toast(msg, cls = '') {
  const t = document.createElement('div');
  t.className = 'toast glass' + (cls ? ' ' + cls : '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => {
    t.style.transition = 'all .4s';
    t.style.opacity = '0';
    t.style.transform = 'translateY(10px)';
    setTimeout(() => t.remove(), 400);
  }, 3200);
}
function toastOk(m)  { toast(m, 'ok'); }
function toastErr(m) { toast(m, 'err'); }
function scrollChat() { chatLog.scrollTo({ top: chatLog.scrollHeight, behavior: 'smooth' }); }
function updateCount() { $('#msgCount').textContent = msgCount; $('#sessionN').textContent = Math.max(0, msgCount - 1); }
function escapeHtml(s) { return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* ================= TABS ================= */
function activateTab(name) {
  $$('.tabs [data-tab]').forEach(b => {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  });
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
  if (name === 'bases') refreshBases();
}
$$('.tabs [data-tab]').forEach(b => b.addEventListener('click', () => activateTab(b.dataset.tab)));
$$('[data-goto-tab]').forEach(b => b.addEventListener('click', () => {
  activateTab(b.dataset.gotoTab);
  $('#app').scrollIntoView({ behavior: 'smooth' });
}));

/* ================= MARKDOWN (минимальный, безопасный) ================= */
const MD = (() => {
  function esc(s) { return s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
  function inline_(s) {
    const stash = [];
    s = s.replace(/`([^`\n]+)`/g, (_, c) => { stash.push(esc(c)); return `\x00C${stash.length - 1}\x00`; });
    s = esc(s);
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${t}</a>`);
    s = s.replace(/\x00C(\d+)\x00/g, (_, i) => `<code>${stash[+i]}</code>`);
    return s;
  }
  function render(src) {
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    const out = []; let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const fence = line.match(/^```(\w*)\s*$/);
      if (fence) {
        const lang = fence[1] || '';
        const buf = []; i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push(`<pre><code${lang ? ` class="lang-${esc(lang)}"` : ''}>${esc(buf.join('\n'))}</code></pre>`);
        continue;
      }
      if (/^\s*---+\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
      const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (h) { const lvl = h[1].length; out.push(`<h${lvl}>${inline_(h[2])}</h${lvl}>`); i++; continue; }
      if (/^>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
        out.push(`<blockquote>${inline_(buf.join(' '))}</blockquote>`); continue;
      }
      if (/^\s*[-*+]\s+/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i++; }
        out.push('<ul>' + buf.map(x => `<li>${inline_(x)}</li>`).join('') + '</ul>'); continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
        out.push('<ol>' + buf.map(x => `<li>${inline_(x)}</li>`).join('') + '</ol>'); continue;
      }
      if (line.trim() === '') { i++; continue; }
      const buf = [line]; i++;
      while (i < lines.length && lines[i].trim() !== ''
        && !/^```/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i])
        && !/^\s*[-*+]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])
        && !/^>\s?/.test(lines[i]) && !/^\s*---+\s*$/.test(lines[i])) {
        buf.push(lines[i]); i++;
      }
      out.push(`<p>${inline_(buf.join(' '))}</p>`);
    }
    return out.join('\n');
  }
  return { render };
})();

/* ================= API ================= */
const API = {
  async state()   { return jget('/api/state'); },
  async config(s) { return jpost('/api/config', s); },
  async clear()   { return jpost('/api/clear'); },
  async restart() { return jpost('/api/restart'); },
  async reload()  { return jpost('/api/reload'); },
  async chat(msg) { return jpost('/api/chat', { message: msg }); },
  async basesList()        { return jget('/api/bases'); },
  async baseGet(name)      { return jget('/api/bases/' + encodeURIComponent(name)); },
  async baseSave(name, d, c){ return jput('/api/bases/' + encodeURIComponent(name), { description: d, content: c }); },
  async baseCreate(n, d, c) { return jpost('/api/bases', { name: n, description: d, content: c }); },
  async baseDelete(name)   { return jdel('/api/bases/' + encodeURIComponent(name)); },
};
async function jget(url)  { const r = await fetch(url);                if (!r.ok) throw new Error((await r.json()).error || r.statusText); return r.json(); }
async function jpost(url, body) { const r = await fetch(url, { method: 'POST',  headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : null }); if (!r.ok) throw new Error((await r.json()).error || r.statusText); return r.json(); }
async function jput(url, body)  { const r = await fetch(url, { method: 'PUT',   headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error((await r.json()).error || r.statusText); return r.json(); }
async function jdel(url) { const r = await fetch(url, { method: 'DELETE' }); if (!r.ok) throw new Error((await r.json()).error || r.statusText); return r.json(); }

/* ================= STATE ================= */
async function refreshState() {
  try {
    const s = await API.state();
    $('#modelName').textContent = s.model.name;
    $('#serverUrl').textContent = s.server.host + ':' + s.server.port;
    $('#basesCount').textContent = s.bases.length;
    $('#basesCount2').textContent = s.bases.length;
    $('#heroBases').textContent = s.bases.length;
    $('#heroHost').textContent = s.server.host + ':' + s.server.port;
    $('#heroModel').textContent = s.model.name;
    $('#chatHeadCtx').textContent = 'ctx ' + s.settings.context_size + ' · temp ' + Number(s.settings.temperature).toFixed(2);
    const badge = $('#statusBadge');
    badge.className = 'badge';
    if (s.server.healthy) { badge.textContent = 'готов'; badge.classList.add('ok'); }
    else { badge.textContent = 'не запущен'; badge.classList.add('err'); }
    fillSettingsForm(s.settings);
  } catch (e) {
    $('#statusBadge').className = 'badge err';
    $('#statusBadge').textContent = 'ошибка';
  }
}

/* ================= SETTINGS ================= */
function fillSettingsForm(s) {
  const ctx = $('#cfgCtx'); ctx.value = s.context_size; $('#cfgCtxOut').textContent = s.context_size;
  const thr = $('#cfgThreads'); thr.value = s.threads || navigator.hardwareConcurrency || 4; $('#cfgThreadsOut').textContent = thr.value;
  const t = $('#cfgTemp'); t.value = s.temperature; $('#cfgTempOut').textContent = (+s.temperature).toFixed(2);
  const m = $('#cfgMaxTok'); m.value = s.max_tokens; $('#cfgMaxTokOut').textContent = s.max_tokens;
  const p = $('#cfgTopP'); p.value = s.top_p; $('#cfgTopPOut').textContent = (+s.top_p).toFixed(2);
  for (const r of [ctx, thr, t, m, p]) updateRangeFill(r);
}
function bindRange(id, outId, fmt) {
  const r = $('#' + id), o = $('#' + outId);
  const upd = () => { updateRangeFill(r); o.textContent = fmt(r.value); };
  r.addEventListener('input', upd); upd();
}
function updateRangeFill(r) {
  const pct = ((+r.value - +r.min) / (+r.max - +r.min)) * 100;
  r.style.setProperty('--val', pct + '%');
}
bindRange('cfgCtx', 'cfgCtxOut', v => v);
bindRange('cfgThreads', 'cfgThreadsOut', v => v);
bindRange('cfgTemp', 'cfgTempOut', v => (+v).toFixed(2));
bindRange('cfgMaxTok', 'cfgMaxTokOut', v => v);
bindRange('cfgTopP', 'cfgTopPOut', v => (+v).toFixed(2));

$('#btnSaveCfg').addEventListener('click', async () => {
  const m = $('#cfgMsg'); m.className = 'mono'; m.textContent = '';
  try {
    const s = {
      context_size: +$('#cfgCtx').value,
      threads:      +$('#cfgThreads').value,
      temperature:  +$('#cfgTemp').value,
      max_tokens:   +$('#cfgMaxTok').value,
      top_p:        +$('#cfgTopP').value,
    };
    await API.config(s);
    m.classList.add('ok');
    m.textContent = '✓ Сохранено. Перезапустите сервер для применения контекста/потоков.';
    await refreshState();
  } catch (e) {
    m.classList.add('err'); m.textContent = e.message;
  }
});

/* ================= CHAT ================= */
function addUser(text) {
  msgCount++;
  const el = document.createElement('div');
  el.className = 'msg user';
  el.innerHTML = `<div class="bubble-wrap"><div class="bubble">${escapeHtml(text)}</div></div>`;
  chatLog.appendChild(el); updateCount(); scrollChat();
}
function addAssistant(answer) {
  msgCount++;
  const el = document.createElement('div');
  el.className = 'msg';
  el.innerHTML = `
    <span class="avatar" aria-hidden="true">🤖</span>
    <div class="bubble-wrap">
      <div class="bubble">${answer.html}${answer.source ? '' : '<button class="copy-btn" type="button">copy</button>'}</div>
      ${answer.source ? `<span class="src">источник: ${escapeHtml(answer.source)}</span>` : ''}
      ${answer.analyses ? renderAnalyses(answer) : ''}
    </div>`;
  if (!answer.source) {
    el.querySelector('.copy-btn').addEventListener('click', e => {
      navigator.clipboard?.writeText(el.querySelector('.bubble').innerText.replace('copy', '').trim());
      e.target.textContent = '✓ скопировано';
      setTimeout(() => e.target.textContent = 'copy', 1500);
    });
  }
  chatLog.appendChild(el); updateCount(); scrollChat();
}
function renderAnalyses(answer) {
  const analyses = answer.analyses || [];
  if (analyses.length < 2) return '';
  const naCount = analyses.filter(a => /^\s*N\/A/i.test(a.answer || '')).length;
  const panel = document.createElement('details');
  panel.className = 'analyses';
  panel.open = true;
  const sum = document.createElement('summary');
  sum.innerHTML = `<span class="a-summary-title">📊 Параллельный анализ по ${analyses.length} базам</span>` +
    (answer.source ? `<span class="a-summary-tag">выбрана «${escapeHtml(answer.source)}»</span>` : '');
  panel.appendChild(sum);
  const list = document.createElement('div');
  list.className = 'analyses-list';
  for (const a of analyses) {
    const item = document.createElement('div');
    item.className = 'ai' + (a.chosen ? ' chosen' : '');
    const head = document.createElement('div');
    head.className = 'ai-head';
    head.innerHTML =
      `<span class="ai-mark">${a.chosen ? '✓' : '·'}</span>` +
      `<span class="ai-name">${escapeHtml(a.name)}</span>` +
      (a.description ? `<span class="ai-desc">— ${escapeHtml(a.description)}</span>` : '');
    item.appendChild(head);
    const ans = document.createElement('div');
    ans.className = 'ai-answer';
    if (a.err) {
      ans.className = 'ai-err';
      ans.textContent = 'ошибка: ' + a.err;
    } else if (/^\s*N\/A/i.test(a.answer || '')) {
      ans.className = 'ai-answer na';
      ans.textContent = a.answer;
    } else {
      ans.innerHTML = MD.render(a.answer);
    }
    item.appendChild(ans);
    list.appendChild(item);
  }
  panel.appendChild(list);
  return panel.outerHTML;
}
function showTyping() {
  const el = document.createElement('div');
  el.className = 'msg typing';
  el.innerHTML = `<span class="avatar" aria-hidden="true">🤖</span>
    <div class="bubble-wrap"><div class="bubble"><i></i><i></i><i></i></div></div>`;
  chatLog.appendChild(el); scrollChat();
  return el;
}
function showEmpty() {
  chatLog.innerHTML = `<div class="empty">
    <div class="art">✦</div>
    <b>Диалог пуст</b>
    Задайте вопрос — отвечу с опорой на базы знаний
  </div>`;
}

input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 180) + 'px';
  const cnt = input.value.length;
  const cc = $('#charCount');
  cc.textContent = `${cnt} / 4000`;
  cc.className = 'mono';
  if (cnt > 3800) cc.classList.add('err');
  else if (cnt > 3200) cc.classList.add('warn');
  else cc.classList.add('ok');
});
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('#composer').requestSubmit();
  }
});
$('#composer').addEventListener('submit', e => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || busy) return;
  const empty = chatLog.querySelector('.empty'); if (empty) empty.remove();
  busy = true; sendBtn.disabled = true;
  addUser(text);
  input.value = ''; input.style.height = 'auto';
  $('#charCount').textContent = '0 / 4000'; $('#charCount').className = 'mono ok';
  const typing = showTyping();
  API.chat(text).then(r => {
    typing.remove();
    addAssistant({
      html: MD.render(r.response || ''),
      source: r.source || '',
      analyses: r.analyses || [],
    });
    busy = false; sendBtn.disabled = false; input.focus();
  }).catch(err => {
    typing.remove();
    addAssistant({ html: `<p><em style="color:var(--rose)">Ошибка: ${escapeHtml(err.message)}</em></p>`, source: '', analyses: [] });
    busy = false; sendBtn.disabled = false; input.focus();
  });
});

/* ================= SIDEBAR ACTIONS ================= */
$('#btnClear').addEventListener('click', async () => {
  try { await API.clear(); showEmpty(); msgCount = 0; updateCount(); toastOk('История очищена'); }
  catch (e) { toastErr(e.message); }
});
async function reloadAll() {
  try { await API.reload(); await refreshState(); await refreshBases(); toastOk('Базы перечитаны'); }
  catch (e) { toastErr(e.message); }
}
$('#btnReload').addEventListener('click', reloadAll);
$('#btnReload2').addEventListener('click', reloadAll);
$('#btnRestart').addEventListener('click', async () => {
  const badge = $('#statusBadge');
  badge.className = 'badge warn'; badge.textContent = 'перезапуск…';
  toast('Сервер перезапускается…');
  try { await API.restart(); toastOk('Сервер снова готов ✦'); }
  catch (e) { toastErr(e.message); badge.className='badge err'; badge.textContent='ошибка'; }
  await refreshState();
});
$('#btnNewChat').addEventListener('click', async () => {
  try { await API.clear(); } catch {}
  showEmpty(); msgCount = 0; updateCount();
  addAssistant({ html: 'Привет! Я локальный AI-ассистент. Задайте вопрос — могу опираться на базы знаний из папки <code class="mono" style="color:var(--cyan)">bases/</code>.', source: '', analyses: [] });
  toast('Создан новый диалог');
});

/* ================= BASES TAB ================= */
async function refreshBases() {
  const list = $('#basesList');
  list.innerHTML = '';
  let bases = [];
  try { bases = await API.basesList(); } catch (e) { toastErr(e.message); return; }
  if (!bases.length) {
    list.innerHTML = '<div class="mono" style="color:var(--muted);padding:10px 0">Нет баз. Нажмите «＋ Новая» чтобы создать.</div>';
    $('#basesCount2').textContent = 0;
    return;
  }
  for (const b of bases) {
    const btn = document.createElement('button');
    btn.className = 'base-file' + (currentBase === b.name ? ' active' : '');
    btn.innerHTML = `
      <span class="base-ico">.md</span>
      <div style="min-width:0;flex:1">
        <div class="fname">${escapeHtml(b.name)}.md</div>
        <div class="meta">${escapeHtml((b.description || '').slice(0, 60))}${b.description && b.description.length > 60 ? '…' : ''}</div>
      </div>
      <button class="reload" type="button" title="Редактировать">✎</button>`;
    btn.addEventListener('click', e => {
      if (e.target.closest('.reload')) { selectBase(b.name); return; }
      selectBase(b.name);
    });
    list.appendChild(btn);
  }
  $('#basesCount2').textContent = bases.length;
}

async function selectBase(name) {
  try {
    const b = await API.baseGet(name);
    currentBase = name;
    $('#baseEmpty').style.display = 'none';
    $('#baseEditor').style.display = 'block';
    $('#baseName').value = b.name;
    $('#baseName').disabled = true;
    $('#baseDesc').value = b.description || '';
    $('#baseContent').value = b.content || '';
    $('#baseMsg').textContent = '';
    $('#baseMsg').className = 'mono';
    $$('#basesList .base-file').forEach(el => el.classList.toggle('active', el.querySelector('.fname').textContent === b.name + '.md'));
  } catch (e) { toastErr(e.message); }
}

function newBase() {
  currentBase = null;
  $('#baseEmpty').style.display = 'none';
  $('#baseEditor').style.display = 'block';
  $('#baseName').value = '';
  $('#baseName').disabled = false;
  $('#baseName').focus();
  $('#baseDesc').value = '';
  $('#baseContent').value = '# Новая тема\n\n';
  $('#baseMsg').textContent = '';
  $('#baseMsg').className = 'mono';
  $$('#basesList .base-file').forEach(el => el.classList.remove('active'));
}

async function saveBase() {
  const m = $('#baseMsg'); m.className = 'mono'; m.textContent = '';
  const name = $('#baseName').value.trim();
  const desc = $('#baseDesc').value;
  const content = $('#baseContent').value;
  if (!name) { m.classList.add('err'); m.textContent = 'Укажите имя'; return; }
  try {
    if (currentBase) {
      await API.baseSave(currentBase, desc, content);
      m.classList.add('ok'); m.textContent = '✓ Сохранено';
    } else {
      await API.baseCreate(name, desc, content);
      currentBase = name;
      $('#baseName').disabled = true;
      m.classList.add('ok'); m.textContent = '✓ Создано';
    }
    await refreshBases();
    await refreshState();
    toastOk(currentBase + '.md сохранена');
  } catch (e) { m.classList.add('err'); m.textContent = e.message; }
}

async function deleteBase() {
  if (!currentBase) return;
  if (!confirm('Удалить базу «' + currentBase + '.md»?')) return;
  try {
    await API.baseDelete(currentBase);
    currentBase = null;
    $('#baseEmpty').style.display = 'block';
    $('#baseEditor').style.display = 'none';
    await refreshBases();
    await refreshState();
    toastOk('База удалена');
  } catch (e) { toastErr(e.message); }
}

$('#btnNewBase').addEventListener('click', newBase);
$('#btnSaveBase').addEventListener('click', saveBase);
$('#btnDeleteBase').addEventListener('click', deleteBase);

/* ================= MOBILE DRAWER (если нужен burger в nav) ================= */
const overlay = $('#overlay');
overlay.addEventListener('click', () => {
  $('#sidebar').classList.remove('open');
  overlay.classList.remove('show');
});

/* ================= FADE-UP ON SCROLL ================= */
const io = new IntersectionObserver(entries => {
  entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
}, { threshold: .15 });
$$('.fade-up').forEach(el => io.observe(el));

/* ================= BOOT ================= */
updateCount();
refreshState();
refreshBases();
setInterval(refreshState, 15000);
