// Sidebar panels: files, outline, search in files, symbols, bibliography.
import { app, on, openFile, projectDir, setMaster, refreshProjectFiles, goToLine, saveSessionSoon, findDoc, closeDoc } from './app.js';
import { h, basename, dirname, join, extname, samePath, relative, escapeHtml, debounce, stripExt } from './util.js';
import { icon } from './icons.js';
import { showMenu, promptDialog, confirmDialog, toast, iconButton } from './ui.js';
import { insertText } from './editor/extras.js';
import { SYMBOLS } from './data/symbols.js';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const api = window.api;
const TEXT_OPEN = /\.(tex|ltx|bib|sty|cls|bst|dtx|ins|txt|md|cfg|def|bbx|cbx|tikz|log|bbl|aux|csv|dat|json|py|m|latexmkrc)$/i;

// ======================= Files =======================
export function mountFiles(el) {
  const expanded = new Set(JSON.parse(localStorage.getItem('txs.expanded') || '[]'));
  const title = h('div', { class: 'side-title-text' });
  const tree = h('div', { class: 'tree' });
  const header = h('div', { class: 'side-header' }, title,
    h('div', { class: 'side-actions' },
      iconButton('file-plus', '新建文件', () => createEntry(projectDir(), false)),
      iconButton('folder-plus', '新建文件夹', () => createEntry(projectDir(), true)),
      iconButton('refresh', '刷新', () => render(true)),
      iconButton('folder-open', '打开文件夹', () => openFolder()),
    ));
  el.append(header, tree);

  async function openFolder() {
    const r = await api.openDialog({ folder: true, title: '打开项目文件夹', defaultPath: projectDir() || undefined });
    if (!r) return;
    app.folder = r[0];
    const recent = (app.settings.recentFolders || []).filter((p) => !samePath(p, r[0]));
    recent.unshift(r[0]);
    window.api.setSettings({ recentFolders: recent.slice(0, 8) });
    saveSessionSoon();
    await refreshProjectFiles();
    render(true);
  }
  app.openFolder = openFolder;

  async function createEntry(dir, folder) {
    if (!dir) { toast('请先打开一个文件夹或保存当前文件'); return; }
    const name = await promptDialog({ title: folder ? '新建文件夹' : '新建文件', value: folder ? '' : 'chapter.tex', placeholder: folder ? 'figures' : 'chapter.tex' });
    if (!name) return;
    const p = join(dir, name);
    try {
      if (folder) await api.mkdir(p);
      else { await api.create(p, ''); openFile(p); }
      expanded.add(dir);
      await refreshProjectFiles();
      render(true);
    } catch (e) { toast(e.message, 'error'); }
  }

  const persist = () => localStorage.setItem('txs.expanded', JSON.stringify([...expanded].slice(-300)));

  async function renderDir(dir, container, depth) {
    let entries;
    try { entries = await api.readdir(dir); } catch { return; }
    for (const e of entries) {
      const isOpen = expanded.has(e.path);
      const ext = extname(e.name);
      const active = app.active?.path && samePath(app.active.path, e.path);
      const isRoot = app.root && samePath(app.root, e.path);
      const row = h('div', {
        class: `tree-row ${active ? 'active' : ''} ${e.isDir ? 'dir' : 'file'} ${!e.isDir && !TEXT_OPEN.test(e.name) && !/\.(pdf|png|jpe?g|svg)$/i.test(e.name) ? 'dim' : ''}`,
        style: { paddingLeft: 8 + depth * 14 + 'px' },
        title: e.path,
        draggable: e.isDir ? null : 'true',
      },
        e.isDir ? h('span', { class: `tree-chev ${isOpen ? 'open' : ''}` }, icon('chevron-right', 12, 2.2)) : h('span', { class: 'tree-chev' }),
        e.isDir ? icon(isOpen ? 'folder-open' : 'folder', 15) : fileIcon(ext),
        h('span', { class: 'tree-name' }, e.name),
        isRoot ? h('span', { class: 'tree-badge' }, '主') : null,
      );
      row.addEventListener('click', async () => {
        if (e.isDir) {
          if (isOpen) expanded.delete(e.path); else expanded.add(e.path);
          persist();
          render();
        } else openEntry(e.path);
      });
      row.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/x-path', e.path); });
      row.addEventListener('contextmenu', (ev) => { ev.preventDefault(); entryMenu(e, ev.clientX, ev.clientY); });
      container.append(row);
      if (e.isDir && isOpen) await renderDir(e.path, container, depth + 1);
    }
  }

  function openEntry(p) {
    if (TEXT_OPEN.test(p)) openFile(p);
    else if (/\.pdf$/i.test(p)) app.pdf?.show(p, { reveal: true });
    else api.openExternal(p);
  }

  function entryMenu(e, x, y) {
    const dir = e.isDir ? e.path : dirname(e.path);
    const base = app.root ? dirname(app.root) : projectDir();
    const rel = base ? relative(base, e.path) : e.name;
    showMenu([
      !e.isDir ? { label: '打开', icon: 'file', run: () => openEntry(e.path) } : null,
      !e.isDir && /\.(tex)$/i.test(e.name) ? { label: '设为主文档', icon: 'star', checked: app.master && samePath(app.master, e.path), run: () => setMaster(app.master && samePath(app.master, e.path) ? null : e.path) } : null,
      !e.isDir && /\.tex$/i.test(e.name) ? { label: '插入 \\input{…}', icon: 'code', run: () => insertText(app.view, `\\input{${stripExt(rel)}}`) } : null,
      !e.isDir && /\.(pdf|png|jpe?g|eps|svg)$/i.test(e.name) ? { label: '插入 \\includegraphics', icon: 'image', run: () => insertText(app.view, `\\includegraphics[width=0.8\\linewidth]{${rel}}`) } : null,
      !e.isDir && /\.bib$/i.test(e.name) ? { label: '插入 \\bibliography{…}', icon: 'book', run: () => insertText(app.view, `\\bibliography{${stripExt(rel)}}`) } : null,
      { sep: true },
      { label: '新建文件', icon: 'file-plus', run: () => createEntry(dir, false) },
      { label: '新建文件夹', icon: 'folder-plus', run: () => createEntry(dir, true) },
      { label: '重命名', icon: 'pencil', run: () => renameEntry(e) },
      { label: '移到回收站', icon: 'trash', run: () => trashEntry(e) },
      { sep: true },
      { label: '复制路径', icon: 'copy', run: () => api.clipboardWrite(e.path) },
      { label: '复制相对路径', run: () => api.clipboardWrite(rel) },
      { label: '在资源管理器中显示', icon: 'folder-open', run: () => api.reveal(e.path) },
    ], x, y);
  }

  async function renameEntry(e) {
    const name = await promptDialog({ title: '重命名', value: e.name });
    if (!name || name === e.name) return;
    const to = join(dirname(e.path), name);
    try {
      await api.rename(e.path, to);
      const d = findDoc(e.path);
      if (d) { api.unwatch(d.path); d.path = to; d.name = name; api.watch(to); }
      await refreshProjectFiles();
      render(true);
    } catch (err) { toast(err.message, 'error'); }
  }
  async function trashEntry(e) {
    const ok = await confirmDialog({ title: `将 “${e.name}” 移到回收站？`, message: '可以在系统回收站中恢复。', ok: '移到回收站', danger: true });
    if (!ok) return;
    const d = findDoc(e.path);
    if (d) await closeDoc(d, { force: true });
    try { await api.trash(e.path); await refreshProjectFiles(); render(true); } catch (err) { toast(err.message, 'error'); }
  }

  let renderToken = 0;
  async function render() {
    const token = ++renderToken;
    const dir = projectDir();
    title.replaceChildren(dir ? h('span', { title: dir }, basename(dir) || dir) : h('span', { class: 'muted' }, '资源管理器'));
    const frag = h('div');
    if (!dir) {
      frag.append(h('div', { class: 'empty' }, icon('folder-open', 30, 1.4), h('div', {}, '打开一个文件夹开始'), h('button', { class: 'btn btn-sm btn-primary', onclick: openFolder }, '打开文件夹')));
    } else {
      await renderDir(dir, frag, 0);
    }
    if (token !== renderToken) return;
    tree.replaceChildren(...frag.childNodes);
  }
  on('active', debounce(render, 50));
  on('project-files', debounce(render, 50));
  on('index', (_i, rootChanged) => { if (rootChanged) render(); });
  on('master', render);
  return { render, openFolder };
}

function fileIcon(ext) {
  const color = { '.tex': 'var(--primary)', '.bib': '#248a3d', '.pdf': '#d70015', '.sty': '#c93400', '.cls': '#c93400', '.png': 'var(--text-3)', '.jpg': 'var(--text-3)' }[ext];
  const el = icon(/\.(png|jpe?g|svg|eps)$/.test(ext) ? 'image' : ext === '.bib' ? 'book' : ext === '.pdf' ? 'file-type' : 'file-text', 15);
  if (color) el.style.color = color;
  return el;
}

// ======================= Outline =======================
export function mountOutline(el) {
  const opts = { labels: false, floats: true, todos: true, files: false, ...JSON.parse(localStorage.getItem('txs.outline') || '{}') };
  const collapsed = new Set();
  const body = h('div', { class: 'tree outline' });
  const toggles = h('div', { class: 'side-actions' });
  const renderToggles = () => toggles.replaceChildren(
    h('button', { class: `chip chip-xs ${opts.floats ? 'active' : ''}`, onclick: () => { opts.floats = !opts.floats; save(); } }, '图表'),
    h('button', { class: `chip chip-xs ${opts.labels ? 'active' : ''}`, onclick: () => { opts.labels = !opts.labels; save(); } }, '标签'),
    h('button', { class: `chip chip-xs ${opts.files ? 'active' : ''}`, onclick: () => { opts.files = !opts.files; save(); } }, '文件'),
  );
  const save = () => { localStorage.setItem('txs.outline', JSON.stringify(opts)); renderToggles(); render(); };
  renderToggles();
  el.append(h('div', { class: 'side-header' }, h('div', { class: 'side-title-text' }, '结构'), toggles), body);

  let activeKey = null;
  function render() {
    const idx = app.index;
    body.replaceChildren();
    if (!idx || !idx.outline.length) {
      body.append(h('div', { class: 'empty' }, icon('outline', 30, 1.4), h('div', {}, '没有章节结构')));
      return;
    }
    const walk = (items, depth) => {
      for (const it of items) {
        if (it.kind === 'label' && !opts.labels) continue;
        if (it.kind === 'float' && !opts.floats) continue;
        if (it.kind === 'include' && !opts.files) continue;
        const key = it.file + ':' + it.line + ':' + it.kind;
        const hasKids = it.children.some((c) => (c.kind !== 'label' || opts.labels) && (c.kind !== 'float' || opts.floats) && (c.kind !== 'include' || opts.files));
        const isCollapsed = collapsed.has(key);
        const row = h('div', {
          class: `tree-row outline-${it.kind} lvl-${it.level ?? 9} ${key === activeKey ? 'active' : ''}`,
          style: { paddingLeft: 6 + depth * 14 + 'px' },
          title: `${basename(it.file)}:${it.line}`,
          'data-key': key,
          onclick: () => openFile(it.file, { line: it.kind === 'include' ? 1 : it.line }),
        },
          hasKids ? h('span', { class: `tree-chev ${isCollapsed ? '' : 'open'}`, onclick: (e) => { e.stopPropagation(); if (isCollapsed) collapsed.delete(key); else collapsed.add(key); render(); } }, icon('chevron-right', 12, 2.2)) : h('span', { class: 'tree-chev' }),
          outlineIcon(it),
          h('span', { class: 'tree-name' }, it.kind === 'section' ? it.title : it.kind === 'float' ? it.title : it.title),
        );
        body.append(row);
        if (hasKids && !isCollapsed) walk(it.children, depth + 1);
      }
    };
    walk(idx.outline, 0);
    if (opts.todos && idx.todos.length) {
      body.append(h('div', { class: 'side-group' }, `待办 · ${idx.todos.length}`));
      for (const t of idx.todos) body.append(h('div', { class: 'tree-row outline-todo', style: { paddingLeft: '12px' }, onclick: () => openFile(t.file, { line: t.line }) }, h('span', { class: 'status-dot warning' }), h('span', { class: 'tree-name' }, t.title), h('span', { class: 'tree-meta' }, basename(t.file) + ':' + t.line)));
    }
    markActive();
  }

  function markActive() {
    const idx = app.index;
    if (!idx || !app.active?.path) return;
    const line = app.view.state.doc.lineAt(app.view.state.selection.main.head).number;
    let best = null;
    const walk = (items) => { for (const it of items) { if (it.kind === 'section' && samePath(it.file, app.active.path) && it.line <= line) best = it; walk(it.children); } };
    walk(idx.outline);
    const key = best ? best.file + ':' + best.line + ':' + best.kind : null;
    if (key === activeKey) return;
    activeKey = key;
    body.querySelectorAll('.tree-row.active').forEach((r) => r.classList.remove('active'));
    if (key) { const r = body.querySelector(`[data-key="${CSS.escape(key)}"]`); r?.classList.add('active'); r?.scrollIntoView({ block: 'nearest' }); }
  }
  on('index', render);
  on('cursor', debounce(markActive, 150));
  render();
  return { render };
}

function outlineIcon(it) {
  if (it.kind === 'section') return h('span', { class: 'ol-ico ol-sec' }, { part: 'P', chapter: 'C', section: 'S', subsection: 's', subsubsection: 'ss', paragraph: '¶', subparagraph: '¶' }[it.cmd] || '§');
  if (it.kind === 'include') return icon('file-text', 14);
  if (it.kind === 'float') return icon(/table/.test(it.env) ? 'table' : 'image', 14);
  if (it.kind === 'label') return icon('tag', 13);
  if (it.kind === 'missing') return icon('warning', 14);
  return h('span');
}

// ======================= Search in files =======================
export function mountSearch(el) {
  const opts = { caseSensitive: false, word: false, regex: false };
  const input = h('input', { class: 'input input-sm', placeholder: '在项目中搜索…', spellcheck: 'false' });
  const optBtn = (k, ic, tip) => { const b = h('button', { class: 'icon-btn icon-btn-sm', 'data-tip': tip, onclick: () => { opts[k] = !opts[k]; b.classList.toggle('on', opts[k]); run(); } }, icon(ic, 15)); return b; };
  const results = h('div', { class: 'search-results' });
  const summary = h('div', { class: 'search-summary muted' });
  el.append(
    h('div', { class: 'side-header' }, h('div', { class: 'side-title-text' }, '搜索')),
    h('div', { class: 'search-box' }, input, h('div', { class: 'search-opts' }, optBtn('caseSensitive', 'case', '区分大小写'), optBtn('word', 'word', '全字匹配'), optBtn('regex', 'regex', '正则表达式'))),
    summary, results,
  );
  let token = 0;
  async function run() {
    const q = input.value;
    const t = ++token;
    const dir = projectDir();
    if (!q || !dir) { results.replaceChildren(); summary.textContent = dir ? '' : '请先打开文件夹'; return; }
    summary.textContent = '搜索中…';
    const r = await api.search(dir, q, opts);
    if (t !== token) return;
    if (r.error) { summary.textContent = r.error; results.replaceChildren(); return; }
    summary.textContent = r.total ? `${r.total} 个结果 · ${r.results.length} 个文件` : '没有结果';
    results.replaceChildren();
    for (const f of r.results) {
      const group = h('div', { class: 'sr-group' });
      group.append(h('div', { class: 'sr-file', title: f.file }, fileIcon(extname(f.file)), h('span', {}, relative(dir, f.file)), h('span', { class: 'sr-count' }, f.matches.length)));
      for (const m of f.matches) {
        const c0 = m.col - m.offset;
        const line = h('div', { class: 'sr-line', onclick: async () => {
          await openFile(f.file, { line: m.line });
          const ln = app.view.state.doc.line(m.line);
          app.view.dispatch({ selection: EditorSelection.range(ln.from + m.col, ln.from + m.col + m.len), effects: EditorView.scrollIntoView(ln.from + m.col, { y: 'center' }) });
        } },
          h('span', { class: 'sr-ln' }, m.line),
          h('span', { class: 'sr-text', html: escapeHtml(m.text.slice(Math.max(0, c0 - 30), c0)).replace(/^\s+/, '') + '<mark>' + escapeHtml(m.text.slice(c0, c0 + m.len)) + '</mark>' + escapeHtml(m.text.slice(c0 + m.len, c0 + m.len + 120)) }),
        );
        group.append(line);
      }
      results.append(group);
    }
  }
  input.addEventListener('input', debounce(run, 250));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  return { focus: (q) => { if (q) input.value = q; input.focus(); input.select(); run(); } };
}

// ======================= Symbols =======================
export function mountSymbols(el) {
  const recent = JSON.parse(localStorage.getItem('txs.recentSymbols') || '[]');
  const filter = h('input', { class: 'input input-sm', placeholder: '搜索符号命令，如 alpha', spellcheck: 'false' });
  const body = h('div', { class: 'symbols' });
  el.append(h('div', { class: 'side-header' }, h('div', { class: 'side-title-text' }, '符号')), h('div', { class: 'search-box' }, filter), body);
  const insert = (s) => {
    insertText(app.view, s.c);
    const i = recent.findIndex((r) => r.c === s.c);
    if (i >= 0) recent.splice(i, 1);
    recent.unshift(s);
    localStorage.setItem('txs.recentSymbols', JSON.stringify(recent.slice(0, 24)));
    if (!filter.value) render();
  };
  const grid = (items) => h('div', { class: 'sym-grid' }, items.map((s) => h('button', { class: 'sym', 'data-tip': s.c, onclick: () => insert(s) }, s.g)));
  function render() {
    const q = filter.value.trim().toLowerCase();
    body.replaceChildren();
    if (!q && recent.length) body.append(h('div', { class: 'side-group' }, '最近使用'), grid(recent));
    for (const cat of SYMBOLS) {
      const items = q ? cat.items.filter((s) => s.c.toLowerCase().includes(q)) : cat.items;
      if (!items.length) continue;
      body.append(h('div', { class: 'side-group' }, cat.name), grid(items));
    }
  }
  filter.addEventListener('input', render);
  render();
}

// ======================= Bibliography =======================
export function mountBib(el) {
  const filter = h('input', { class: 'input input-sm', placeholder: '按作者、标题、年份筛选', spellcheck: 'false' });
  const body = h('div', { class: 'bib-list' });
  el.append(h('div', { class: 'side-header' }, h('div', { class: 'side-title-text' }, '参考文献')), h('div', { class: 'search-box' }, filter), body);
  function render() {
    const entries = app.index?.bibEntries || [];
    const q = filter.value.trim().toLowerCase();
    const list = q ? entries.filter((e) => `${e.key} ${e.title} ${e.author} ${e.year}`.toLowerCase().includes(q)) : entries;
    body.replaceChildren();
    if (!list.length) { body.append(h('div', { class: 'empty' }, icon('book', 30, 1.4), h('div', {}, entries.length ? '没有匹配的文献' : '项目中没有找到 .bib 文献'))); return; }
    for (const e of list.slice(0, 500)) {
      body.append(h('div', { class: 'bib-row', title: '单击插入 \\cite，双击打开 .bib', onclick: () => insertText(app.view, `\\cite{${e.key}}`), ondblclick: () => openFile(e.file, { line: e.line }) },
        h('div', { class: 'bib-title' }, e.title || e.key),
        h('div', { class: 'bib-meta' }, h('span', { class: 'bib-key' }, e.key), [e.author.split(/ and /)[0], e.year].filter(Boolean).join(' · ')),
      ));
    }
  }
  filter.addEventListener('input', render);
  on('index', render);
  render();
}
