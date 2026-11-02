// Application core: settings, documents & tabs, the editor view, project context.
import { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { setDiagnostics } from '@codemirror/lint';
import { h, debounce, basename, dirname, extname, samePath, resolve, join, normalize } from './util.js';
import { icon } from './icons.js';
import { toast, confirmDialog, showMenu } from './ui.js';
import { createState, reconfigureAll } from './editor/setup.js';
import { setCompletionContext } from './editor/completion.js';
import { setHoverContext, flashLineEffect } from './editor/extras.js';
import { detectRoot, indexProject, guessEngine, magicComments } from './project.js';
import { renderPdfThumb } from './pdfview.js';

const api = window.api;

export const app = {
  settings: {},
  info: {},
  docs: [],
  active: null,
  view: null,
  master: null, // explicit master document path
  folder: null, // opened project folder
  index: null,
  projectFiles: [],
  listeners: {},
  keymap: [],
  untitledCounter: 1,
};

// ---------- events ----------
export function on(evt, fn) { (app.listeners[evt] ||= []).push(fn); }
export function emit(evt, ...args) { for (const fn of app.listeners[evt] || []) { try { fn(...args); } catch (e) { console.error(e); } } }

// ---------- settings ----------
export async function loadSettings() {
  app.settings = await api.getSettings();
  app.info = await api.info();
}
export async function updateSettings(patch) {
  app.settings = await api.setSettings(patch);
  applyEditorSettings();
  emit('settings', app.settings, patch);
}
export function applyEditorSettings() {
  const effects = reconfigureAll(null, app.settings);
  for (const d of app.docs) {
    if (d === app.active) app.view.dispatch({ effects });
    else d.state = d.state.update({ effects }).state;
  }
}

// ---------- theme ----------
let systemDark = false;
export async function initTheme() {
  systemDark = await api.systemDark();
  api.onSystemTheme((d) => { systemDark = d; applyTheme(); });
  applyTheme();
}
export function isDark() {
  const t = app.settings.theme;
  return t === 'dark' || (t === 'system' && systemDark);
}
export function applyTheme() {
  const dark = isDark();
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  api.setTheme(dark);
  emit('theme', dark);
}

// ---------- editor ----------
export function createEditor(parent) {
  app.view = new EditorView({ parent, state: createState({ doc: '', path: null, settings: app.settings, appKeymap: app.keymap, onUpdate }) });
  app.view.dom.addEventListener('contextmenu', (e) => { app.lastContext = { x: e.clientX, y: e.clientY, pos: app.view.posAtCoords({ x: e.clientX, y: e.clientY }) }; });
  app.view.dom.addEventListener('mousedown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.button === 0 && !e.altKey) {
      const pos = app.view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos == null) return;
      e.preventDefault();
      setTimeout(() => emit('ctrl-click', pos), 0);
    }
  }, true);
  setHoverContext({ settings: app.settings, renderPdfThumb, resolveImage });
}

function onUpdate(u) {
  const d = app.active;
  if (!d || app.view.state !== u.state) return;
  d.state = u.state;
  if (u.docChanged) {
    const wasDirty = d.dirty;
    d.dirty = d.savedLength !== u.state.doc.length || !u.state.doc.eq(d.savedDoc);
    if (wasDirty !== d.dirty) renderTabs();
    scheduleIndex();
    emit('doc-changed', d);
  }
  if (u.selectionSet || u.docChanged) emit('cursor', u.state);
}

// ---------- documents ----------
let docId = 1;
function newDocRecord({ path, content, mtime, encoding }) {
  const d = {
    id: docId++,
    path: path ? normalize(path) : null,
    name: path ? basename(path) : `未命名-${app.untitledCounter++}.tex`,
    mtime: mtime || 0,
    encoding: encoding || 'UTF-8',
    dirty: false,
    scrollTop: 0,
  };
  d.state = createState({ doc: content, path: d.path || d.name, settings: app.settings, appKeymap: app.keymap, onUpdate });
  d.savedDoc = d.state.doc;
  d.savedLength = d.state.doc.length;
  return d;
}

export function findDoc(path) { return app.docs.find((d) => d.path && samePath(d.path, path)); }
export function getOpenText(path) { const d = findDoc(path); return d ? d.state.doc.toString() : null; }

export async function openFile(path, { line, column, focus = true, background = false } = {}) {
  path = normalize(path);
  let d = findDoc(path);
  if (!d) {
    let r;
    try { r = await api.read(path); } catch (e) { toast('无法打开文件：' + basename(path), 'error'); removeRecent(path); return null; }
    d = newDocRecord({ path, content: r.content, mtime: r.mtime, encoding: r.encoding });
    // Replace a pristine untitled tab
    const blank = app.docs.length === 1 && !app.docs[0].path && !app.docs[0].dirty && app.docs[0].state.doc.length === 0 ? app.docs[0] : null;
    if (blank) app.docs.splice(app.docs.indexOf(blank), 1, d);
    else {
      const i = app.active ? app.docs.indexOf(app.active) + 1 : app.docs.length;
      app.docs.splice(i, 0, d);
    }
    api.watch(path);
    addRecent(path);
    if (r.encoding !== 'UTF-8') toast(`${basename(path)} 以 ${r.encoding} 编码打开，保存时将转换为 UTF-8`, 'info', 4000);
    emit('docs-changed');
  }
  if (!background) activate(d, { restoreScroll: line == null });
  if (line != null) goToLine(line, column, { flash: true });
  if (focus && !background) app.view.focus();
  saveSessionSoon();
  return d;
}

export function newDocument(content = '', name) {
  const d = newDocRecord({ path: null, content });
  if (name) d.name = name;
  const i = app.active ? app.docs.indexOf(app.active) + 1 : app.docs.length;
  app.docs.splice(i, 0, d);
  activate(d);
  if (content) { d.dirty = true; }
  renderTabs();
  app.view.focus();
  emit('docs-changed');
  return d;
}

export function activate(d, { restoreScroll = true } = {}) {
  if (!d) return;
  if (app.active && app.active !== d) {
    app.active.state = app.view.state;
    app.active.scrollTop = app.view.scrollDOM.scrollTop;
  }
  const changed = app.active !== d;
  app.active = d;
  if (changed || app.view.state !== d.state) {
    app.view.setState(d.state);
    if (restoreScroll) app.view.scrollDOM.scrollTop = d.scrollTop || 0;
  }
  renderTabs();
  refreshContext();
  emit('active', d);
  emit('cursor', app.view.state);
  saveSessionSoon();
}

export async function saveDoc(d = app.active, { as = false } = {}) {
  if (!d) return false;
  if (d === app.active) d.state = app.view.state;
  let path = d.path;
  if (!path || as) {
    const def = path || join(app.folder || dirname(app.master || '') || app.info.home, d.name);
    path = await api.saveDialog({ defaultPath: def });
    if (!path) return false;
    path = normalize(path);
  }
  const content = d.state.doc.toString();
  try {
    const r = await api.write(path, content);
    d.mtime = r.mtime;
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
    return false;
  }
  if (!d.path || !samePath(d.path, path)) {
    if (d.path) api.unwatch(d.path);
    d.path = path;
    d.name = basename(path);
    api.watch(path);
    addRecent(path);
    // Language may change with extension
    d.state = createState({ doc: content, path, settings: app.settings, appKeymap: app.keymap, onUpdate });
    if (d === app.active) app.view.setState(d.state);
  }
  d.savedDoc = d.state.doc;
  d.savedLength = d.state.doc.length;
  d.dirty = false;
  d.encoding = 'UTF-8';
  renderTabs();
  emit('saved', d);
  saveSessionSoon();
  return true;
}

export async function saveAll({ silentUntitled = false } = {}) {
  for (const d of app.docs) {
    if (!d.dirty) continue;
    if (!d.path && silentUntitled) continue;
    if (!(await saveDoc(d))) return false;
  }
  return true;
}

export async function closeDoc(d = app.active, { force = false } = {}) {
  if (!d) return true;
  if (d === app.active) d.state = app.view.state;
  if (d.dirty && !force) {
    activate(d);
    const r = await confirmDialog({ title: `保存对 “${d.name}” 的修改？`, message: '如果不保存，你的更改将会丢失。', ok: '保存', cancel: '取消', third: '不保存' });
    if (r === false) return false;
    if (r === true && !(await saveDoc(d))) return false;
  }
  const i = app.docs.indexOf(d);
  app.docs.splice(i, 1);
  if (d.path) api.unwatch(d.path);
  if (app.active === d) {
    app.active = null;
    const next = app.docs[i] || app.docs[i - 1];
    if (next) activate(next);
    else newDocument();
  }
  renderTabs();
  emit('docs-changed');
  saveSessionSoon();
  return true;
}

export async function closeOthers(keep) {
  for (const d of [...app.docs]) if (d !== keep) { if (!(await closeDoc(d))) return; }
}

export function goToLine(line, column = 0, { flash = false, select = false } = {}) {
  const st = app.view.state;
  const ln = st.doc.line(Math.max(1, Math.min(st.doc.lines, line)));
  const pos = Math.min(ln.to, ln.from + Math.max(0, column || 0));
  app.view.dispatch({
    selection: select ? EditorSelection.range(ln.from, ln.to) : EditorSelection.cursor(pos),
    effects: [EditorView.scrollIntoView(pos, { y: 'center' }), ...(flash ? [flashLineEffect.of(ln.from)] : [])],
  });
  if (flash) setTimeout(() => { try { app.view.dispatch({ effects: flashLineEffect.of(null) }); } catch {} }, 1200);
  app.view.focus();
}

// ---------- external changes ----------
export function initWatching() {
  api.onFileChanged(async ({ path, exists, mtime }) => {
    const d = findDoc(path);
    if (d) {
      if (!exists) { toast(`${d.name} 已在磁盘上被删除`, 'error', 3500); d.dirty = true; renderTabs(); return; }
      if (mtime && Math.abs(mtime - d.mtime) < 5) return;
      let r;
      try { r = await api.read(path); } catch { return; }
      if (r.content === d.state.doc.toString()) { d.mtime = r.mtime; return; }
      if (d.dirty) {
        const ok = await confirmDialog({ title: `“${d.name}” 已在外部被修改`, message: '是否重新加载？当前未保存的修改将会丢失。', ok: '重新加载', cancel: '保留我的版本' });
        if (!ok) { d.mtime = r.mtime; return; }
      }
      replaceDocContent(d, r.content);
      d.mtime = r.mtime;
      d.savedDoc = d.state.doc; d.savedLength = d.state.doc.length; d.dirty = false;
      renderTabs();
      toast(`已重新加载 ${d.name}`);
    }
    emit('file-changed', path);
  });
}

function replaceDocContent(d, content) {
  const st = d === app.active ? app.view.state : d.state;
  const tr = st.update({ changes: { from: 0, to: st.doc.length, insert: content }, selection: EditorSelection.cursor(Math.min(st.selection.main.head, content.length)) });
  if (d === app.active) app.view.dispatch(tr); else d.state = tr.state;
}

// ---------- project context ----------
export function currentText() { return app.view.state.doc.toString(); }

export async function rootFor(d = app.active) {
  if (!d) return null;
  if (app.master) return app.master;
  const text = d === app.active ? app.view.state.doc.toString() : d.state.doc.toString();
  if (!d.path) return null;
  return detectRoot(d.path, text, { getOpenText, openPaths: app.docs.map((x) => x.path).filter(Boolean) });
}

export function projectDir() {
  if (app.folder) return app.folder;
  if (app.master) return dirname(app.master);
  if (app.root) return dirname(app.root);
  if (app.active?.path) return dirname(app.active.path);
  return null;
}

let indexing = false, indexAgain = false;
export async function refreshContext() {
  if (indexing) { indexAgain = true; return; }
  indexing = true;
  try {
    const root = await rootFor();
    const rootChanged = !samePath(root, app.root);
    app.root = root;
    const dir = projectDir();
    if (dir && (rootChanged || !app.projectFiles.length || app.projectFilesDir !== dir)) {
      app.projectFilesDir = dir;
      try { app.projectFiles = await api.list(dir, 6000); } catch { app.projectFiles = []; }
    }
    if (root) {
      app.index = await indexProject(root, getOpenText, app.projectFiles);
    } else {
      app.index = null;
    }
    setCompletionContext({ index: app.index, files: app.projectFiles, rootDir: root ? dirname(root) : dir, fileDir: app.active?.path ? dirname(app.active.path) : dir });
    setHoverContext({ index: app.index, rootDir: root ? dirname(root) : dir, settings: app.settings });
    if (rootChanged) renderTabs();
    emit('index', app.index, rootChanged);
  } catch (e) { console.error(e); }
  indexing = false;
  if (indexAgain) { indexAgain = false; refreshContext(); }
}
const scheduleIndex = debounce(refreshContext, 900);
export async function refreshProjectFiles() {
  const dir = projectDir();
  if (dir) { try { app.projectFiles = await api.list(dir, 6000); } catch {} }
  setCompletionContext({ files: app.projectFiles });
  emit('project-files');
}

async function resolveImage(arg) {
  const base = app.root ? dirname(app.root) : projectDir();
  if (!base) return null;
  const name = arg.trim();
  const tries = extname(name) ? [name] : [name + '.pdf', name + '.png', name + '.jpg', name + '.jpeg', name];
  const dirs = [base];
  // \graphicspath support
  const text = app.root ? getOpenText(app.root) || '' : '';
  const gp = /\\graphicspath\s*\{((?:\{[^}]*\})+)\}/.exec(text);
  if (gp) for (const m of gp[1].matchAll(/\{([^}]*)\}/g)) dirs.push(resolve(base, m[1]));
  for (const d of dirs) for (const t of tries) {
    const p = resolve(d, t);
    const st = await api.stat(p);
    if (st.exists && !st.isDir) return p;
  }
  return null;
}

export function engineFor(rootPath) {
  const t = (rootPath && getOpenText(rootPath)) || '';
  return guessEngine(t) || app.settings.engine;
}

// ---------- recent ----------
function addRecent(path) {
  const list = (app.settings.recentFiles || []).filter((p) => !samePath(p, path));
  list.unshift(path);
  updateSettings({ recentFiles: list.slice(0, 15) });
}
function removeRecent(path) {
  updateSettings({ recentFiles: (app.settings.recentFiles || []).filter((p) => !samePath(p, path)) });
}

// ---------- diagnostics ----------
export function applyDiagnostics(issues) {
  app.issues = issues || [];
  for (const d of app.docs) {
    if (!d.path) continue;
    const st = d === app.active ? app.view.state : d.state;
    const diags = [];
    for (const is of app.issues) {
      if (!is.file || !samePath(is.file, d.path) || !is.line) continue;
      if (is.line > st.doc.lines) continue;
      const ln = st.doc.line(is.line);
      diags.push({ from: ln.from, to: ln.to, severity: is.type === 'error' ? 'error' : is.type === 'warning' ? 'warning' : 'info', message: is.message });
    }
    const spec = setDiagnostics(st, diags);
    if (d === app.active) app.view.dispatch(spec); else d.state = d.state.update(spec).state;
  }
}

// ---------- tabs ----------
let tabsEl;
export function mountTabs(el) { tabsEl = el; renderTabs(); }

const TAB_COLORS = { '.tex': 'var(--primary)', '.bib': '#248a3d', '.sty': '#c93400', '.cls': '#c93400' };
export function renderTabs() {
  if (!tabsEl) return;
  tabsEl.replaceChildren();
  for (const d of app.docs) {
    const ext = extname(d.name);
    const isRoot = app.root && d.path && samePath(app.root, d.path) && app.docs.length > 1;
    const tab = h('div', {
      class: `doc-tab ${d === app.active ? 'active' : ''} ${d.dirty ? 'dirty' : ''}`,
      title: d.path || d.name,
      draggable: 'true',
      onmousedown: (e) => { if (e.button === 1) { e.preventDefault(); closeDoc(d); } },
      onclick: () => activate(d),
      oncontextmenu: (e) => { e.preventDefault(); tabMenu(d, e.clientX, e.clientY); },
    },
      h('span', { class: 'tab-ico', style: { background: TAB_COLORS[ext] || 'var(--text-3)' } }, (ext.slice(1, 2) || 't').toUpperCase()),
      h('span', { class: 'tab-name' }, d.name),
      isRoot ? h('span', { class: 'tab-badge' }, '主') : null,
      h('button', { class: 'tab-close', title: '关闭', onclick: (e) => { e.stopPropagation(); closeDoc(d); } }, h('span', { class: 'tab-dot' }), icon('x', 12, 2.2)),
    );
    tab.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-tab', String(d.id)); tab.classList.add('dragging'); });
    tab.addEventListener('dragend', () => tab.classList.remove('dragging'));
    tab.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-tab')) { e.preventDefault(); tab.classList.add('drop'); } });
    tab.addEventListener('dragleave', () => tab.classList.remove('drop'));
    tab.addEventListener('drop', (e) => {
      tab.classList.remove('drop');
      const id = +e.dataTransfer.getData('text/x-tab');
      const src = app.docs.find((x) => x.id === id);
      if (!src || src === d) return;
      app.docs.splice(app.docs.indexOf(src), 1);
      app.docs.splice(app.docs.indexOf(d), 0, src);
      renderTabs();
      saveSessionSoon();
    });
    tabsEl.append(tab);
  }
  const act = tabsEl.querySelector('.doc-tab.active');
  act?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  document.title = (app.active ? (app.active.dirty ? '● ' : '') + app.active.name + ' — ' : '') + 'TeX Studio Minimal';
  emit('tabs');
}

function tabMenu(d, x, y) {
  showMenu([
    { label: '保存', icon: 'save', run: () => saveDoc(d) },
    { label: '关闭', icon: 'x', run: () => closeDoc(d) },
    { label: '关闭其他标签', run: () => closeOthers(d) },
    { sep: true },
    { label: '设为主文档', icon: 'star', disabled: !d.path, checked: app.master && d.path && samePath(app.master, d.path), run: () => setMaster(app.master && samePath(app.master, d.path) ? null : d.path) },
    { label: '复制路径', icon: 'copy', disabled: !d.path, run: () => api.clipboardWrite(d.path) },
    { label: '在资源管理器中显示', icon: 'folder-open', disabled: !d.path, run: () => api.reveal(d.path) },
  ], x, y);
}

export function setMaster(path) {
  app.master = path ? normalize(path) : null;
  toast(path ? `主文档：${basename(path)}` : '已取消主文档，按当前文件自动判断');
  refreshContext();
  renderTabs();
  saveSessionSoon();
  emit('master');
}

// ---------- session ----------
export const saveSessionSoon = debounce(saveSession, 800);
export function saveSession() {
  if (app.active) { app.active.state = app.view.state; app.active.scrollTop = app.view.scrollDOM.scrollTop; }
  const s = {
    docs: app.docs.filter((d) => d.path).map((d) => ({ path: d.path, sel: d.state.selection.main.head, scrollTop: d.scrollTop })),
    active: app.active?.path || null,
    master: app.master,
    folder: app.folder,
    layout: app.layout,
    pdf: app.pdfState?.(),
  };
  api.setSession(s);
}

export async function restoreSession() {
  const s = await api.getSession();
  const launch = app.info.launchFiles || [];
  if (s) {
    app.master = s.master || null;
    app.folder = s.folder || null;
    if (s.layout) app.layout = { ...app.layout, ...s.layout };
    for (const it of s.docs || []) {
      const st = await api.stat(it.path);
      if (!st.exists) continue;
      const d = await openFile(it.path, { background: true, focus: false });
      if (d) {
        const pos = Math.min(it.sel || 0, d.state.doc.length);
        d.state = d.state.update({ selection: EditorSelection.cursor(pos) }).state;
        d.scrollTop = it.scrollTop || 0;
      }
    }
    app.restoredPdf = s.pdf;
  }
  for (const f of launch) await openFile(f, { background: true });
  const target = (launch[0] && findDoc(launch[0])) || (s?.active && findDoc(s.active)) || app.docs[0];
  if (target) activate(target); else newDocument();
  renderTabs();
}

export { magicComments };
