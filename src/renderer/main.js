import 'katex/dist/katex.min.css';
import '../styles/tokens.css';
import '../styles/app.css';
import { app, on, emit, loadSettings, initTheme, createEditor, mountTabs, restoreSession, initWatching, saveAll, saveSession, saveSessionSoon, openFile, setMaster, updateSettings, isDark, applyTheme, rootFor, projectDir } from './app.js';
import { registerCommands, installShortcuts, mountMenubar, initContextMenu, runCommand } from './commands.js';
import { build, compile, stopCompile, inverseSearch, forwardSearch, mountMessages, mountOutput, mountLog } from './build.js';
import { mountFiles, mountOutline, mountSearch, mountSymbols, mountBib } from './panels.js';
import { PdfViewer } from './pdfview.js';
import { h, $, debounce, basename, dirname, relative, samePath } from './util.js';
import { insertText } from './editor/extras.js';
import { icon } from './icons.js';
import { iconButton, makeSplitter, showMenu, confirmDialog, toast } from './ui.js';

const api = window.api;

app.layout = { sidebar: true, pdf: true, panel: false, sidebarWidth: 264, pdfWidth: 0.44, panelHeight: 230, sidebarTab: 'files', panelTab: 'messages' };

async function main() {
  await loadSettings();
  await initTheme();
  registerCommands();
  buildLayout();
  installShortcuts();
  initContextMenu();
  initWatching();
  await restoreSession();
  applyLayout();
  if (app.restoredPdf?.path) {
    const st = await api.stat(app.restoredPdf.path);
    if (st.exists) { build.pdfPath = app.restoredPdf.path; await app.pdf.show(app.restoredPdf.path, { scrollTop: app.restoredPdf.scrollTop, zoom: app.restoredPdf.zoom }); }
  }
  if (!app.pdf.viewer.path) tryShowRootPdf();
  wireAutomation();
  api.onOpenFile(({ path }) => { if (/\.pdf$/i.test(path)) app.pdf.show(path, { reveal: true }); else openFile(path); });
  api.onRequestClose(onRequestClose);
  document.body.classList.add('ready');
  // Handle used by the scripted UI checks (TXS_SCRIPT) during development.
  window.__txs = { app, runCommand, compile, forwardSearch, openFile };
}

async function tryShowRootPdf() {
  const root = await rootFor();
  if (!root || !/\.tex$/i.test(root)) return;
  const pdf = root.replace(/\.tex$/i, '.pdf');
  const st = await api.stat(pdf);
  if (st.exists) { build.pdfPath = pdf; app.pdf.show(pdf); }
}

// ======================= layout =======================
let els = {};
function buildLayout() {
  const root = $('#app');

  // ---- title bar ----
  const menubar = h('nav', { class: 'menubar' });
  const docTitle = h('div', { class: 'tb-doc' });
  const buildBtn = h('button', { class: 'btn btn-primary build-btn', 'data-tip': '编译并预览', 'data-key': 'F5', onclick: () => (build.running ? stopCompile() : compile({ view: true })) });
  const engineBtn = h('button', { class: 'engine-btn', 'data-tip': '默认编译器', onclick: (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu([{ header: '默认编译器' }, ...['pdflatex', 'xelatex', 'lualatex'].map((x) => ({ label: x, checked: app.settings.engine === x, run: () => runCommand('engine.' + x) })), { sep: true }, { label: '编译设置…', icon: 'settings', run: () => runCommand('file.settings') }], r.left, r.bottom + 6);
  } });
  const themeBtn = iconButton(isDark() ? 'sun' : 'moon', '切换深色 / 浅色', () => runCommand('view.theme'));
  const tSidebar = iconButton('panel-left', '侧栏', () => runCommand('view.sidebar'), { key: 'Alt-1' });
  const tPanel = iconButton('panel-bottom', '消息面板', () => runCommand('view.panel'), { key: 'Alt-3' });
  const tPdf = iconButton('panel-right', 'PDF 预览', () => runCommand('view.pdf'), { key: 'Alt-2' });
  const titlebar = h('header', { class: 'titlebar' },
    h('div', { class: 'tb-left' }, h('div', { class: 'logo-mark', title: 'TeX Studio Minimal' }, 'Tx'), menubar),
    h('div', { class: 'tb-center' }, docTitle),
    h('div', { class: 'tb-right' }, h('div', { class: 'build-group' }, engineBtn, buildBtn), h('div', { class: 'tb-sep' }), tSidebar, tPanel, tPdf, themeBtn, iconButton('settings', '设置', () => runCommand('file.settings'), { key: 'Mod-,' })),
    h('div', { class: 'tb-overlay-space' }),
  );
  mountMenubar(menubar);

  // ---- sidebar ----
  const sideTabs = [['files', 'files', '文件'], ['outline', 'outline', '结构'], ['search', 'search', '搜索'], ['symbols', 'sigma', '符号'], ['bib', 'book', '文献']];
  const sideSeg = h('div', { class: 'seg seg-icons side-seg' });
  const sideBodies = {};
  for (const [k, ic, tip] of sideTabs) {
    sideSeg.append(h('button', { 'data-k': k, 'data-tip': tip, onclick: () => app.sidebar.show(k) }, icon(ic, 16)));
    sideBodies[k] = h('div', { class: 'side-body', 'data-k': k });
  }
  const sidebar = h('aside', { class: 'sidebar card' }, h('div', { class: 'side-top' }, sideSeg), ...Object.values(sideBodies));
  mountFiles(sideBodies.files);
  mountOutline(sideBodies.outline);
  const search = mountSearch(sideBodies.search);
  mountSymbols(sideBodies.symbols);
  mountBib(sideBodies.bib);
  app.sidebar = {
    show(k, { focusSearch, open = true } = {}) {
      app.layout.sidebarTab = k;
      if (open && !app.layout.sidebar) { app.layout.sidebar = true; applyLayout(); }
      sideSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.k === k));
      for (const [kk, el] of Object.entries(sideBodies)) el.hidden = kk !== k;
      if (k === 'search') search.focus(focusSearch);
      saveSessionSoon();
    },
  };

  // ---- editor card ----
  const tabs = h('div', { class: 'doc-tabs' });
  const toolbar = buildEditToolbar();
  const editorHost = h('div', { class: 'editor-host' });
  const editorCard = h('section', { class: 'editor-card card' },
    h('div', { class: 'tabs-row' }, tabs, h('button', { class: 'icon-btn icon-btn-sm', 'data-tip': '新建', onclick: () => runCommand('file.new') }, icon('plus', 15))),
    toolbar, editorHost);
  createEditor(editorHost);
  mountTabs(tabs);

  // ---- bottom panel ----
  const pTabs = [['messages', '消息'], ['log', '日志'], ['output', '输出']];
  const pSeg = h('div', { class: 'seg seg-sm' });
  const pBodies = {};
  for (const [k, label] of pTabs) {
    pSeg.append(h('button', { 'data-k': k, onclick: () => showPanel(k) }, label, k === 'messages' ? h('span', { class: 'seg-count error', id: 'msg-count', hidden: true }) : null));
    pBodies[k] = h('div', { class: 'panel-body', 'data-k': k });
  }
  const panel = h('section', { class: 'panel card' },
    h('div', { class: 'panel-head' }, pSeg, h('div', { class: 'panel-step muted' }), iconButton('x', '关闭面板', () => { app.layout.panel = false; applyLayout(); }, { cls: 'icon-btn-sm' })),
    ...Object.values(pBodies));
  mountMessages(pBodies.messages);
  mountLog(pBodies.log);
  mountOutput(pBodies.output);
  function showPanel(k, { open = true } = {}) {
    app.layout.panelTab = k;
    if (open && !app.layout.panel) { app.layout.panel = true; applyLayout(); }
    pSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.k === k));
    for (const [kk, el] of Object.entries(pBodies)) el.hidden = kk !== k;
  }
  app.showPanel = showPanel;

  const center = h('section', { class: 'center' }, editorCard, h('div', { class: 'splitter sy', id: 'split-panel' }), panel);

  // ---- PDF ----
  const pdfCard = buildPdfPane();

  const workspace = h('main', { class: 'workspace' }, sidebar, h('div', { class: 'splitter sx', id: 'split-side' }), center, h('div', { class: 'splitter sx', id: 'split-pdf' }), pdfCard);

  // ---- status bar ----
  const sbStatus = h('div', { class: 'sb-item sb-status' });
  const sbRoot = h('button', { class: 'sb-item sb-btn', 'data-tip': '主文档（编译入口）' });
  const sbPos = h('div', { class: 'sb-item tabular' });
  const sbEngine = h('button', { class: 'sb-item sb-btn' });
  const sbEnc = h('div', { class: 'sb-item' });
  const sbLang = h('div', { class: 'sb-item' });
  const sbSpell = h('button', { class: 'sb-item sb-btn', 'data-tip': '拼写检查', onclick: () => updateSettings({ spellcheck: !app.settings.spellcheck }) });
  const statusbar = h('footer', { class: 'statusbar' }, h('div', { class: 'sb-left' }, sbStatus, sbRoot), h('div', { class: 'sb-right' }, sbPos, sbSpell, sbEnc, sbLang, sbEngine));

  root.append(titlebar, workspace, statusbar);
  els = { root, titlebar, docTitle, buildBtn, engineBtn, themeBtn, tSidebar, tPanel, tPdf, sidebar, center, panel, pdfCard, workspace, sbStatus, sbRoot, sbPos, sbEngine, sbEnc, sbLang, sbSpell, editorCard };

  // ---- splitters ----
  let start;
  makeSplitter($('#split-side'), { onMove: (dx) => { start ??= app.layout.sidebarWidth; app.layout.sidebarWidth = Math.max(190, Math.min(520, start + dx)); applyLayout(); }, onEnd: () => { start = null; saveSessionSoon(); } });
  makeSplitter($('#split-pdf'), { onMove: (dx) => {
    const W = workspace.clientWidth;
    start ??= app.layout.pdfWidth * W;
    app.layout.pdfWidth = Math.max(0.18, Math.min(0.75, (start - dx) / W));
    applyLayout();
  }, onEnd: () => { start = null; saveSessionSoon(); } });
  makeSplitter($('#split-panel'), { axis: 'y', onMove: (dy) => { start ??= app.layout.panelHeight; app.layout.panelHeight = Math.max(110, Math.min(center.clientHeight - 160, start - dy)); applyLayout(); }, onEnd: () => { start = null; saveSessionSoon(); } });

  // ---- status updates ----
  const setStatus = (kind, text) => { sbStatus.replaceChildren(h('span', { class: `status-dot ${kind}` }), h('span', {}, text)); };
  setStatus('idle', '就绪');
  on('build-start', ({ engine }) => {
    setStatus('running', `正在编译 · ${engine}`);
    buildBtn.classList.add('running');
    renderBuildBtn();
  });
  on('build-step', (s) => { setStatus('running', `正在运行 ${s}…`); panel.querySelector('.panel-step').textContent = s; });
  on('build-end', (res) => {
    buildBtn.classList.remove('running');
    renderBuildBtn();
    panel.querySelector('.panel-step').textContent = '';
    const errors = (res.issues || []).filter((x) => x.type === 'error').length;
    const warnings = (res.issues || []).filter((x) => x.type === 'warning').length;
    const cnt = $('#msg-count');
    cnt.hidden = !errors; cnt.textContent = errors;
    if (res.tool) setStatus(res.ok ? 'success' : 'error', `${res.tool} ${res.ok ? '完成' : '失败'}`);
    else if (res.stopped) setStatus('idle', '已停止');
    else if (errors) setStatus('error', `${errors} 个错误${warnings ? `，${warnings} 个警告` : ''}`);
    else setStatus('success', `编译成功 · ${((res.duration || 0) / 1000).toFixed(1)}s${warnings ? ` · ${warnings} 个警告` : ''}`);
    if (errors && app.settings.showLogOnError) showPanel('messages');
  });
  sbStatus.addEventListener('click', () => showPanel('messages'));
  sbRoot.addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const items = [{ header: '主文档' }];
    if (app.master) items.push({ label: '取消主文档（自动判断）', icon: 'x', run: () => setMaster(null) });
    for (const d of app.docs.filter((x) => x.path && /\.tex$/i.test(x.path))) items.push({ label: d.name, checked: app.master && samePath(app.master, d.path), run: () => setMaster(d.path) });
    showMenu(items, r.left, r.top - 10 - (items.length * 32 + 20));
  });
  sbEngine.addEventListener('click', (e) => els.engineBtn.click());

  const renderStatus = () => {
    const st = app.view.state;
    const sel = st.selection.main;
    const line = st.doc.lineAt(sel.head);
    const n = sel.to - sel.from;
    sbPos.textContent = `行 ${line.number}，列 ${sel.head - line.from + 1}${n ? `（已选 ${n}）` : ''}`;
  };
  on('cursor', debounce(renderStatus, 30));
  const renderMeta = () => {
    const d = app.active;
    sbEnc.textContent = d?.encoding || 'UTF-8';
    sbLang.textContent = d && /\.bib$/i.test(d.name) ? 'BibTeX' : 'LaTeX';
    sbEngine.textContent = app.settings.engine;
    engineBtn.textContent = app.settings.engine;
    sbSpell.textContent = app.settings.spellcheck ? '拼写 EN' : '拼写 关';
    sbSpell.classList.toggle('off', !app.settings.spellcheck);
    const root = app.root;
    sbRoot.replaceChildren(...[icon(app.master ? 'star' : 'file-text', 13), h('span', {}, root ? basename(root) : '无主文档'), app.master ? h('span', { class: 'sb-pin' }, '已固定') : null].filter(Boolean));
    docTitle.replaceChildren(...[
      d ? h('span', { class: 'tb-doc-name' }, d.name) : null,
      root && d?.path && !samePath(root, d.path) ? h('span', { class: 'tb-doc-root' }, '属于 ' + basename(root)) : null,
    ].filter(Boolean));
  };
  on('active', renderMeta);
  on('index', renderMeta);
  on('tabs', renderMeta);
  on('settings', renderMeta);
  on('engine', renderMeta);
  on('master', renderMeta);
  on('theme', (dark) => { themeBtn.replaceChildren(icon(dark ? 'sun' : 'moon', 16)); app.pdf?.applyInvert(); });
  renderBuildBtn();
}

function renderBuildBtn() {
  const b = els.buildBtn;
  b.replaceChildren(build.running ? h('span', { class: 'btn-spinner' }) : icon('play', 14, 2.2), h('span', {}, build.running ? '停止' : '编译'));
  b.dataset.tip = build.running ? '停止编译' : '编译并预览';
}

function buildEditToolbar() {
  const tb = (ic, tip, id, glyph) => h('button', { class: 'icon-btn icon-btn-sm', 'data-tip': tip, 'data-key': app.commandList.find((c) => c.id === id)?.key, onmousedown: (e) => e.preventDefault(), onclick: () => runCommand(id) }, glyph ? h('span', { class: 'glyph ' + (glyph.cls || '') }, glyph.t) : icon(ic, 16));
  const sep = () => h('span', { class: 'tb-divider' });
  const secBtn = h('button', { class: 'tb-drop', onmousedown: (e) => e.preventDefault(), onclick: (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph'].map((k) => { const c = app.commandList.find((x) => x.id === 'sec.' + k); return { label: c.label, shortcut: c.key, run: () => runCommand(c.id) }; }), r.left, r.bottom + 4);
  } }, icon('heading', 16), h('span', {}, '章节'), icon('chevron-down', 12, 2));
  const envBtn = h('button', { class: 'tb-drop', onmousedown: (e) => e.preventDefault(), onclick: (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(['env.itemize', 'env.enumerate', 'env.description', null, 'env.figure', 'env.table', null, 'math.equation', 'math.align', 'env.center', 'env.minipage', 'env.frame', null, 'env.custom'].map((id) => { if (!id) return { sep: true }; const c = app.commandList.find((x) => x.id === id); return { label: c.label, icon: c.icon, shortcut: c.key, run: () => runCommand(id) }; }), r.left, r.bottom + 4);
  } }, icon('braces', 16), h('span', {}, '环境'), icon('chevron-down', 12, 2));
  return h('div', { class: 'edit-toolbar' },
    tb('undo', '撤销', 'edit.undo'), tb('redo', '重做', 'edit.redo'), sep(),
    secBtn, envBtn, sep(),
    tb(null, '粗体', 'fmt.bold', { t: 'B', cls: 'g-bold' }), tb('italic', '斜体', 'fmt.italic'), tb('underline', '下划线', 'fmt.underline'), tb(null, '强调 \\emph', 'fmt.emph', { t: 'em', cls: 'g-em' }), tb('code', '等宽', 'fmt.tt'), sep(),
    tb('list', '无序列表', 'env.itemize'), tb('list-ordered', '有序列表', 'env.enumerate'), tb('image', '插入图片', 'env.figure'), tb('table', '插入表格', 'env.table'), sep(),
    tb(null, '行内公式', 'math.inline', { t: '$x$', cls: 'g-math' }), tb(null, '行间公式', 'math.display', { t: '\\[ \\]', cls: 'g-math' }), tb('divide', '分数', 'math.frac'), tb('radical', '根号', 'math.sqrt'), tb('superscript', '上标', 'math.sup'), tb('subscript', '下标', 'math.sub'), tb('grid', '矩阵', 'math.matrix'), sep(),
    tb('tag', '标签 \\label', 'ins.label'), tb('link', '引用 \\ref', 'ins.ref'), tb('cite', '文献 \\cite', 'ins.cite'),
    h('div', { class: 'tb-flex' }),
    tb('sparkles', '格式化文档', 'edit.format'), tb('wrap', '自动换行', 'view.wrap'), tb('locate', '在 PDF 中定位', 'build.forward'),
  );
}

function buildPdfPane() {
  const scroll = h('div', { class: 'pdf-scroll', tabindex: '0' });
  const pageInput = h('input', { class: 'pdf-page-input tabular', value: '0' });
  const pageTotal = h('span', { class: 'muted tabular' }, '/ 0');
  const zoomLabel = h('button', { class: 'pdf-zoom-label tabular', 'data-tip': '缩放' }, '100%');
  const empty = h('div', { class: 'pdf-empty' }, h('div', { class: 'pdf-empty-ico' }, icon('file-type', 34, 1.4)), h('div', { class: 'pdf-empty-title' }, '还没有预览'), h('div', { class: 'muted' }, '按 ', h('span', { class: 'kbd' }, 'F5'), ' 编译并预览当前文档'), h('button', { class: 'btn btn-primary btn-sm', onclick: () => compile({ view: true }) }, icon('play', 13, 2.2), '编译'));
  const findInput = h('input', { class: 'input input-sm', placeholder: '在 PDF 中查找', spellcheck: 'false' });
  const findCount = h('span', { class: 'muted tabular find-count' });
  const findBar = h('div', { class: 'pdf-find', hidden: true }, icon('search', 15), findInput, findCount,
    iconButton('chevron-up', '上一个', () => doFind(true), { cls: 'icon-btn-sm' }), iconButton('chevron-down', '下一个', () => doFind(false), { cls: 'icon-btn-sm' }),
    iconButton('x', '关闭', () => closeFind(), { cls: 'icon-btn-sm' }));
  const fitW = iconButton('fit-width', '适合宽度', () => { viewer.applyZoom('width'); markFit(); });
  const fitP = iconButton('maximize', '适合整页', () => { viewer.applyZoom('page'); markFit(); });
  const toolbar = h('div', { class: 'pdf-toolbar' },
    h('div', { class: 'pdf-pages-nav' }, pageInput, pageTotal),
    h('div', { class: 'tb-divider' }),
    iconButton('zoom-out', '缩小', () => viewer.zoomBy(1 / 1.15)), zoomLabel, iconButton('zoom-in', '放大', () => viewer.zoomBy(1.15)),
    fitW, fitP,
    h('div', { class: 'tb-flex' }),
    iconButton('search', '查找', () => openFind(), { key: 'Mod-f' }),
    iconButton('locate', '定位到光标处', () => forwardSearch(), { key: 'Mod-Alt-j' }),
    iconButton('refresh', '重新加载', () => viewer.path && viewer.load(viewer.path)),
    iconButton('external', '用外部程序打开', () => runCommand('build.external')),
  );
  const card = h('section', { class: 'pdf-card card' }, toolbar, findBar, h('div', { class: 'pdf-stage' }, scroll, empty));

  const viewer = new PdfViewer(scroll, {
    onInverse: (p) => inverseSearch(p),
    onPageChange: (n, total) => { pageInput.value = n; pageTotal.textContent = '/ ' + total; savePdfSoon(); },
    onZoomChange: (s) => { zoomLabel.textContent = Math.round(s * 100) + '%'; markFit(); savePdfSoon(); },
    onStatus: (k, msg) => toast(msg, k),
  });
  viewer.dblClickSync = !!app.settings.pdfDblClick;
  const savePdfSoon = debounce(saveSessionSoon, 400);
  const markFit = () => { fitW.classList.toggle('on', viewer.zoomMode === 'width'); fitP.classList.toggle('on', viewer.zoomMode === 'page'); };
  pageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { viewer.goToPage(+pageInput.value || 1); scroll.focus(); } });
  pageInput.addEventListener('focus', () => pageInput.select());
  zoomLabel.addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu([
      { label: '适合宽度', checked: viewer.zoomMode === 'width', run: () => viewer.applyZoom('width') },
      { label: '适合整页', checked: viewer.zoomMode === 'page', run: () => viewer.applyZoom('page') },
      { sep: true },
      ...[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((z) => ({ label: Math.round(z * 100) + '%', checked: viewer.zoomMode === z, run: () => viewer.applyZoom(z) })),
    ], r.left - 40, r.bottom + 4, { minWidth: 140 });
  });
  scroll.addEventListener('keydown', (e) => {
    if (e.key === 'PageDown' || e.key === 'PageUp' || e.key === 'Home' || e.key === 'End') return;
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); viewer.zoomBy(1.15); }
    if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); viewer.zoomBy(1 / 1.15); }
    if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); viewer.applyZoom('width'); }
  });

  let findT;
  async function doFind(back) {
    const r = await viewer.find(findInput.value, { backwards: back });
    findCount.textContent = findInput.value ? (r.total ? `${r.index + 1}/${r.total}` : '无结果') : '';
  }
  findInput.addEventListener('input', () => { clearTimeout(findT); findT = setTimeout(() => doFind(false), 220); });
  findInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doFind(e.shiftKey); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); } });
  function openFind() { findBar.hidden = false; findInput.focus(); findInput.select(); }
  function closeFind() { findBar.hidden = true; viewer.clearSearch(); findCount.textContent = ''; scroll.focus(); }

  app.pdf = {
    viewer,
    async show(path, { reveal = false, scrollTop, zoom } = {}) {
      if (reveal || !app.layout.pdf) { app.layout.pdf = true; applyLayout(); }
      if (zoom != null && viewer.path == null) viewer.zoomMode = zoom;
      const ok = await viewer.load(path);
      empty.hidden = ok || !!viewer.path;
      card.classList.toggle('has-pdf', !!viewer.path);
      if (ok && scrollTop != null) scroll.scrollTop = scrollTop;
      api.watch(path);
      return ok;
    },
    reveal() { if (!app.layout.pdf) { app.layout.pdf = true; applyLayout(); } },
    openFind,
    applyInvert() { card.classList.toggle('invert', !!app.settings.pdfInvert && isDark()); },
  };
  app.pdfState = () => (viewer.path ? { path: viewer.path, scrollTop: scroll.scrollTop, zoom: viewer.zoomMode } : null);
  app.pdf.applyInvert();

  // Reload when the PDF changes on disk (e.g. compiled outside the app)
  on('file-changed', debounce((p) => { if (viewer.path && samePath(p, viewer.path) && !build.running) viewer.load(viewer.path); }, 500));
  return card;
}

export function applyLayout() {
  const L = app.layout;
  els.sidebar.style.display = L.sidebar ? '' : 'none';
  $('#split-side').style.display = L.sidebar ? '' : 'none';
  els.sidebar.style.width = L.sidebarWidth + 'px';
  els.pdfCard.style.display = L.pdf ? '' : 'none';
  $('#split-pdf').style.display = L.pdf ? '' : 'none';
  els.pdfCard.style.width = (L.pdfWidth * 100).toFixed(2) + '%';
  els.panel.style.display = L.panel ? '' : 'none';
  $('#split-panel').style.display = L.panel ? '' : 'none';
  els.panel.style.height = L.panelHeight + 'px';
  els.tSidebar.classList.toggle('on', L.sidebar);
  els.tPanel.classList.toggle('on', L.panel);
  els.tPdf.classList.toggle('on', L.pdf);
  app.sidebar.show(L.sidebarTab || 'files', { open: false });
  app.showPanel(L.panelTab || 'messages', { open: false });
  saveSessionSoon();
}
app.layoutApi = {
  toggle(k) {
    app.layout[k] = !app.layout[k];
    applyLayout();
    if (k === 'panel' && app.layout.panel) app.showPanel(app.layout.panelTab);
  },
};

// ======================= automation =======================
function wireAutomation() {
  const live = debounce(() => {
    if (!app.settings.liveCompile || build.running || !app.active?.path) return;
    compile({ view: true });
  }, 1500);
  let liveDelay = app.settings.liveDelay;
  let liveFn = live;
  on('settings', (s) => {
    if (s.liveDelay !== liveDelay) { liveDelay = s.liveDelay; liveFn = debounce(() => { if (app.settings.liveCompile && !build.running && app.active?.path) compile({ view: true }); }, Math.max(400, +s.liveDelay || 1500)); }
    app.pdf.viewer.dblClickSync = !!s.pdfDblClick;
  });
  const autosave = debounce(() => { if (app.settings.autosave) saveAll({ silentUntitled: true }); }, 2500);
  on('doc-changed', () => { liveFn(); autosave(); });
  on('saved', debounce(() => { if (app.settings.autoCompileOnSave && !app.settings.liveCompile && !build.running && !build.preparing) compile({ view: true }); }, 150));
  window.addEventListener('blur', () => { if (app.settings.autosave) saveAll({ silentUntitled: true }); saveSession(); });

  // Drop files to open
  document.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    const overEditor = !!e.target.closest?.('.cm-editor');
    for (const f of e.dataTransfer.files) {
      const p = api.pathForFile(f);
      if (!p) continue;
      if (overEditor && /\.(png|jpe?g|pdf|eps|svg)$/i.test(p)) {
        // Dropping a figure into the source inserts it relative to the root document.
        const pos = app.view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos != null) app.view.dispatch({ selection: { anchor: pos } });
        const base = app.root ? dirname(app.root) : projectDir();
        const rel = base ? relative(base, p) : p.replace(/\\/g, '/');
        insertText(app.view, `\\includegraphics[width=0.8\\linewidth]{${rel}}`);
      } else if (/\.pdf$/i.test(p)) app.pdf.show(p, { reveal: true });
      else openFile(p);
    }
  });
}

async function onRequestClose() {
  const dirty = app.docs.filter((d) => d.dirty);
  if (dirty.length) {
    const r = await confirmDialog({ title: `有 ${dirty.length} 个文件尚未保存`, message: dirty.map((d) => '· ' + d.name).join('\n'), ok: '全部保存', cancel: '取消', third: '不保存' });
    if (r === false) return;
    if (r === true && !(await saveAll())) return;
  }
  saveSession();
  await new Promise((r) => setTimeout(r, 60));
  api.confirmClose();
}

main().catch((e) => { console.error(e); document.body.append(h('pre', { class: 'fatal' }, String(e.stack || e))); });
