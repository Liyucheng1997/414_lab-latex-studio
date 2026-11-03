// Command registry, menus, global shortcuts and the editor context menu.
import { undo, redo, selectAll, toggleLineComment, indentMore, indentLess, cursorDocStart } from '@codemirror/commands';
import { openSearchPanel, replaceAll, selectNextOccurrence } from '@codemirror/search';
import { foldAll, unfoldAll } from '@codemirror/language';
import { startCompletion } from '@codemirror/autocomplete';
import { app, emit, newDocument, openFile, saveDoc, saveAll, closeDoc, activate, updateSettings, setMaster, rootFor, goToLine, applyTheme, isDark, projectDir, EDITOR_BGS } from './app.js';
import { compile, stopCompile, viewPdf, runTool, cleanAux, forwardSearch, build } from './build.js';
import { checkForUpdates } from './update.js';
import { openSettings, quickStart, tableWizard, figureWizard, matrixWizard, gotoLineDialog, commandPalette, quickOpen, wordCount, about } from './dialogs.js';
import { wrapWith, insertText, insertEnvironment, wordArgAt } from './editor/extras.js';
import { showMenu, closeMenus, toast, menuOpen } from './ui.js';
import { basename, samePath, h, isMac } from './util.js';
import { rewriteSelection, continueWriting, fixErrors, REWRITE_PRESETS } from './ai.js';
import { icon } from './icons.js';

const api = window.api;
const v = () => app.view;
const commands = new Map();

function cmd(id, label, run, { key, icon: ic, category, hidden, when } = {}) {
  commands.set(id, { id, label, run, key, icon: ic, category, hidden, when });
}
export function runCommand(id) {
  const c = commands.get(id);
  if (!c) return;
  try { const r = c.run(); if (r?.catch) r.catch((e) => { console.error(e); toast(String(e.message || e), 'error'); }); } catch (e) { console.error(e); toast(String(e.message || e), 'error'); }
}

const wrap = (b, a, ph = '') => () => wrapWith(v(), b, a, ph);
const ins = (t, off) => () => insertText(v(), t, off);
const env = (e, body = '', args = '') => () => insertEnvironment(v(), e, body, args);
const pdfFocused = () => document.activeElement?.closest?.('.pdf-card');

function changeCase(fn) {
  const view = v();
  view.dispatch(view.state.changeByRange((r) => ({ changes: { from: r.from, to: r.to, insert: fn(view.state.sliceDoc(r.from, r.to)) }, range: r })));
}
function uncomment() {
  const view = v();
  const st = view.state;
  const changes = [];
  const seen = new Set();
  for (const r of st.selection.ranges) {
    for (let l = st.doc.lineAt(r.from).number; l <= st.doc.lineAt(r.to).number; l++) {
      if (seen.has(l)) continue;
      seen.add(l);
      const line = st.doc.line(l);
      const m = /^(\s*)% ?/.exec(line.text);
      if (m) changes.push({ from: line.from + m[1].length, to: line.from + m[0].length });
    }
  }
  view.dispatch({ changes });
}
function comment() {
  const view = v();
  const st = view.state;
  const changes = [];
  const seen = new Set();
  for (const r of st.selection.ranges) {
    for (let l = st.doc.lineAt(r.from).number; l <= st.doc.lineAt(r.to).number; l++) {
      if (seen.has(l)) continue;
      seen.add(l);
      changes.push({ from: st.doc.line(l).from, insert: '% ' });
    }
  }
  view.dispatch({ changes });
}

async function formatDocument() {
  const view = v();
  const content = view.state.doc.toString();
  toast('正在格式化（latexindent）…');
  const r = await api.format(content, app.settings.tabSize);
  if (r.error || !r.content) { toast('格式化失败：' + (r.error || '无输出'), 'error', 4000); return; }
  if (r.content === content) { toast('已经是格式化的'); return; }
  const head = view.state.selection.main.head;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: r.content }, selection: { anchor: Math.min(head, r.content.length) } });
  toast('格式化完成', 'success');
}

async function openDialogCmd() {
  const r = await api.openDialog({ multi: true, defaultPath: projectDir() || undefined });
  if (r) for (const p of r) await openFile(p);
}

function setEngine(e) { updateSettings({ engine: e }); toast(`默认编译器：${e}`); emit('engine'); }

export function registerCommands() {
  // File
  cmd('file.new', '新建', () => newDocument(), { key: 'Mod-n', icon: 'file-plus', category: '文件' });
  cmd('file.quickstart', '快速开始向导…', quickStart, { icon: 'wand', category: '文件' });
  cmd('file.open', '打开…', openDialogCmd, { key: 'Mod-o', icon: 'file', category: '文件' });
  cmd('file.openFolder', '打开文件夹…', () => app.openFolder?.(), { key: 'Mod-Shift-o', icon: 'folder-open', category: '文件' });
  cmd('file.quickOpen', '快速打开文件…', quickOpen, { key: 'Mod-p', icon: 'search', category: '文件' });
  cmd('file.save', '保存', () => saveDoc(), { key: 'Mod-s', icon: 'save', category: '文件' });
  cmd('file.saveAs', '另存为…', () => saveDoc(app.active, { as: true }), { key: 'Mod-Shift-s', category: '文件' });
  cmd('file.saveAll', '全部保存', () => saveAll(), { key: 'Mod-Alt-s', category: '文件' });
  cmd('file.close', '关闭标签', () => closeDoc(), { key: 'Mod-w', icon: 'x', category: '文件' });
  cmd('file.master', '设为 / 取消主文档', () => { const d = app.active; if (!d?.path) return toast('请先保存文件'); setMaster(app.master && samePath(app.master, d.path) ? null : d.path); }, { icon: 'star', category: '文件' });
  cmd('file.reveal', '在资源管理器中显示', () => app.active?.path && api.reveal(app.active.path), { icon: 'folder-open', category: '文件' });
  cmd('file.settings', '设置…', () => openSettings(), { key: 'Mod-,', icon: 'settings', category: '文件' });
  cmd('file.exit', '退出', () => window.close(), { category: '文件' });
  cmd('tab.next', '下一个标签', () => { const i = app.docs.indexOf(app.active); activate(app.docs[(i + 1) % app.docs.length]); }, { key: 'Ctrl-Tab', category: '视图' });
  cmd('tab.prev', '上一个标签', () => { const i = app.docs.indexOf(app.active); activate(app.docs[(i - 1 + app.docs.length) % app.docs.length]); }, { key: 'Ctrl-Shift-Tab', category: '视图' });

  // Edit
  cmd('edit.undo', '撤销', () => undo(v()), { icon: 'undo', category: '编辑', key: 'Mod-z', hidden: false });
  cmd('edit.redo', '重做', () => redo(v()), { icon: 'redo', category: '编辑', key: 'Mod-y' });
  cmd('edit.cut', '剪切', () => { v().focus(); document.execCommand('cut'); }, { icon: 'cut', category: '编辑', key: 'Mod-x' });
  cmd('edit.copy', '复制', () => { v().focus(); document.execCommand('copy'); }, { icon: 'copy', category: '编辑', key: 'Mod-c' });
  cmd('edit.paste', '粘贴', async () => { v().focus(); const t = await navigator.clipboard.readText(); insertText(v(), t); }, { icon: 'paste', category: '编辑', key: 'Mod-v' });
  cmd('edit.selectAll', '全选', () => selectAll(v()), { category: '编辑', key: 'Mod-a' });
  cmd('edit.find', '查找', () => { if (pdfFocused()) return app.pdf.openFind(); openSearchPanel(v()); }, { key: 'Mod-f', icon: 'search', category: '编辑' });
  cmd('edit.replace', '替换', () => { openSearchPanel(v()); setTimeout(() => document.querySelector('.cm-search [name=replace]')?.focus(), 30); }, { key: 'Mod-h', icon: 'replace', category: '编辑' });
  cmd('edit.findInFiles', '在项目中搜索', () => app.sidebar.show('search', { focusSearch: v().state.sliceDoc(v().state.selection.main.from, v().state.selection.main.to) }), { key: 'Mod-Shift-f', icon: 'scan-search', category: '编辑' });
  cmd('edit.gotoLine', '跳转到行…', gotoLineDialog, { key: 'Mod-g', category: '编辑' });
  cmd('edit.nextOccurrence', '选择下一个相同项', () => selectNextOccurrence(v()), { key: 'Mod-d', category: '编辑' });
  cmd('edit.comment', '注释', comment, { key: 'Mod-t', category: '编辑' });
  cmd('edit.uncomment', '取消注释', uncomment, { key: 'Mod-u', category: '编辑' });
  cmd('edit.toggleComment', '切换注释', () => toggleLineComment(v()), { key: 'Mod-/', category: '编辑' });
  cmd('edit.indent', '增加缩进', () => indentMore(v()), { key: 'Mod-]', category: '编辑' });
  cmd('edit.outdent', '减少缩进', () => indentLess(v()), { key: 'Mod-[', category: '编辑' });
  cmd('edit.upper', '转为大写', () => changeCase((s) => s.toUpperCase()), { category: '编辑' });
  cmd('edit.lower', '转为小写', () => changeCase((s) => s.toLowerCase()), { category: '编辑' });
  cmd('edit.format', '格式化文档 (latexindent)', formatDocument, { key: 'Mod-Alt-f', icon: 'sparkles', category: '编辑' });
  cmd('edit.complete', '触发补全', () => startCompletion(v()), { key: 'Ctrl-Space', category: '编辑' });
  cmd('edit.foldAll', '折叠全部', () => foldAll(v()), { category: '编辑' });
  cmd('edit.unfoldAll', '展开全部', () => unfoldAll(v()), { category: '编辑' });

  // View
  cmd('view.sidebar', '显示 / 隐藏侧栏', () => app.layoutApi.toggle('sidebar'), { key: 'Alt-1', icon: 'panel-left', category: '视图' });
  cmd('view.pdf', '显示 / 隐藏 PDF 预览', () => app.layoutApi.toggle('pdf'), { key: 'Alt-2', icon: 'panel-right', category: '视图' });
  cmd('view.panel', '显示 / 隐藏消息面板', () => app.layoutApi.toggle('panel'), { key: 'Alt-3', icon: 'panel-bottom', category: '视图' });
  cmd('view.files', '文件', () => app.sidebar.show('files'), { icon: 'files', category: '视图' });
  cmd('view.outline', '结构', () => app.sidebar.show('outline'), { icon: 'outline', category: '视图', key: 'Mod-Shift-y' });
  cmd('view.symbols', '符号面板', () => app.sidebar.show('symbols'), { icon: 'sigma', category: '视图' });
  cmd('view.bib', '参考文献', () => app.sidebar.show('bib'), { icon: 'book', category: '视图' });
  cmd('view.theme', '切换深色 / 浅色', () => { updateSettings({ theme: isDark() ? 'light' : 'dark' }).then(applyTheme); }, { icon: 'theme', category: '视图' });
  for (const [k, label] of EDITOR_BGS) cmd('view.bg.' + k, `编辑区背景：${label}`, () => updateSettings({ editorBg: k }), { category: '视图' });
  cmd('view.bg.custom', '编辑区背景：自定义…', () => openSettings('look'), { category: '视图' });
  cmd('view.zoomIn', '增大字号', () => updateSettings({ fontSize: Math.min(32, app.settings.fontSize + 1) }), { key: 'Mod-=', category: '视图' });
  cmd('view.zoomOut', '减小字号', () => updateSettings({ fontSize: Math.max(9, app.settings.fontSize - 1) }), { key: 'Mod--', category: '视图' });
  cmd('view.zoomReset', '重置字号', () => updateSettings({ fontSize: 15 }), { key: 'Mod-0', category: '视图' });
  cmd('view.wrap', '自动换行', () => updateSettings({ wrap: !app.settings.wrap }), { icon: 'wrap', category: '视图', key: 'Alt-z' });
  cmd('view.fullscreen', '全屏', () => api.toggleFullscreen(), { key: 'F11', category: '视图' });
  cmd('view.palette', '命令面板…', commandPalette, { key: 'Mod-Shift-p', icon: 'command', category: '视图' });
  cmd('view.devtools', '开发者工具', () => api.toggleDevtools(), { key: 'F12', category: '视图', hidden: true });

  // Build
  cmd('build.buildView', '编译并预览', () => compile({ view: true }), { key: 'F5', icon: 'play', category: '编译' });
  cmd('build.compile', '编译', () => compile({ view: true }), { key: 'F6', category: '编译' });
  cmd('build.view', '查看 PDF', viewPdf, { key: 'F7', icon: 'file-type', category: '编译' });
  cmd('build.stop', '停止编译', stopCompile, { key: 'Mod-Break', icon: 'stop', category: '编译' });
  cmd('build.bibtex', '运行 BibTeX', () => runTool('bibtex'), { key: 'F8', category: '编译' });
  cmd('build.biber', '运行 Biber', () => runTool('biber'), { category: '编译' });
  cmd('build.makeindex', '运行 makeindex', () => runTool('makeindex'), { key: 'F9', category: '编译' });
  cmd('build.glossaries', '运行 makeglossaries', () => runTool('makeglossaries'), { category: '编译' });
  cmd('build.latexmk', '使用 latexmk 完整编译', () => compile({ view: true, mode: 'latexmk' }), { category: '编译' });
  cmd('build.clean', '清理辅助文件', cleanAux, { icon: 'eraser', category: '编译' });
  cmd('build.forward', '在 PDF 中定位光标', () => forwardSearch(), { key: 'Mod-Alt-j', icon: 'locate', category: '编译' });
  cmd('build.wordcount', '字数统计', wordCount, { icon: 'hash', category: '编译' });
  cmd('git.commit', '提交版本…', () => app.vc?.open('changes'), { key: 'Mod-Shift-g', icon: 'git-branch', category: '版本' });
  cmd('git.sync', '与 GitHub 同步', () => app.vc?.sync(), { icon: 'refresh', category: '版本' });
  cmd('git.history', '版本树', () => app.vc?.open('history'), { icon: 'git-graph', category: '版本' });
  cmd('build.external', '用外部程序打开 PDF', async () => { const p = build.pdfPath || app.pdf?.viewer.path; if (p) api.openExternal(p); else toast('还没有 PDF'); }, { icon: 'external', category: '编译' });
  for (const e of ['pdflatex', 'xelatex', 'lualatex']) cmd('engine.' + e, e, () => setEngine(e), { category: '编译器', hidden: false });

  // LaTeX
  const L = 'LaTeX';
  for (const [k, label, key] of [['part', '部分 \\part'], ['chapter', '章 \\chapter'], ['section', '节 \\section', 'Mod-Alt-1'], ['subsection', '小节 \\subsection', 'Mod-Alt-2'], ['subsubsection', '小小节 \\subsubsection', 'Mod-Alt-3'], ['paragraph', '段落 \\paragraph']]) {
    cmd('sec.' + k, label, wrap(`\\${k}{`, '}'), { key, category: L, icon: 'heading' });
  }
  cmd('fmt.bold', '粗体 \\textbf', wrap('\\textbf{', '}'), { key: 'Mod-b', category: L });
  cmd('fmt.italic', '斜体 \\textit', wrap('\\textit{', '}'), { key: 'Mod-i', category: L, icon: 'italic' });
  cmd('fmt.emph', '强调 \\emph', wrap('\\emph{', '}'), { key: 'Mod-Shift-e', category: L, hidden: false });
  cmd('fmt.underline', '下划线 \\underline', wrap('\\underline{', '}'), { category: L, icon: 'underline' });
  cmd('fmt.tt', '等宽 \\texttt', wrap('\\texttt{', '}'), { category: L, icon: 'code' });
  cmd('fmt.sc', '小型大写 \\textsc', wrap('\\textsc{', '}'), { category: L });
  cmd('fmt.sf', '无衬线 \\textsf', wrap('\\textsf{', '}'), { category: L });
  cmd('fmt.color', '颜色 \\textcolor', wrap('\\textcolor{red}{', '}'), { category: L });
  for (const s of ['tiny', 'scriptsize', 'footnotesize', 'small', 'normalsize', 'large', 'Large', 'LARGE', 'huge', 'Huge']) cmd('size.' + s, '\\' + s, wrap(`{\\${s} `, '}'), { category: '字号' });
  cmd('ins.item', '列表项 \\item', ins('\\item '), { key: 'Mod-Shift-i', category: L, icon: 'list' });
  cmd('ins.label', '标签 \\label', wrap('\\label{', '}'), { key: 'Mod-Alt-l', category: L, icon: 'tag' });
  cmd('ins.ref', '引用 \\ref', () => { wrapWith(v(), '\\ref{', '}'); startCompletion(v()); }, { key: 'Mod-Alt-r', category: L, icon: 'link' });
  cmd('ins.eqref', '公式引用 \\eqref', () => { wrapWith(v(), '\\eqref{', '}'); startCompletion(v()); }, { category: L });
  cmd('ins.cite', '文献引用 \\cite', () => { wrapWith(v(), '\\cite{', '}'); startCompletion(v()); }, { key: 'Mod-Alt-c', category: L, icon: 'cite' });
  cmd('ins.footnote', '脚注 \\footnote', wrap('\\footnote{', '}'), { category: L });
  cmd('ins.newline', '换行 \\\\', ins('\\\\\n'), { key: 'Mod-Enter', category: L });
  cmd('ins.newpage', '新页 \\newpage', ins('\\newpage\n'), { category: L });
  cmd('ins.usepackage', '引入宏包 \\usepackage', () => { insertText(v(), '\\usepackage{}', 12); startCompletion(v()); }, { category: L });
  cmd('ins.input', '插入文件 \\input', () => { insertText(v(), '\\input{}', 7); startCompletion(v()); }, { category: L });
  cmd('ins.url', '链接 \\href', wrap('\\href{https://}{', '}'), { category: L });
  for (const [e, label, body] of [['itemize', '无序列表 itemize', '\\item '], ['enumerate', '有序列表 enumerate', '\\item '], ['description', '描述列表 description', '\\item[] '], ['center', '居中 center', ''], ['quote', '引用 quote', ''], ['minipage', 'minipage', ''], ['verbatim', '原样 verbatim', ''], ['abstract', '摘要 abstract', ''], ['frame', '幻灯片 frame', '\\frametitle{}']]) {
    cmd('env.' + e, label, env(e, body, e === 'minipage' ? '{0.48\\linewidth}' : ''), { category: '环境', icon: e === 'enumerate' ? 'list-ordered' : e === 'itemize' ? 'list' : undefined });
  }
  cmd('env.figure', '图片 figure', figureWizard, { category: '环境', icon: 'image' });
  cmd('env.table', '表格 table…', tableWizard, { category: '环境', icon: 'table' });
  cmd('env.custom', '自定义环境…', async () => { const { promptDialog } = await import('./ui.js'); const n = await promptDialog({ title: '插入环境', placeholder: 'theorem' }); if (n) insertEnvironment(v(), n.trim()); }, { key: 'Mod-Alt-e', category: '环境' });

  // Math
  const M = '数学';
  cmd('math.inline', '行内公式 $…$', wrap('$', '$'), { key: 'Mod-Shift-m', category: M, icon: 'function' });
  cmd('math.display', '行间公式 \\[…\\]', wrap('\\[\n', '\n\\]'), { key: 'Mod-Shift-n', category: M });
  cmd('math.equation', '编号公式 equation', env('equation'), { category: M });
  cmd('math.equationStar', '无编号公式 equation*', env('equation*'), { category: M });
  cmd('math.align', '对齐公式 align', env('align', ' &= '), { category: M });
  cmd('math.cases', '分段函数 cases', env('cases', ' & \\text{if } \\\\'), { category: M });
  cmd('math.frac', '分数 \\frac', () => { const s = v().state; const sel = s.sliceDoc(s.selection.main.from, s.selection.main.to); if (sel) wrapWith(v(), '\\frac{', '}{}'); else insertText(v(), '\\frac{}{}', 6); }, { key: 'Alt-Shift-f', category: M, icon: 'divide' });
  cmd('math.sqrt', '根号 \\sqrt', wrap('\\sqrt{', '}'), { key: 'Alt-Shift-r', category: M, icon: 'radical' });
  cmd('math.sup', '上标 ^{}', wrap('^{', '}'), { key: 'Mod-Shift-u', category: M, icon: 'superscript' });
  cmd('math.sub', '下标 _{}', wrap('_{', '}'), { key: 'Mod-Shift-d', category: M, icon: 'subscript' });
  cmd('math.leftright', '自适应括号 \\left( \\right)', wrap('\\left( ', ' \\right)'), { category: M });
  cmd('math.mathbf', '粗体 \\mathbf', wrap('\\mathbf{', '}'), { category: M });
  cmd('math.mathbb', '黑板体 \\mathbb', wrap('\\mathbb{', '}'), { category: M });
  cmd('math.mathcal', '花体 \\mathcal', wrap('\\mathcal{', '}'), { category: M });
  cmd('math.text', '公式内文字 \\text', wrap('\\text{', '}'), { category: M });
  cmd('math.sum', '求和 \\sum', ins('\\sum_{i=1}^{n} '), { category: M, icon: 'sigma' });
  cmd('math.int', '积分 \\int', ins('\\int_{a}^{b} '), { category: M });
  cmd('math.matrix', '矩阵向导…', matrixWizard, { category: M, icon: 'grid' });

  // AI
  const A = 'AI';
  const openAi = () => { if (!app.layout.ai) app.layoutApi.toggle('ai'); setTimeout(() => app.ai?.focus(), 30); };
  cmd('view.ai', 'AI 写作面板', () => { if (app.layout.ai && document.activeElement?.closest('.ai-card')) app.layoutApi.toggle('ai'); else openAi(); }, { key: 'Mod-l', icon: 'sparkles', category: A });
  cmd('ai.rewrite', 'AI 编辑选中内容…', () => rewriteSelection(), { key: 'Mod-k', icon: 'wand', category: A });
  cmd('ai.continue', 'AI 续写', continueWriting, { key: 'Mod-Shift-Enter', icon: 'sparkles', category: A });
  cmd('ai.fix', 'AI 修复编译错误', () => fixErrors(), { icon: 'wand', category: A });
  cmd('ai.askSelection', '就选中内容问 AI', () => {
    const st = v().state;
    const s = st.sliceDoc(st.selection.main.from, st.selection.main.to);
    openAi();
    setTimeout(() => app.ai?.focus(s ? '关于选中的内容：' : ''), 40);
  }, { icon: 'sparkles', category: A });
  for (const [label, text] of REWRITE_PRESETS) cmd('ai.preset.' + label, 'AI ' + label, () => rewriteSelection(text), { category: A });
  cmd('ai.settings', 'AI 设置…', () => openSettings('ai'), { icon: 'settings', category: A });

  // Help
  cmd('help.shortcuts', '快捷键', () => openSettings('keys'), { icon: 'keyboard', category: '帮助' });
  cmd('help.update', '检查更新…', () => checkForUpdates(), { icon: 'download', category: '帮助' });
  cmd('help.about', '关于', about, { icon: 'info', category: '帮助' });
  cmd('help.ctan', '在 CTAN 上查找宏包…', async () => { const { promptDialog } = await import('./ui.js'); const n = await promptDialog({ title: '查找宏包文档', placeholder: '例如 siunitx' }); if (n) api.openUrl('https://ctan.org/pkg/' + encodeURIComponent(n.trim())); }, { category: '帮助' });
  cmd('help.texdoc', '查看光标处宏包文档', () => {
    const st = v().state;
    const line = st.doc.lineAt(st.selection.main.head);
    const m = /\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/.exec(line.text);
    const name = m ? m[1].split(',')[0].trim() : st.sliceDoc(st.selection.main.from, st.selection.main.to).trim();
    if (!name) return toast('把光标放在 \\usepackage{…} 那一行');
    api.openUrl('https://texdoc.org/pkg/' + encodeURIComponent(name));
  }, { category: '帮助' });

  app.commandList = [...commands.values()];
  app.runCommand = runCommand;
}

// ---------- global shortcuts ----------
const NATIVE = new Set(['Mod-z', 'Mod-y', 'Mod-x', 'Mod-c', 'Mod-v', 'Mod-a', 'Mod-Shift-z', 'Mod-/', 'Ctrl-Space', 'Mod-d', 'Mod-]', 'Mod-[']);
function eventKey(e) {
  let k = e.key;
  if (k === ' ') k = 'Space';
  if (k.length === 1) k = k.toLowerCase();
  if (k === '+') k = '=';
  if (e.code === 'Equal') k = '=';
  if (e.code === 'Minus') k = '-';
  if (e.code === 'Comma') k = ',';
  if (e.code === 'Slash') k = '/';
  if (e.code === 'BracketLeft') k = '[';
  if (e.code === 'BracketRight') k = ']';
  if (e.code === 'Pause' || k === 'Cancel') k = 'Break';
  if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
  const mod = isMac ? e.metaKey : e.ctrlKey;
  return (mod ? 'Mod-' : '') + (isMac && e.ctrlKey ? 'Ctrl-' : '') + (e.altKey ? 'Alt-' : '') + (e.shiftKey ? 'Shift-' : '') + k;
}
export function installShortcuts() {
  const byKey = new Map();
  for (const c of commands.values()) {
    if (!c.key || NATIVE.has(c.key)) continue;
    const k = c.key.replace(/^Ctrl-/, isMac ? 'Ctrl-' : 'Mod-');
    byKey.set(k, c.id);
  }
  window.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const k = eventKey(e);
    const id = byKey.get(k);
    if (!id) return;
    // Let dialogs keep their own keys (except global save/compile)
    if (document.querySelector('.modal-overlay') && !/^(F\d+)$/.test(k)) return;
    const inEditor = !!document.activeElement?.closest?.('.cm-editor');
    const inInput = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') && !inEditor;
    if (inInput && !/^(Mod-s|F\d+|Mod-p|Mod-Shift-p|Mod-o|Mod-n|Mod-,|Mod-l)$/.test(k)) return;
    e.preventDefault();
    e.stopPropagation();
    closeMenus();
    runCommand(id);
  }, true);
}

// ---------- menus ----------
const c = (id, extra = {}) => { const x = commands.get(id); return x ? { label: x.label, icon: x.icon, shortcut: x.key, run: () => runCommand(id), ...extra } : null; };

export function menus() {
  return [
    ['文件', () => [
      c('file.new'), c('file.quickstart'), { sep: true }, c('file.open'), c('file.openFolder'), c('file.quickOpen'),
      { label: '最近打开', icon: 'refresh', submenu: () => {
        const files = app.settings.recentFiles || [];
        const folders = app.settings.recentFolders || [];
        const items = files.map((f) => ({ label: basename(f), shortcut: null, run: () => openFile(f), glyph: '' }));
        if (folders.length) items.push({ sep: true }, { header: '文件夹' }, ...folders.map((f) => ({ label: basename(f) || f, icon: 'folder', run: () => { app.folder = f; emit('project-files'); import('./app.js').then((m) => { m.refreshProjectFiles(); m.saveSessionSoon(); }); } })));
        return items.length ? items : [{ label: '暂无', disabled: true }];
      } },
      { sep: true }, c('file.save'), c('file.saveAs'), c('file.saveAll'), { sep: true },
      c('file.master', { checked: !!(app.master && app.active?.path && samePath(app.master, app.active.path)) }), c('file.reveal'), { sep: true },
      { label: '版本管理', icon: 'git-branch', submenu: [c('git.commit'), c('git.sync'), c('git.history')] }, { sep: true },
      c('file.close'), c('file.settings'), { sep: true }, c('file.exit'),
    ]],
    ['编辑', () => [
      c('edit.undo'), c('edit.redo'), { sep: true }, c('edit.cut'), c('edit.copy'), c('edit.paste'), c('edit.selectAll'), { sep: true },
      c('edit.find'), c('edit.replace'), c('edit.findInFiles'), c('edit.gotoLine'), { sep: true },
      c('edit.comment'), c('edit.uncomment'), c('edit.indent'), c('edit.outdent'),
      { label: '大小写', submenu: [c('edit.upper'), c('edit.lower')] },
      { sep: true }, c('edit.format'), c('edit.foldAll'), c('edit.unfoldAll'),
    ]],
    ['查看', () => [
      c('view.sidebar', { checked: app.layout.sidebar }), c('view.pdf', { checked: app.layout.pdf }), c('view.panel', { checked: app.layout.panel }), { sep: true },
      c('view.files'), c('view.outline'), c('view.symbols'), c('view.bib'), { sep: true },
      c('view.wrap', { checked: app.settings.wrap }), c('view.zoomIn'), c('view.zoomOut'), c('view.zoomReset'), { sep: true },
      c('view.theme'),
      { label: '编辑区背景', icon: 'palette', submenu: () => [...EDITOR_BGS.map(([k, label]) => ({ ...c('view.bg.' + k), label, checked: (app.settings.editorBg || 'default') === k })), { sep: true }, { ...c('view.bg.custom'), label: '自定义…', checked: app.settings.editorBg === 'custom' }] },
      c('view.fullscreen'), c('view.palette'),
    ]],
    ['LaTeX', () => [
      { label: '章节', icon: 'heading', submenu: ['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph'].map((k) => c('sec.' + k)) },
      { label: '环境', icon: 'braces', submenu: [c('env.itemize'), c('env.enumerate'), c('env.description'), { sep: true }, c('env.figure'), c('env.table'), { sep: true }, c('env.center'), c('env.quote'), c('env.minipage'), c('env.verbatim'), c('env.abstract'), c('env.frame'), { sep: true }, c('env.custom')] },
      { label: '字体样式', icon: 'type', submenu: [c('fmt.bold'), c('fmt.italic'), c('fmt.emph'), c('fmt.underline'), c('fmt.tt'), c('fmt.sc'), c('fmt.sf'), c('fmt.color')] },
      { label: '字号', submenu: ['tiny', 'scriptsize', 'footnotesize', 'small', 'normalsize', 'large', 'Large', 'LARGE', 'huge', 'Huge'].map((s) => c('size.' + s)) },
      { sep: true }, c('ins.label'), c('ins.ref'), c('ins.eqref'), c('ins.cite'), c('ins.footnote'), { sep: true },
      c('ins.item'), c('ins.newline'), c('ins.newpage'), c('ins.usepackage'), c('ins.input'), c('ins.url'),
    ]],
    ['数学', () => [
      c('math.inline'), c('math.display'), c('math.equation'), c('math.equationStar'), c('math.align'), c('math.cases'), { sep: true },
      c('math.frac'), c('math.sqrt'), c('math.sup'), c('math.sub'), c('math.leftright'), c('math.sum'), c('math.int'), { sep: true },
      { label: '字体', submenu: [c('math.mathbf'), c('math.mathbb'), c('math.mathcal'), c('math.text')] },
      c('math.matrix'), c('view.symbols'),
    ]],
    ['向导', () => [c('file.quickstart'), c('env.table'), c('env.figure'), c('math.matrix')]],
    ['编译', () => [
      c('build.buildView'), c('build.compile'), c('build.view'), c('build.stop', { disabled: !build.running }), { sep: true },
      { label: '默认编译器', icon: 'settings', submenu: ['pdflatex', 'xelatex', 'lualatex'].map((e) => c('engine.' + e, { checked: app.settings.engine === e })) },
      c('build.latexmk'), c('build.bibtex'), c('build.biber'), c('build.makeindex'), c('build.glossaries'), { sep: true },
      c('build.forward'), c('build.external'), c('build.wordcount'), c('build.clean'),
    ]],
    ['AI', () => [
      c('view.ai'), { sep: true }, c('ai.continue'), c('ai.rewrite'),
      { label: '快速改写选中内容', icon: 'pencil', submenu: REWRITE_PRESETS.map(([label]) => c('ai.preset.' + label)) },
      c('ai.askSelection'), { sep: true }, c('ai.fix', { disabled: !(build.last?.issues || []).some((x) => x.type === 'error') }), { sep: true }, c('ai.settings'),
    ]],
    ['帮助', () => [c('help.shortcuts'), c('view.palette'), c('help.texdoc'), c('help.ctan'), { sep: true }, c('help.update'), c('help.about')]],
  ];
}

export function mountMenubar(el) {
  let active = null;
  const btns = [];
  const openAt = (i) => {
    const [, items] = menus()[i];
    btns.forEach((b) => b.classList.remove('open'));
    btns[i].classList.add('open');
    active = i;
    const r = btns[i].getBoundingClientRect();
    showMenu(items, r.left, r.bottom + 6);
  };
  menus().forEach(([label], i) => {
    const b = h('button', { class: 'menubar-btn', onmousedown: (e) => { e.preventDefault(); if (active === i && menuOpen()) { closeMenus(); } else openAt(i); }, onmouseenter: () => { if (active !== null && menuOpen() && active !== i) openAt(i); } }, label);
    btns.push(b);
    el.append(b);
  });
  document.addEventListener('menus-closed', () => { active = null; btns.forEach((b) => b.classList.remove('open')); });
  // Alt toggles menu like Windows apps
  let altAlone = false;
  window.addEventListener('keydown', (e) => { altAlone = e.key === 'Alt' && !e.repeat; if (e.key !== 'Alt') altAlone = false; }, true);
  window.addEventListener('keyup', (e) => { if (e.key === 'Alt' && altAlone) { altAlone = false; if (menuOpen()) closeMenus(); else openAt(0); } }, true);
}

// ---------- editor context menu ----------
export function initContextMenu() {
  api.onContextMenu(async (p) => {
    const ctx = app.lastContext;
    if (!ctx || Date.now() - (ctx.t || 0) > 1500) { /* fallthrough for editor only */ }
    const target = document.elementFromPoint(p.x, p.y);
    if (!target?.closest('.cm-editor')) return;
    const view = v();
    const pos = view.posAtCoords({ x: p.x, y: p.y });
    const st = view.state;
    const hasSel = !st.selection.main.empty;
    if (pos != null && !hasSel) view.dispatch({ selection: { anchor: pos } });
    const items = [];
    if (p.misspelledWord) {
      for (const s of p.suggestions.slice(0, 6)) items.push({ label: s, glyph: '', run: () => api.replaceMisspelling(s) });
      if (!p.suggestions.length) items.push({ label: '没有拼写建议', disabled: true });
      items.push({ label: `添加 “${p.misspelledWord}” 到词典`, icon: 'plus', run: () => api.addToDictionary(p.misspelledWord) }, { sep: true });
    }
    const wa = pos != null ? wordArgAt(st, pos) : null;
    if (wa && (/ref$/i.test(wa.cmd) || wa.cmd === 'eqref')) items.push({ label: `转到标签 “${wa.key}”`, icon: 'tag', run: () => emit('ctrl-click', pos) });
    if (wa && /cite/i.test(wa.cmd)) items.push({ label: `转到文献 “${wa.key}”`, icon: 'book', run: () => emit('ctrl-click', pos) });
    if (wa && /^(input|include|subfile)$/.test(wa.cmd)) items.push({ label: `打开 ${wa.arg}`, icon: 'file-text', run: () => emit('ctrl-click', pos) });
    if (wa && /^(usepackage|RequirePackage)$/.test(wa.cmd)) items.push({ label: `查看 ${wa.key} 文档`, icon: 'book', run: () => api.openUrl('https://texdoc.org/pkg/' + encodeURIComponent(wa.key)) });
    items.push(c('build.forward', { label: '在 PDF 中查看此处' }));
    items.push(hasSel
      ? { label: 'AI', icon: 'sparkles', submenu: [c('ai.rewrite'), { sep: true }, ...REWRITE_PRESETS.map(([label]) => c('ai.preset.' + label)), { sep: true }, c('ai.askSelection')] }
      : c('ai.continue', { label: 'AI 在此处续写' }));
    items.push({ sep: true }, c('edit.cut', { disabled: !hasSel }), c('edit.copy', { disabled: !hasSel }), c('edit.paste'), { sep: true }, c('edit.toggleComment'), c('edit.selectAll'));
    if (hasSel) items.push({ label: '包裹为', submenu: [c('fmt.bold'), c('fmt.italic'), c('fmt.emph'), c('fmt.tt'), c('math.inline'), { sep: true }, c('edit.upper'), c('edit.lower')] });
    showMenu(items, p.x, p.y);
  });
}
