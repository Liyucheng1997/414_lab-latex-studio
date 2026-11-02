// Settings, wizards, command palette, quick open.
import { app, updateSettings, newDocument, openFile, goToLine, projectDir, rootFor, applyTheme } from './app.js';
import { h, basename, dirname, relative, fuzzyScore, fmtKey, stripExt } from './util.js';
import { icon } from './icons.js';
import { modal, toast, promptDialog } from './ui.js';
import { insertText } from './editor/extras.js';
import { aiSettingsSection } from './ai.js';

const api = window.api;

// ---------- form helpers ----------
const field = (label, control, hint) => h('div', { class: 'set-row' }, h('div', { class: 'set-label' }, h('div', {}, label), hint ? h('div', { class: 'set-hint' }, hint) : null), h('div', { class: 'set-control' }, control));
function toggle(key, onChange) {
  const el = h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!app.settings[key] }), h('span', { class: 'switch-track' }));
  el.querySelector('input').addEventListener('change', (e) => { updateSettings({ [key]: e.target.checked }); onChange?.(e.target.checked); });
  return el;
}
function select(key, options, onChange) {
  const el = h('select', { class: 'input' }, options.map(([v, l]) => h('option', { value: v, selected: String(app.settings[key]) === String(v) }, l)));
  el.addEventListener('change', () => { const v = el.value; const num = options.find(([x]) => String(x) === v)?.[0]; updateSettings({ [key]: num }); onChange?.(num); });
  return el;
}
function text(key, placeholder = '', { number = false, width } = {}) {
  const el = h('input', { class: 'input', value: app.settings[key] ?? '', placeholder, type: number ? 'number' : 'text', style: width ? { width } : null, spellcheck: 'false' });
  el.addEventListener('change', () => updateSettings({ [key]: number ? +el.value : el.value.trim() }));
  return el;
}
function seg(key, options, onChange) {
  const wrap = h('div', { class: 'seg' });
  const render = () => wrap.replaceChildren(...options.map(([v, l]) => h('button', { class: app.settings[key] === v ? 'active' : '', onclick: () => { updateSettings({ [key]: v }).then(() => { render(); onChange?.(v); }); } }, l)));
  render();
  return wrap;
}

// ---------- settings ----------
export function openSettings(section = 'build') {
  const nav = h('div', { class: 'set-nav' });
  const content = h('div', { class: 'set-content' });
  const sections = {
    build: ['编译', 'play', () => [
      field('默认编译器', seg('engine', [['pdflatex', 'pdfLaTeX'], ['xelatex', 'XeLaTeX'], ['lualatex', 'LuaLaTeX']]), '可在文件开头用 % !TEX program = xelatex 覆盖'),
      field('编译方式', select('buildMode', [['smart', '智能（自动文献、索引与重跑）'], ['single', '只运行一次'], ['latexmk', 'latexmk']]), '智能模式会按需运行 BibTeX/Biber、makeindex，并在交叉引用变化时自动重新编译'),
      field('参考文献工具', select('bibTool', [['auto', '自动判断（biblatex 用 Biber）'], ['bibtex', 'BibTeX'], ['biber', 'Biber'], ['none', '不运行']])),
      field('允许 shell-escape', toggle('shellEscape'), 'minted、svg 等宏包需要'),
      field('编译后同步到光标', toggle('syncAfterCompile'), '编译完成后 PDF 自动定位到正在编辑的位置'),
      field('保存时自动编译', toggle('autoCompileOnSave')),
      field('实时编译', toggle('liveCompile'), '停止输入一段时间后自动保存并编译'),
      field('实时编译延迟 (ms)', text('liveDelay', '1500', { number: true, width: '120px' })),
      field('出错时显示消息面板', toggle('showLogOnError')),
      field('额外编译参数', text('extraArgs', '例如 -halt-on-error')),
      field('TeX bin 目录', h('div', { class: 'row-gap' }, text('texBin', app.info.texBin || '自动检测'), h('button', { class: 'btn btn-sm', onclick: async () => { const r = await api.openDialog({ folder: true, title: '选择 TeX 的 bin 目录' }); if (r) { await updateSettings({ texBin: r[0] }); openSettings('build'); } } }, '浏览…')), `当前使用：${app.info.texBin || '未找到'}`),
    ]],
    editor: ['编辑器', 'type', () => [
      field('字体', text('fontFamily', 'Consolas')),
      field('字号', text('fontSize', '15', { number: true, width: '90px' })),
      field('行高', select('lineHeight', [[1.4, '1.4'], [1.5, '1.5'], [1.6, '1.6'], [1.65, '1.65'], [1.75, '1.75'], [1.9, '1.9']])),
      field('缩进', select('tabSize', [[2, '2 个空格'], [4, '4 个空格'], ['tab', 'Tab']])),
      field('自动换行', toggle('wrap')),
      field('显示行号', toggle('lineNumbers')),
      field('自动补全括号', toggle('autoCloseBrackets')),
      field('自动补全 \\end{…}', toggle('autoCloseEnv'), '在 \\begin{env} 后回车时插入 \\end{env}'),
      field('拼写检查（英文）', toggle('spellcheck'), '命令、公式和引用不会被检查'),
      field('悬停预览公式与图片', toggle('mathPreview')),
      field('自动保存', toggle('autosave'), '切换窗口或停止输入后自动保存'),
    ]],
    view: ['预览', 'file-type', () => [
      field('深色模式下反色 PDF', toggle('pdfInvert', () => app.pdf?.applyInvert())),
      field('双击 PDF 跳转源码', toggle('pdfDblClick', (v) => { if (app.pdf) app.pdf.viewer.dblClickSync = v; }), 'Ctrl + 单击始终可用'),
    ]],
    ai: ['AI 写作', 'sparkles', () => aiSettingsSection(field, select, seg)],
    look: ['外观', 'theme', () => [
      field('主题', seg('theme', [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']], () => applyTheme())),
    ]],
    keys: ['快捷键', 'keyboard', () => [shortcutTable()]],
  };
  const show = async (k) => {
    section = k;
    nav.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.k === k));
    const [title, , build] = sections[k];
    const rows = await build();
    if (section !== k) return;
    content.replaceChildren(h('div', { class: 'set-eyebrow' }, 'SETTINGS'), h('div', { class: 'set-title' }, title), ...rows);
  };
  for (const [k, [label, ic]] of Object.entries(sections)) nav.append(h('div', { class: 'nav-item', 'data-k': k, onclick: () => show(k) }, icon(ic, 16), label));
  const m = modal({ title: null, body: h('div', { class: 'settings' }, nav, content), width: 860, className: 'modal-settings' });
  m.box.prepend(h('button', { class: 'modal-x settings-x', onclick: () => m.close() }, icon('x', 14, 2)));
  show(section);
}

function shortcutTable() {
  const rows = (app.commandList || []).filter((c) => c.key).map((c) => h('div', { class: 'kb-row' }, h('span', {}, c.label), h('span', { class: 'kbd' }, fmtKey(c.key))));
  rows.push(h('div', { class: 'kb-row' }, h('span', {}, 'PDF → 源码（反向搜索）'), h('span', { class: 'kbd' }, 'Ctrl+单击 PDF')));
  rows.push(h('div', { class: 'kb-row' }, h('span', {}, '源码 → PDF / 跳转到引用定义'), h('span', { class: 'kbd' }, 'Ctrl+单击 代码')));
  rows.push(h('div', { class: 'kb-row' }, h('span', {}, '缩放 PDF'), h('span', { class: 'kbd' }, 'Ctrl+滚轮')));
  rows.push(h('div', { class: 'kb-row' }, h('span', {}, '多光标'), h('span', { class: 'kbd' }, 'Alt+单击 / Ctrl+D')));
  return h('div', { class: 'kb-table' }, rows);
}

// ---------- quick start wizard ----------
export function quickStart() {
  const v = { cls: 'article', size: '11pt', paper: 'a4paper', title: '', author: '', engine: app.settings.engine, pkgs: new Set(['amsmath', 'amssymb', 'graphicx', 'hyperref', 'geometry', 'booktabs']) };
  const clsSel = h('select', { class: 'input' }, ['article', 'report', 'book', 'beamer', 'ctexart', 'ctexrep', 'ctexbook', 'ctexbeamer', 'IEEEtran', 'elsarticle'].map((c) => h('option', { value: c }, c)));
  const sizeSel = h('select', { class: 'input' }, ['10pt', '11pt', '12pt'].map((c) => h('option', { value: c, selected: c === v.size }, c)));
  const paperSel = h('select', { class: 'input' }, ['a4paper', 'letterpaper', 'b5paper', 'a5paper'].map((c) => h('option', { value: c }, c)));
  const title = h('input', { class: 'input', placeholder: '文档标题' });
  const author = h('input', { class: 'input', placeholder: '作者' });
  const pkgList = ['amsmath', 'amssymb', 'amsthm', 'mathtools', 'graphicx', 'xcolor', 'hyperref', 'cleveref', 'geometry', 'booktabs', 'multirow', 'subcaption', 'float', 'tikz', 'listings', 'algorithm2e', 'siunitx', 'enumitem', 'natbib', 'biblatex', 'ctex', 'lipsum'];
  const pkgs = h('div', { class: 'pkg-grid' }, pkgList.map((p) => {
    const cb = h('input', { type: 'checkbox', checked: v.pkgs.has(p) });
    cb.addEventListener('change', () => { if (cb.checked) v.pkgs.add(p); else v.pkgs.delete(p); });
    return h('label', { class: 'form-check' }, cb, p);
  }));
  const body = h('div', { class: 'form' },
    h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, '文档类'), clsSel),
    h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, '字号 / 纸张'), sizeSel, paperSel),
    h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, '标题'), title),
    h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, '作者'), author),
    h('div', { class: 'form-label' }, '宏包'), pkgs,
  );
  const m = modal({ title: '快速开始', body, width: 560, footer: [
    h('button', { class: 'btn', onclick: () => m.close() }, '取消'),
    h('button', { class: 'btn btn-primary', onclick: () => {
      const cls = clsSel.value;
      const cjk = /^ctex/.test(cls) || v.pkgs.has('ctex');
      const lines = [];
      if (cjk) lines.push('% !TEX program = xelatex');
      lines.push(`\\documentclass[${sizeSel.value},${paperSel.value}]{${cls}}`);
      if (!cjk && !/beamer/.test(cls)) { lines.push('\\usepackage[utf8]{inputenc}', '\\usepackage[T1]{fontenc}'); }
      for (const p of pkgList) {
        if (!v.pkgs.has(p)) continue;
        if (p === 'ctex' && /^ctex/.test(cls)) continue;
        if (p === 'geometry') lines.push('\\usepackage[margin=2.5cm]{geometry}');
        else if (p === 'biblatex') lines.push('\\usepackage[backend=biber,style=numeric]{biblatex}', '\\addbibresource{references.bib}');
        else if (p === 'hyperref') lines.push('\\usepackage[colorlinks=true,linkcolor=blue,citecolor=blue]{hyperref}');
        else lines.push(`\\usepackage{${p}}`);
      }
      lines.push('');
      if (/beamer/.test(cls)) {
        lines.push('\\usetheme{default}', `\\title{${title.value || '演示标题'}}`, `\\author{${author.value}}`, '\\date{\\today}', '', '\\begin{document}', '', '\\begin{frame}', '\t\\titlepage', '\\end{frame}', '', '\\begin{frame}{第一页}', '\t', '\\end{frame}', '', '\\end{document}');
      } else {
        lines.push(`\\title{${title.value || 'Title'}}`, `\\author{${author.value || 'Author'}}`, '\\date{\\today}', '', '\\begin{document}', '', '\\maketitle', '', '\\section{Introduction}', '', '', '\\end{document}');
      }
      m.close();
      newDocument(lines.join('\n') + '\n');
      setTimeout(() => {
        const st = app.view.state;
        const idx = st.doc.toString().indexOf('\\section{');
        if (idx >= 0) goToLine(st.doc.lineAt(idx).number + 2);
      }, 30);
    } }, '创建'),
  ] });
  clsSel.addEventListener('change', () => { if (/^ctex/.test(clsSel.value)) v.pkgs.delete('ctex'); });
}

// ---------- tabular wizard ----------
export function tableWizard() {
  const rows = h('input', { class: 'input', type: 'number', value: 3, min: 1, max: 60 });
  const cols = h('input', { class: 'input', type: 'number', value: 3, min: 1, max: 30 });
  const align = h('select', { class: 'input' }, [['c', '居中 c'], ['l', '左对齐 l'], ['r', '右对齐 r'], ['p', '固定宽度 p{}']].map(([v, l]) => h('option', { value: v }, l)));
  const style = h('select', { class: 'input' }, [['booktabs', '三线表 (booktabs)'], ['grid', '全框线'], ['plain', '无框线']].map(([v, l]) => h('option', { value: v }, l)));
  const float = h('input', { type: 'checkbox', checked: true });
  const caption = h('input', { class: 'input', placeholder: '表格标题' });
  const label = h('input', { class: 'input', placeholder: 'tab:example' });
  const body = h('div', { class: 'form' },
    h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, '行 × 列'), rows, h('span', { class: 'muted' }, '×'), cols),
    h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, '对齐'), align),
    h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, '样式'), style),
    h('label', { class: 'form-check' }, float, '放在 table 浮动环境中'),
    h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, '标题'), caption),
    h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, '标签'), label),
  );
  const m = modal({ title: '插入表格', body, width: 480, footer: [h('button', { class: 'btn', onclick: () => m.close() }, '取消'), h('button', { class: 'btn btn-primary', onclick: () => {
    const R = Math.max(1, +rows.value), C = Math.max(1, +cols.value);
    const a = align.value === 'p' ? 'p{3cm}' : align.value;
    const st = style.value;
    const spec = st === 'grid' ? '|' + Array(C).fill(a).join('|') + '|' : Array(C).fill(a).join('');
    const ind = float.checked ? '\t' : '';
    const L = [];
    if (float.checked) L.push('\\begin{table}[htbp]', '\t\\centering', `\t\\caption{${caption.value}}`, `\t\\label{${label.value || 'tab:'}}`);
    L.push(`${ind}\\begin{tabular}{${spec}}`);
    const row = (i) => `${ind}\t${Array.from({ length: C }, (_, j) => (i === 0 ? `标题${j + 1}` : ' ')).join(' & ')} \\\\`;
    if (st === 'booktabs') { L.push(`${ind}\t\\toprule`, row(0), `${ind}\t\\midrule`); for (let i = 1; i < R; i++) L.push(row(i)); L.push(`${ind}\t\\bottomrule`); }
    else if (st === 'grid') { L.push(`${ind}\t\\hline`); for (let i = 0; i < R; i++) { L.push(row(i)); L.push(`${ind}\t\\hline`); } }
    else for (let i = 0; i < R; i++) L.push(row(i));
    L.push(`${ind}\\end{tabular}`);
    if (float.checked) L.push('\\end{table}');
    m.close();
    insertBlock(L.join('\n'));
    if (st === 'booktabs') toast('三线表需要 \\usepackage{booktabs}');
  } }, '插入')] });
}

// ---------- figure wizard ----------
export function figureWizard() {
  const base = app.root ? dirname(app.root) : projectDir();
  const file = h('input', { class: 'input', placeholder: 'figures/example.pdf' });
  const width = h('input', { class: 'input', value: '0.8\\linewidth' });
  const caption = h('input', { class: 'input', placeholder: '图片标题' });
  const label = h('input', { class: 'input', placeholder: 'fig:example' });
  const place = h('input', { class: 'input', value: 'htbp', style: { width: '90px' } });
  const browse = h('button', { class: 'btn btn-sm', onclick: async () => {
    const r = await api.openDialog({ title: '选择图片', defaultPath: base || undefined, filters: [{ name: '图片', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'eps', 'svg'] }] });
    if (r) { file.value = base ? relative(base, r[0]) : r[0]; if (!label.value) label.value = 'fig:' + stripExt(basename(r[0])).replace(/\s+/g, '-'); }
  } }, '浏览…');
  const body = h('div', { class: 'form' },
    h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, '文件'), file, browse),
    h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, '宽度'), width),
    h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, '标题'), caption),
    h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, '标签'), label),
    h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, '位置'), place),
  );
  const m = modal({ title: '插入图片', body, width: 520, footer: [h('button', { class: 'btn', onclick: () => m.close() }, '取消'), h('button', { class: 'btn btn-primary', onclick: () => {
    const L = [`\\begin{figure}[${place.value || 'htbp'}]`, '\t\\centering', `\t\\includegraphics[width=${width.value}]{${file.value}}`, `\t\\caption{${caption.value}}`, `\t\\label{${label.value || 'fig:'}}`, '\\end{figure}'];
    m.close();
    insertBlock(L.join('\n'));
  } }, '插入')] });
}

// ---------- matrix wizard ----------
export function matrixWizard() {
  const rows = h('input', { class: 'input', type: 'number', value: 3, min: 1 });
  const cols = h('input', { class: 'input', type: 'number', value: 3, min: 1 });
  const env = h('select', { class: 'input' }, [['pmatrix', '( ) pmatrix'], ['bmatrix', '[ ] bmatrix'], ['Bmatrix', '{ } Bmatrix'], ['vmatrix', '| | vmatrix'], ['Vmatrix', '‖ ‖ Vmatrix'], ['matrix', '无括号 matrix'], ['array', 'array'], ['cases', 'cases 分段函数']].map(([v, l]) => h('option', { value: v }, l)));
  const body = h('div', { class: 'form' },
    h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, '行 × 列'), rows, h('span', { class: 'muted' }, '×'), cols),
    h('div', { class: 'form-row' }, h('span', { class: 'form-label' }, '类型'), env));
  const m = modal({ title: '插入矩阵', body, width: 420, footer: [h('button', { class: 'btn', onclick: () => m.close() }, '取消'), h('button', { class: 'btn btn-primary', onclick: () => {
    const R = Math.max(1, +rows.value), C = Math.max(1, +cols.value), e = env.value;
    const cells = (i) => Array.from({ length: e === 'cases' ? 2 : C }, (_, j) => (e === 'cases' ? (j ? '\\text{if } ' : '') : `a_{${i + 1}${j + 1}}`)).join(' & ');
    const L = [`\\begin{${e}}${e === 'array' ? `{${'c'.repeat(C)}}` : ''}`];
    for (let i = 0; i < R; i++) L.push('\t' + cells(i) + (i < R - 1 ? ' \\\\' : ''));
    L.push(`\\end{${e}}`);
    m.close();
    insertBlock(L.join('\n'));
  } }, '插入')] });
}

function insertBlock(text) {
  const st = app.view.state;
  const r = st.selection.main;
  const line = st.doc.lineAt(r.from);
  const indent = /^\s*/.exec(line.text)[0];
  const atStart = line.text.slice(0, r.from - line.from).trim() === '';
  const t = (atStart ? '' : '\n' + indent) + text.split('\n').map((l, i) => (i === 0 ? '' : indent) + l).join('\n');
  insertText(app.view, t.replace(/\t/g, indentStr()));
}
function indentStr() { const s = app.settings.tabSize; return s === 'tab' ? '\t' : ' '.repeat(+s || 2); }

// ---------- go to line ----------
export async function gotoLineDialog() {
  const total = app.view.state.doc.lines;
  const v = await promptDialog({ title: '跳转到行', label: `行号 (1 – ${total})`, value: String(app.view.state.doc.lineAt(app.view.state.selection.main.head).number), validate: (x) => (/^\d+(:\d+)?$/.test(x.trim()) ? null : '请输入行号，例如 120 或 120:5') });
  if (!v) return;
  const [l, c] = v.trim().split(':').map(Number);
  goToLine(l, c ? c - 1 : 0, { flash: true });
}

// ---------- palette / quick open ----------
function picker({ placeholder, items, onPick, render }) {
  const input = h('input', { class: 'palette-input', placeholder, spellcheck: 'false' });
  const list = h('div', { class: 'palette-list' });
  let filtered = [], sel = 0;
  const update = () => {
    const q = input.value.trim();
    filtered = items.map((it) => ({ it, s: fuzzyScore(q, it.search) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 80).map((x) => x.it);
    sel = 0;
    draw();
  };
  const draw = () => {
    list.replaceChildren(...filtered.map((it, i) => {
      const row = render(it);
      row.classList.add('palette-row');
      if (i === sel) row.classList.add('sel');
      row.addEventListener('mousemove', () => { if (sel !== i) { sel = i; list.querySelectorAll('.sel').forEach((r) => r.classList.remove('sel')); row.classList.add('sel'); } });
      row.addEventListener('click', () => { m.close(); onPick(it); });
      return row;
    }));
    if (!filtered.length) list.append(h('div', { class: 'palette-empty' }, '没有匹配项'));
  };
  const box = h('div', { class: 'palette' }, h('div', { class: 'palette-head' }, icon('search', 17), input), list);
  const m = modal({ title: null, body: box, width: 620, className: 'modal-palette' });
  m.overlay.classList.add('overlay-top');
  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(filtered.length - 1, sel + 1); draw(); list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = filtered[sel]; if (it) { m.close(); onPick(it); } }
  });
  update();
  setTimeout(() => input.focus(), 20);
}

export function commandPalette() {
  const items = (app.commandList || []).filter((c) => c.label && !c.hidden).map((c) => ({ ...c, search: c.label + ' ' + (c.category || '') + ' ' + c.id }));
  picker({
    placeholder: '输入命令…',
    items,
    onPick: (c) => setTimeout(() => app.runCommand(c.id), 10),
    render: (c) => h('div', {}, h('span', { class: 'pal-ico' }, c.icon ? icon(c.icon, 15) : null), h('span', { class: 'pal-label' }, c.category ? h('span', { class: 'pal-cat' }, c.category + '：') : null, c.label), c.key ? h('span', { class: 'kbd' }, fmtKey(c.key)) : null),
  });
}

export function quickOpen() {
  const dir = projectDir();
  const files = (app.projectFiles || []).filter((f) => /\.(tex|bib|sty|cls|txt|md|pdf)$/i.test(f));
  const recent = (app.settings.recentFiles || []).filter((f) => !files.some((x) => x.toLowerCase() === f.toLowerCase()));
  const items = [...files, ...recent].map((f) => ({ path: f, rel: dir && f.toLowerCase().startsWith(dir.toLowerCase()) ? relative(dir, f) : f, search: (dir ? relative(dir, f) : f) }));
  picker({
    placeholder: '按名称查找文件…',
    items,
    onPick: (it) => (/\.pdf$/i.test(it.path) ? app.pdf?.show(it.path, { reveal: true }) : openFile(it.path)),
    render: (it) => h('div', {}, h('span', { class: 'pal-ico' }, icon(/\.bib$/i.test(it.path) ? 'book' : /\.pdf$/i.test(it.path) ? 'file-type' : 'file-text', 15)), h('span', { class: 'pal-label' }, basename(it.path)), h('span', { class: 'pal-path' }, dirname(it.rel) === it.rel ? '' : dirname(it.rel))),
  });
}

// ---------- word count ----------
export async function wordCount() {
  const root = (await rootFor()) || app.active?.path;
  if (!root) return;
  const pre = h('pre', { class: 'output-pre wc-pre' }, '正在统计…');
  const m = modal({ title: '字数统计', body: pre, width: 560, footer: [h('button', { class: 'btn btn-primary', onclick: () => m.close() }, '好')] });
  const out = await api.texcount(root);
  pre.textContent = out || '统计失败（需要 texcount）';
}

export function about() {
  modal({ title: null, width: 380, body: h('div', { class: 'about' },
    h('div', { class: 'logo-mark logo-lg' }, 'Tx'),
    h('div', { class: 'about-name' }, 'TeX Studio Minimal'),
    h('div', { class: 'muted' }, `版本 ${app.info.version}`),
    h('div', { class: 'about-desc' }, '一个简洁的 LaTeX 编辑器：编译预览、SyncTeX 双向跳转、智能补全。'),
    h('div', { class: 'muted small' }, `TeX：${app.info.texBin || '未找到'}`),
  ) });
}
