// Compile orchestration, message panel, SyncTeX glue.
import { app, emit, on, saveAll, saveDoc, rootFor, engineFor, applyDiagnostics, openFile, findDoc, refreshContext, refreshProjectFiles } from './app.js';
import { h, basename, dirname, samePath, escapeHtml, relative } from './util.js';
import { icon } from './icons.js';
import { toast } from './ui.js';
import { guessBibTool } from './project.js';
import { getOpenText } from './app.js';

const api = window.api;
export const build = { running: false, last: null, output: '', step: '', pdfPath: null };

// ---------- compile ----------
export async function compile({ view = true, mode } = {}) {
  if (build.running || build.preparing) { if (build.running) toast('正在编译…'); return; }
  const d = app.active;
  if (!d) return;
  build.preparing = true;
  let root;
  try {
    if (!d.path) {
      toast('请先保存文件再编译');
      if (!(await saveDoc(d))) return;
    }
    if (!(await saveAll({ silentUntitled: true }))) return;
    await refreshContext();
    root = (await rootFor()) || d.path;
  } finally {
    build.preparing = false;
  }
  if (!/\.(tex|ltx)$/i.test(root)) { toast('当前文件不是 TeX 文档', 'error'); return; }
  const engineRaw = engineFor(root);
  const engine = engineRaw === 'latexmk' ? app.settings.engine : engineRaw;
  const buildMode = mode || (engineRaw === 'latexmk' ? 'latexmk' : app.settings.buildMode);

  build.running = true;
  build.output = '';
  build.root = root;
  emit('build-start', { root, engine });
  const t0 = performance.now();
  let res;
  try {
    res = await api.build({ root, engine, shellEscape: app.settings.shellEscape, bibTool: guessBibTool(getOpenText(root) || '') || app.settings.bibTool, mode: buildMode, extraArgs: app.settings.extraArgs });
  } catch (e) {
    res = { ok: false, issues: [{ type: 'error', message: String(e.message || e) }], flags: {} };
  }
  build.running = false;
  build.last = res;
  applyDiagnostics(res.issues);
  emit('build-end', res);
  const errors = res.issues.filter((x) => x.type === 'error').length;
  const warnings = res.issues.filter((x) => x.type === 'warning').length;
  const secs = ((res.duration || performance.now() - t0) / 1000).toFixed(1);
  if (res.stopped) toast('编译已停止');
  else if (errors) toast(`编译出错 · ${errors} 个错误`, 'error', 3200);
  else if (!res.pdfUpdated) toast('没有生成 PDF', 'error');
  else toast(`编译完成 · ${secs}s${warnings ? ` · ${warnings} 个警告` : ''}`, 'success');

  if (res.pdfUpdated) {
    build.pdfPath = res.pdf;
    if (view) await emitPdf(res.pdf, { sync: app.settings.syncAfterCompile });
  }
  refreshProjectFiles();
}

async function emitPdf(pdf, { sync }) {
  await app.pdf?.show(pdf);
  if (sync) await forwardSearch({ quiet: true });
}

export async function stopCompile() { await api.stop(); }

export async function viewPdf() {
  const root = (await rootFor()) || app.active?.path;
  if (!root) return;
  const pdf = root.replace(/\.(tex|ltx)$/i, '.pdf');
  const st = await api.stat(pdf);
  if (!st.exists) { toast('还没有 PDF，按 F5 编译'); return; }
  build.pdfPath = pdf;
  await app.pdf?.show(pdf, { reveal: true });
}

export async function runTool(name) {
  const root = (await rootFor()) || app.active?.path;
  if (!root) return;
  await saveAll({ silentUntitled: true });
  emit('build-start', { root, engine: name });
  build.running = true;
  const r = await api.runTool(name, root);
  build.running = false;
  emit('build-end', { ok: r.ok, issues: build.last?.issues || [], tool: name });
  toast(r.ok ? `${name} 完成` : `${name} 失败，请查看输出`, r.ok ? 'success' : 'error');
}

export async function cleanAux() {
  const root = (await rootFor()) || app.active?.path;
  if (!root) return;
  const removed = await api.clean(root);
  toast(removed.length ? `已清理 ${removed.length} 个辅助文件` : '没有需要清理的文件', 'success');
  refreshProjectFiles();
}

// ---------- SyncTeX ----------
export async function forwardSearch({ quiet = false } = {}) {
  const d = app.active;
  if (!d?.path || !app.pdf) return;
  const pdf = build.pdfPath || app.pdf.viewer.path;
  if (!pdf) { if (!quiet) toast('还没有 PDF'); return; }
  const st = app.view.state;
  const line = st.doc.lineAt(st.selection.main.head);
  const col = st.selection.main.head - line.from;
  const r = await api.forward({ pdf, tex: d.path, line: line.number, column: col });
  if (!r) { if (!quiet) toast('SyncTeX 没有找到对应位置（需要 -synctex=1 编译）'); return; }
  app.pdf.reveal();
  app.pdf.viewer.showSync(r);
}

export async function inverseSearch({ page, x, y }) {
  const pdf = app.pdf?.viewer.path;
  if (!pdf) return;
  const r = await api.inverse({ pdf, page, x, y });
  if (!r) { toast('SyncTeX 没有找到对应源码'); return; }
  await openFile(r.file, { line: r.line, column: 0 });
}

on('ctrl-click', async (pos) => {
  // Ctrl+click: follow \ref / \cite / \input, otherwise jump to PDF.
  const { wordArgAt } = await import('./editor/extras.js');
  const wa = wordArgAt(app.view.state, pos);
  if (wa) {
    const idx = app.index;
    if (/ref$/i.test(wa.cmd) || wa.cmd === 'eqref') {
      const l = idx?.labels.find((x) => x.key === wa.key);
      if (l) return openFile(l.file, { line: l.line });
    }
    if (/cite/i.test(wa.cmd)) {
      const e = idx?.bibEntries.find((x) => x.key === wa.key);
      if (e) return openFile(e.file, { line: e.line });
    }
    if (/^(input|include|subfile)$/.test(wa.cmd) && app.root) {
      const name = /\.\w+$/.test(wa.arg) ? wa.arg : wa.arg + '.tex';
      const { resolve } = await import('./util.js');
      return openFile(resolve(dirname(app.root), name));
    }
  }
  app.view.dispatch({ selection: { anchor: pos } });
  forwardSearch();
});

// ---------- messages panel ----------
export function mountMessages(container) {
  const state = { filter: 'all' };
  const seg = h('div', { class: 'seg seg-sm' });
  const list = h('div', { class: 'msg-list' });
  const empty = h('div', { class: 'empty' }, icon('check', 30, 1.4), h('div', {}, '暂无消息，按 F5 编译'));
  const renderSeg = () => {
    const issues = build.last?.issues || [];
    const count = (t) => issues.filter((x) => x.type === t).length;
    seg.replaceChildren(
      ...[['all', '全部', issues.length], ['error', '错误', count('error')], ['warning', '警告', count('warning')], ['badbox', '坏盒', count('badbox')]].map(([k, label, n]) =>
        h('button', { class: state.filter === k ? 'active' : '', onclick: () => { state.filter = k; render(); } }, label, n ? h('span', { class: `seg-count ${k}` }, n) : null)),
    );
  };
  const render = () => {
    renderSeg();
    const issues = (build.last?.issues || []).filter((x) => state.filter === 'all' || x.type === state.filter);
    list.replaceChildren();
    if (!issues.length) { list.append(empty); return; }
    const base = build.root ? dirname(build.root) : null;
    for (const is of issues) {
      const where = is.file ? (base ? relative(base, is.file) : basename(is.file)) + (is.line ? ':' + is.line : '') : '';
      const row = h('div', { class: `msg-row ${is.type}`, title: is.context || is.message, onclick: () => { if (is.file) openFile(is.file, { line: is.line || 1 }); } },
        h('span', { class: 'status-dot ' + is.type }),
        h('span', { class: 'msg-text' }, is.message),
        h('span', { class: 'msg-where' }, where),
      );
      list.append(row);
    }
  };
  container.append(h('div', { class: 'panel-toolbar' }, seg), list);
  on('build-end', render);
  render();
  return { render };
}

export function mountOutput(container) {
  const pre = h('pre', { class: 'output-pre' });
  container.append(pre);
  let pending = '';
  let raf = 0;
  api.onOutput((chunk) => {
    pending += chunk;
    if (!raf) raf = requestAnimationFrame(() => {
      raf = 0;
      build.output += pending;
      if (build.output.length > 400000) build.output = build.output.slice(-300000);
      const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 30;
      pre.textContent = build.output;
      pending = '';
      if (atBottom) pre.scrollTop = pre.scrollHeight;
    });
  });
  on('build-start', () => { build.output = ''; pre.textContent = ''; });
}

export function mountLog(container) {
  const pre = h('pre', { class: 'output-pre log-pre' });
  container.append(pre);
  const load = async () => {
    const root = build.root;
    if (!root) { pre.textContent = '编译后这里会显示 .log 文件内容'; return; }
    try {
      const r = await api.read(build.last?.logFile || root.replace(/\.(tex|ltx)$/i, '.log'));
      pre.innerHTML = colorLog(r.content);
    } catch { pre.textContent = '没有找到日志文件'; }
  };
  on('build-end', load);
  return { load };
}

function colorLog(text) {
  return text.split('\n').map((l) => {
    const e = escapeHtml(l);
    if (/^!|^.*:\d+: /.test(l)) return `<span class="log-err">${e}</span>`;
    if (/Warning/.test(l)) return `<span class="log-warn">${e}</span>`;
    if (/^(Over|Under)full/.test(l)) return `<span class="log-box">${e}</span>`;
    return e;
  }).join('\n');
}

api.onStep((s) => { build.step = s; emit('build-step', s); });
