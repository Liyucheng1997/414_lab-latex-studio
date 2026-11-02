// Editor helpers: smart Enter, wrapping commands, hover previews, spell-check scoping.
import { EditorView, Decoration, ViewPlugin, hoverTooltip } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { indentUnit, syntaxTree } from '@codemirror/language';
import katex from 'katex';
import { commentIndex } from './latex-lang.js';

let hoverCtx = { index: null, rootDir: null, settings: {}, renderPdfThumb: null, resolveImage: null };
export function setHoverContext(c) { hoverCtx = { ...hoverCtx, ...c }; }

// ---------- smart Enter ----------
export function makeLatexEnter(getSettings) {
  return (view) => {
    const { state } = view;
    const sel = state.selection.main;
    if (!sel.empty || state.selection.ranges.length > 1) return false;
    const line = state.doc.lineAt(sel.head);
    const before = line.text.slice(0, sel.head - line.from);
    const after = line.text.slice(sel.head - line.from);
    const indent = /^\s*/.exec(line.text)[0];
    const unit = state.facet(indentUnit);
    const ci = commentIndex(before);
    if (ci >= 0) return false;

    // \item continuation inside lists
    if (/^\s*\\item\b/.test(line.text) && after.trim() === '') {
      if (/^\s*\\item(\[[^\]]*\])?\s*$/.test(before)) {
        const newIndent = indent.endsWith(unit) ? indent.slice(0, indent.length - unit.length) : indent.replace(/(\t| {1,4})$/, '');
        view.dispatch({ changes: { from: line.from, to: line.to, insert: newIndent }, selection: { anchor: line.from + newIndent.length } });
        return true;
      }
      const ins = '\n' + indent + '\\item ';
      view.dispatch({ changes: { from: sel.head, insert: ins }, selection: { anchor: sel.head + ins.length }, scrollIntoView: true, userEvent: 'input' });
      return true;
    }

    const m = /\\begin\{([^}]+)\}((?:\[[^\]]*\]|\{[^}]*\})*)\s*$/.exec(before);
    if (m) {
      const env = m[1];
      if (getSettings().autoCloseEnv !== false && env !== 'document' && !isBalanced(state, line.from + m.index, env)) {
        const list = /^(itemize|enumerate|description|compactitem|inparaenum)$/.test(env);
        const head = '\n' + indent + unit + (list ? '\\item ' : '');
        const ins = head + '\n' + indent + '\\end{' + env + '}';
        view.dispatch({ changes: { from: sel.head, to: sel.head + (after.trim() === '' ? after.length : 0), insert: ins }, selection: { anchor: sel.head + head.length }, scrollIntoView: true, userEvent: 'input' });
        return true;
      }
      const ins = '\n' + indent + unit;
      view.dispatch({ changes: { from: sel.head, insert: ins }, selection: { anchor: sel.head + ins.length }, scrollIntoView: true, userEvent: 'input' });
      return true;
    }
    return false;
  };
}

function isBalanced(state, from, env) {
  const esc = env.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\\\(begin|end)\\s*\\{${esc}\\}`, 'g');
  const text = state.doc.sliceString(from, Math.min(state.doc.length, from + 200000));
  let depth = 0, mm;
  while ((mm = re.exec(text))) {
    // ignore commented occurrences
    const ls = text.lastIndexOf('\n', mm.index) + 1;
    const ci = commentIndex(text.slice(ls, mm.index + 1));
    if (ci >= 0 && ls + ci < mm.index) continue;
    depth += mm[1] === 'begin' ? 1 : -1;
    if (depth === 0) return true;
  }
  return false;
}

// ---------- wrapping ----------
export function wrapWith(view, before, after = '', placeholder = '') {
  const { state } = view;
  const tr = state.changeByRange((r) => {
    const text = state.sliceDoc(r.from, r.to);
    const inner = text || placeholder;
    const ins = before + inner + after;
    const start = r.from + before.length;
    return { changes: { from: r.from, to: r.to, insert: ins }, range: text ? EditorSelection.range(start, start + inner.length) : EditorSelection.range(start, start + inner.length) };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input' }));
  view.focus();
}

export function insertText(view, text, cursorOffset) {
  const { state } = view;
  const r = state.selection.main;
  const pos = cursorOffset == null ? r.from + text.length : r.from + cursorOffset;
  view.dispatch({ changes: { from: r.from, to: r.to, insert: text }, selection: { anchor: pos }, scrollIntoView: true, userEvent: 'input' });
  view.focus();
}

export function insertEnvironment(view, env, body = '', args = '') {
  const { state } = view;
  const r = state.selection.main;
  const line = state.doc.lineAt(r.from);
  const indent = /^\s*/.exec(line.text)[0];
  const unit = state.facet(indentUnit);
  const sel = state.sliceDoc(r.from, r.to);
  const content = sel ? sel.split('\n').map((l) => unit + l).join('\n' + indent) : unit + body;
  const atLineStart = line.text.slice(0, r.from - line.from).trim() === '';
  const pre = atLineStart ? '' : '\n' + indent;
  const text = `${pre}\\begin{${env}}${args}\n${indent}${content}\n${indent}\\end{${env}}`;
  const cursor = r.from + pre.length + `\\begin{${env}}${args}\n${indent}`.length + (sel ? content.length : content.length);
  view.dispatch({ changes: { from: r.from, to: r.to, insert: text }, selection: { anchor: cursor }, scrollIntoView: true, userEvent: 'input' });
  view.focus();
}

// ---------- math detection ----------
const MATH_ENV_RE = /\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|flalign\*?|eqnarray\*?|displaymath|math|alignat\*?|dmath\*?)\}/g;

export function findMathAt(state, pos) {
  const line = state.doc.lineAt(pos);
  const text = line.text;
  const off = pos - line.from;
  const ci = commentIndex(text);
  if (ci >= 0 && off > ci) return null;
  // inline $...$ / \( \)
  const inl = [];
  for (let i = 0; i < text.length && (ci < 0 || i < ci); i++) {
    const c = text[i];
    if (c === '\\') {
      if (text[i + 1] === '(') inl.push({ t: 'o', i, len: 2 });
      else if (text[i + 1] === ')') inl.push({ t: 'c', i, len: 2 });
      else if (text[i + 1] === '[' ) inl.push({ t: 'do', i, len: 2 });
      else if (text[i + 1] === ']') inl.push({ t: 'dc', i, len: 2 });
      i++;
      continue;
    }
    if (c === '$') {
      if (text[i + 1] === '$') { inl.push({ t: 'dd', i, len: 2 }); i++; }
      else inl.push({ t: 'd', i, len: 1 });
    }
  }
  let open = null;
  const pairs = [];
  for (const tk of inl) {
    if (tk.t === 'd') { if (open && open.t === 'd') { pairs.push([open, tk, false]); open = null; } else if (!open) open = tk; }
    else if (tk.t === 'o') open = tk;
    else if (tk.t === 'c' && open && open.t === 'o') { pairs.push([open, tk, false]); open = null; }
    else if (tk.t === 'do') open = tk;
    else if (tk.t === 'dc' && open && open.t === 'do') { pairs.push([open, tk, true]); open = null; }
    else if (tk.t === 'dd') { if (open && open.t === 'dd') { pairs.push([open, tk, true]); open = null; } else if (!open) open = tk; }
  }
  for (const [o, c, display] of pairs) {
    if (off >= o.i && off <= c.i + c.len) {
      return { from: line.from + o.i, to: line.from + c.i + c.len, tex: text.slice(o.i + o.len, c.i), display };
    }
  }
  // multi-line display math
  const startLine = Math.max(1, line.number - 60);
  const from = state.doc.line(startLine).from;
  const back = state.doc.sliceString(from, pos);
  let best = null;
  for (const re of [/\\\[/g, /\$\$/g]) {
    let m, last = null;
    while ((m = re.exec(back))) last = m;
    if (last && (!best || last.index > best.index)) best = { index: last.index, open: last[0], env: null };
  }
  MATH_ENV_RE.lastIndex = 0;
  let em, lastEnv = null;
  while ((em = MATH_ENV_RE.exec(back))) lastEnv = em;
  if (lastEnv && (!best || lastEnv.index > best.index)) best = { index: lastEnv.index, open: lastEnv[0], env: lastEnv[1] };
  if (!best) return null;
  const close = best.env ? `\\end{${best.env}}` : best.open === '$$' ? '$$' : '\\]';
  const between = back.slice(best.index + best.open.length);
  if (between.includes(close) || (best.env && /\\end\{/.test(between) && between.includes(`\\end{${best.env}}`))) return null;
  if (best.open === '$$' && (back.slice(0, best.index).match(/\$\$/g) || []).length % 2 === 1) return null;
  const fwd = state.doc.sliceString(pos, Math.min(state.doc.length, pos + 8000));
  const ci2 = fwd.indexOf(close);
  if (ci2 < 0) return null;
  const tex = between + fwd.slice(0, ci2);
  return { from: from + best.index, to: pos + ci2 + close.length, tex, display: true, env: best.env };
}

export function texForKatex(m) {
  let t = m.tex.replace(/\\label\{[^}]*\}/g, '').replace(/\\(nonumber|notag)\b/g, '').replace(/\\tag\*?\{[^}]*\}/g, '');
  t = t.split('\n').map((l) => { const i = commentIndex(l); return i >= 0 ? l.slice(0, i) : l; }).join('\n');
  const env = (m.env || '').replace('*', '');
  if (/^(align|flalign|eqnarray|alignat)$/.test(env)) t = `\\begin{aligned}${t}\\end{aligned}`;
  else if (/^(gather|multline)$/.test(env)) t = `\\begin{gathered}${t}\\end{gathered}`;
  else if (/\\\\/.test(t) && !/\\begin\{/.test(t)) t = `\\begin{gathered}${t}\\end{gathered}`;
  return t;
}

export function renderMath(m, macros) {
  try {
    return katex.renderToString(texForKatex(m), { displayMode: m.display, throwOnError: false, strict: 'ignore', trust: false, macros: { ...(macros || {}) }, output: 'html' });
  } catch (e) {
    return `<span class="math-err">${String(e.message || e)}</span>`;
  }
}

// ---------- hover tooltips ----------
function wordArgAt(state, pos) {
  // Find \cmd{arg} around pos and return {cmd, arg, key}
  const line = state.doc.lineAt(pos);
  const text = line.text;
  const off = pos - line.from;
  const re = /\\([a-zA-Z]+)\*?((?:\[[^\]]*\])*)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    if (off >= m.index && off <= m.index + m[0].length) {
      const argStart = m.index + m[0].length - m[3].length - 1;
      let key = m[3];
      if (key.includes(',')) {
        let acc = argStart;
        for (const part of m[3].split(',')) {
          if (off >= acc && off <= acc + part.length + 1) { key = part.trim(); break; }
          acc += part.length + 1;
        }
      }
      return { cmd: m[1], arg: m[3], key: key.trim(), from: line.from + m.index, to: line.from + m.index + m[0].length };
    }
  }
  return null;
}
export { wordArgAt };

export const latexHover = hoverTooltip(async (view, pos) => {
  const { state } = view;
  const s = hoverCtx.settings || {};
  const wa = wordArgAt(state, pos);
  if (wa) {
    if (/cite/i.test(wa.cmd)) {
      const keys = wa.key ? [wa.key] : wa.arg.split(',').map((k) => k.trim());
      const ents = keys.map((k) => (hoverCtx.index?.bibEntries || []).find((e) => e.key === k)).filter(Boolean);
      return {
        pos: wa.from, end: wa.to, above: true,
        create() {
          const dom = document.createElement('div');
          dom.className = 'hover-card';
          if (!ents.length) dom.innerHTML = `<div class="hc-muted">未找到文献 “${escape(wa.key)}”</div>`;
          for (const e of ents) {
            const d = document.createElement('div');
            d.className = 'hc-cite';
            d.innerHTML = `<div class="hc-title">${escape(e.title || e.key)}</div><div class="hc-meta">${escape([e.author, e.year].filter(Boolean).join(' · '))}</div><div class="hc-muted">${escape(e.journal || '')}</div>`;
            dom.append(d);
          }
          return { dom };
        },
      };
    }
    if (/ref$/i.test(wa.cmd) || wa.cmd === 'eqref') {
      const lab = (hoverCtx.index?.labels || []).find((l) => l.key === wa.key);
      return {
        pos: wa.from, end: wa.to, above: true,
        create() {
          const dom = document.createElement('div');
          dom.className = 'hover-card';
          dom.innerHTML = lab
            ? `<div class="hc-meta">${escape(lab.file.split(/[\\/]/).pop())}:${lab.line}</div><div class="hc-code">${escape(lab.context)}</div>`
            : `<div class="hc-muted">未定义的标签 “${escape(wa.key)}”</div>`;
          return { dom };
        },
      };
    }
    if (wa.cmd === 'includegraphics' && hoverCtx.resolveImage) {
      const file = await hoverCtx.resolveImage(wa.arg);
      if (!file) return null;
      return {
        pos: wa.from, end: wa.to, above: true,
        create() {
          const dom = document.createElement('div');
          dom.className = 'hover-card hover-image';
          if (/\.pdf$/i.test(file)) {
            hoverCtx.renderPdfThumb?.(file, 320).then((c) => { if (c) dom.append(c); });
          } else {
            const img = document.createElement('img');
            img.src = 'file:///' + file.replace(/\\/g, '/').replace(/#/g, '%23');
            dom.append(img);
          }
          const cap = document.createElement('div');
          cap.className = 'hc-muted';
          cap.textContent = file.split(/[\\/]/).pop();
          dom.append(cap);
          return { dom };
        },
      };
    }
  }
  if (s.mathPreview === false) return null;
  const m = findMathAt(state, pos);
  if (!m || !m.tex.trim()) return null;
  return {
    pos: m.from, end: m.to, above: true,
    create() {
      const dom = document.createElement('div');
      dom.className = 'hover-card hover-math';
      dom.innerHTML = renderMath(m, hoverCtx.index?.macros);
      return { dom };
    },
  };
}, { hoverTime: 380 });

function escape(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---------- spellcheck scoping: commands, math, refs are not spell-checked ----------
const NO_SPELL = new Set(['command', 'keyword', 'envName', 'section', 'math', 'mathCmd', 'mathDelim', 'refArg', 'refCmd', 'verbatim', 'magic', 'optArg', 'escape', 'special']);
const noSpellMark = Decoration.mark({ attributes: { spellcheck: 'false' } });

export const spellScope = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(u) { if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = this.build(u.view); }
  build(view) {
    const ranges = [];
    const tree = syntaxTree(view.state);
    for (const { from, to } of view.visibleRanges) {
      tree.iterate({ from, to, enter(n) { if (NO_SPELL.has(n.name) && n.to > n.from) ranges.push(noSpellMark.range(n.from, n.to)); } });
    }
    return Decoration.set(ranges, true);
  }
}, { decorations: (v) => v.decorations });

// Highlight a line briefly (used after jumps / inverse search)
import { StateEffect, StateField } from '@codemirror/state';
export const flashLineEffect = StateEffect.define();
const flashDeco = Decoration.line({ class: 'cm-flash-line' });
export const flashLineField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(flashLineEffect)) deco = e.value == null ? Decoration.none : Decoration.set([flashDeco.range(e.value)]);
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
