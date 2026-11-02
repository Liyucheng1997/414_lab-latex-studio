// Project indexing: root document detection, include graph, labels, bibliography, outline.
import { dirname, resolve, extname, basename, samePath, stripExt, join } from './util.js';
import { commentIndex } from './editor/latex-lang.js';

const api = window.api;

export const LEVELS = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6 };

export function stripComments(text) {
  return text.split('\n').map((l) => { const i = commentIndex(l); return i >= 0 ? l.slice(0, i) : l; }).join('\n');
}

// Read a balanced {...} argument starting at text[i] === '{'
export function readArg(text, i) {
  if (text[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === '\\') { j++; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return { value: text.slice(i + 1, j), end: j + 1 }; }
  }
  return null;
}

export function magicComments(text) {
  const out = {};
  const head = text.split('\n', 40);
  for (const l of head) {
    // % !TEX root = …, % !TeX TS-program = xelatex, % !TeX TXS-program:compile = txs:///latexmk
    const m = /^\s*%\s*!T[eE]X\s+([\w:-]+)\s*=\s*(.+?)\s*$/.exec(l);
    if (m) out[m[1].toLowerCase().replace(/^ts-/, '')] = m[2];
  }
  return out;
}

export function hasDocumentClass(text) {
  return /^[^%\n]*\\documentclass/m.test(text) || /^[^%\n]*\\begin\{document\}/m.test(text);
}

const INCLUDE_RE = /\\(input|include|subfile|import|subimport|includefrom|subincludefrom)\*?\s*(\{[^{}]*\})(\{[^{}]*\})?/g;

function resolveTex(base, name) {
  let n = name.trim().replace(/^"|"$/g, '');
  if (!n) return null;
  if (!extname(n)) n += '.tex';
  return resolve(base, n);
}

export async function readText(path, getOpenText) {
  const t = getOpenText?.(path);
  if (t != null) return t;
  try { return (await api.read(path)).content; } catch { return null; }
}

/** Find included files of a text. */
export function findIncludes(text, rootDir, fileDir) {
  const res = [];
  const clean = stripComments(text);
  INCLUDE_RE.lastIndex = 0;
  let m;
  while ((m = INCLUDE_RE.exec(clean))) {
    const kind = m[1];
    const a1 = m[2].slice(1, -1);
    const a2 = m[3] ? m[3].slice(1, -1) : null;
    let p;
    if ((kind === 'import' || kind === 'subimport' || kind.endsWith('from')) && a2 != null) {
      const base = kind.startsWith('sub') ? fileDir : rootDir;
      p = resolveTex(resolve(base, a1), a2);
    } else if (kind === 'subfile') {
      p = resolveTex(fileDir, a1);
    } else {
      p = resolveTex(rootDir, a1);
    }
    if (p) res.push({ path: p, index: m.index, kind });
  }
  return res;
}

export function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** Determine root document for a file. */
export async function detectRoot(path, text, { master, getOpenText, openPaths = [] } = {}) {
  if (master) return master;
  if (!path) return null;
  const mc = magicComments(text);
  if (mc.root) return resolve(dirname(path), mc.root);
  if (hasDocumentClass(text) || !/\.tex$/i.test(path)) return path;
  // Look in open docs and sibling / parent directories for a file including this one.
  const candidates = new Set(openPaths.filter((p) => /\.tex$/i.test(p) && !samePath(p, path)));
  for (const dir of [dirname(path), dirname(dirname(path))]) {
    try {
      const entries = await api.readdir(dir);
      for (const e of entries) if (!e.isDir && /\.tex$/i.test(e.name)) candidates.add(e.path);
    } catch {}
  }
  const myStem = stripExt(basename(path)).toLowerCase();
  for (const c of candidates) {
    if (samePath(c, path)) continue;
    const t = await readText(c, getOpenText);
    if (!t || !hasDocumentClass(t)) continue;
    if (!t.toLowerCase().includes(myStem)) continue;
    const inc = await collectFiles(c, getOpenText, 3);
    if (inc.some((f) => samePath(f, path))) return c;
  }
  return path;
}

async function collectFiles(root, getOpenText, maxDepth = 8) {
  const seen = [];
  const rootDir = dirname(root);
  const walk = async (p, depth) => {
    if (depth > maxDepth || seen.some((s) => samePath(s, p))) return;
    seen.push(p);
    const t = await readText(p, getOpenText);
    if (t == null) return;
    for (const inc of findIncludes(t, rootDir, dirname(p))) await walk(inc.path, depth + 1);
  };
  await walk(root, 0);
  return seen;
}

// ---------- BibTeX ----------
export function parseBib(text, file) {
  const entries = [];
  const re = /@([a-zA-Z]+)\s*[{(]\s*([^,\s]+)\s*,/g;
  let m;
  while ((m = re.exec(text))) {
    const type = m[1].toLowerCase();
    if (type === 'comment' || type === 'string' || type === 'preamble') continue;
    // find end of entry by brace matching
    let depth = 1, i = re.lastIndex;
    for (; i < text.length && depth > 0; i++) {
      const c = text[i];
      if (c === '{' || c === '(') depth++;
      else if (c === '}' || c === ')') depth--;
    }
    const body = text.slice(re.lastIndex, i - 1);
    const field = (name) => {
      const fm = new RegExp(`(?:^|[,\\s])${name}\\s*=\\s*`, 'i').exec(body);
      if (!fm) return '';
      let j = fm.index + fm[0].length;
      if (body[j] === '{') { const a = readArg(body, j); return a ? a.value : ''; }
      if (body[j] === '"') { const e = body.indexOf('"', j + 1); return body.slice(j + 1, e); }
      const e = body.slice(j).search(/[,\n}]/);
      return body.slice(j, e < 0 ? undefined : j + e).trim();
    };
    const clean = (s) => s.replace(/[{}]/g, '').replace(/\\[a-zA-Z]+\s*/g, '').replace(/\s+/g, ' ').trim();
    entries.push({
      key: m[2], type, file, line: lineOf(text, m.index),
      title: clean(field('title')), author: clean(field('author')), year: clean(field('year') || field('date')).slice(0, 4),
      journal: clean(field('journal') || field('booktitle') || field('publisher')),
    });
    re.lastIndex = i;
  }
  return entries;
}

// ---------- full project index ----------
export async function indexProject(root, getOpenText, projectFiles = []) {
  const rootDir = dirname(root);
  const files = [];
  const labels = [];
  const commands = [];
  const envs = [];
  const bibNames = [];
  const outline = [];
  const todos = [];
  const visited = [];
  const macros = {};

  const parseFile = async (path, depth, parentList) => {
    if (depth > 10 || visited.some((v) => samePath(v, path))) return;
    visited.push(path);
    const text = await readText(path, getOpenText);
    if (text == null) { parentList.push({ kind: 'missing', title: basename(path), file: path, line: 1, children: [] }); return; }
    files.push(path);
    const clean = stripComments(text);
    const lines = text.split('\n');
    const fileDir = dirname(path);

    // Collect events in order: sections, labels, includes, floats
    const events = [];
    const secRe = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*?)\s*(?:\[[^\]]*\])?\s*(?=\{)/g;
    let m;
    while ((m = secRe.exec(clean))) {
      const a = readArg(clean, secRe.lastIndex);
      if (!a) continue;
      events.push({ index: m.index, type: 'section', level: LEVELS[m[1]], cmd: m[1], star: !!m[2], title: a.value.replace(/\s+/g, ' ').trim() });
    }
    const labRe = /\\label\s*\{([^{}]+)\}/g;
    while ((m = labRe.exec(clean))) {
      const ln = lineOf(clean, m.index);
      const ctx = (lines[ln - 1] || '').trim();
      labels.push({ key: m[1].trim(), file: path, line: ln, context: ctx });
      events.push({ index: m.index, type: 'label', title: m[1].trim() });
    }
    const flRe = /\\begin\{(figure\*?|table\*?|algorithm\*?)\}/g;
    while ((m = flRe.exec(clean))) {
      const end = clean.indexOf('\\end{' + m[1] + '}', m.index);
      const body = clean.slice(m.index, end < 0 ? m.index + 3000 : end);
      const cm = /\\caption\s*(?:\[[^\]]*\])?\s*(?=\{)/.exec(body);
      let cap = '';
      if (cm) { const a = readArg(body, cm.index + cm[0].length); if (a) cap = a.value.replace(/\s+/g, ' ').trim(); }
      events.push({ index: m.index, type: 'float', env: m[1], title: cap || m[1] });
    }
    for (const inc of findIncludes(text, rootDir, fileDir)) events.push({ index: inc.index, type: 'include', path: inc.path });
    const ncRe = /\\(?:newcommand|renewcommand|providecommand|DeclareRobustCommand|DeclareMathOperator)\*?\s*\{?\\([a-zA-Z@]+)\}?\s*(?:\[(\d)\])?/g;
    while ((m = ncRe.exec(clean))) commands.push({ name: m[1], args: m[2] ? +m[2] : 0, file: path });
    // Macro bodies for the KaTeX hover preview
    const mdRe = /\\(?:newcommand|renewcommand|providecommand|DeclareRobustCommand)\*?\s*\{?\\([a-zA-Z]+)\}?\s*(?:\[(\d)\])?\s*(?:\[[^\]]*\])?\s*(?=\{)/g;
    while ((m = mdRe.exec(clean))) { const a = readArg(clean, mdRe.lastIndex); if (a) macros['\\' + m[1]] = a.value; }
    const dmRe = /\\DeclareMathOperator(\*?)\s*\{\\([a-zA-Z]+)\}\s*\{([^{}]*)\}/g;
    while ((m = dmRe.exec(clean))) macros['\\' + m[2]] = `\\operatorname${m[1]}{${m[3]}}`;
    const defRe = /\\def\\([a-zA-Z@]+)/g;
    while ((m = defRe.exec(clean))) commands.push({ name: m[1], args: 0, file: path });
    const neRe = /\\(?:newenvironment|renewenvironment|newtheorem|NewDocumentEnvironment|newtcolorbox)\*?\s*\{([^{}]+)\}/g;
    while ((m = neRe.exec(clean))) envs.push(m[1]);
    const bibRe = /\\(?:bibliography|addbibresource|addglobalbib)\s*(?:\[[^\]]*\])?\s*\{([^{}]+)\}/g;
    while ((m = bibRe.exec(clean))) for (const b of m[1].split(',')) bibNames.push({ name: b.trim(), dir: rootDir });
    lines.forEach((l, i) => {
      const tm = /%\s*(TODO|FIXME|XXX)\b[:\s]*(.*)$/i.exec(l);
      if (tm) todos.push({ file: path, line: i + 1, title: tm[2] || tm[1] });
      const tdm = /\\todo(?:\[[^\]]*\])?\{([^}]*)\}/.exec(l);
      if (tdm) todos.push({ file: path, line: i + 1, title: tdm[1] });
    });

    events.sort((a, b) => a.index - b.index);
    // Precompute line numbers incrementally
    let lastIdx = 0, lastLine = 1;
    for (const ev of events) {
      for (let k = lastIdx; k < ev.index; k++) if (clean.charCodeAt(k) === 10) lastLine++;
      lastIdx = ev.index;
      ev.line = lastLine;
    }
    for (const ev of events) {
      if (ev.type === 'section') {
        parentList.push({ kind: 'section', level: ev.level, cmd: ev.cmd, title: ev.title, file: path, line: ev.line, children: [] });
      } else if (ev.type === 'include') {
        const item = { kind: 'include', title: relativeName(rootDir, ev.path), file: ev.path, line: 1, fromFile: path, fromLine: ev.line, children: [] };
        parentList.push(item);
        const before = parentList.length;
        await parseFile(ev.path, depth + 1, parentList);
        if (parentList.length === before) {}
      } else if (ev.type === 'float') {
        parentList.push({ kind: 'float', env: ev.env, title: ev.title, file: path, line: ev.line, children: [] });
      } else if (ev.type === 'label') {
        parentList.push({ kind: 'label', title: ev.title, file: path, line: ev.line, children: [] });
      }
    }
  };

  const flat = [];
  await parseFile(root, 0, flat);

  // Build tree by section levels
  const tree = [];
  const stack = [];
  for (const it of flat) {
    if (it.kind === 'section') {
      while (stack.length && stack[stack.length - 1].level >= it.level) stack.pop();
      (stack.length ? stack[stack.length - 1].children : tree).push(it);
      stack.push(it);
    } else {
      (stack.length ? stack[stack.length - 1].children : tree).push(it);
    }
  }

  // Bibliography files
  let bibFiles = bibNames.map((b) => resolve(b.dir, /\.bib$/i.test(b.name) ? b.name : b.name + '.bib'));
  if (!bibFiles.length) bibFiles = projectFiles.filter((f) => /\.bib$/i.test(f)).slice(0, 20);
  const bibEntries = [];
  for (const bf of bibFiles) {
    const t = await readText(bf, getOpenText);
    if (t) bibEntries.push(...parseBib(t, bf));
  }
  // \bibitem entries
  for (const f of files) {
    const t = getOpenText?.(f) ?? null;
    const text = t ?? (await readText(f, getOpenText));
    if (!text) continue;
    const re = /\\bibitem(?:\[[^\]]*\])?\{([^}]+)\}/g;
    let m;
    while ((m = re.exec(text))) bibEntries.push({ key: m[1], type: 'bibitem', file: f, line: lineOf(text, m.index), title: '', author: '', year: '' });
  }

  return { root, rootDir, files, labels, commands, envs, bibFiles, bibEntries, outline: tree, todos, macros };
}

function relativeName(dir, p) {
  const d = dir.replace(/[\\/]+$/, '') + (dir.includes('\\') ? '\\' : '/');
  return p.toLowerCase().startsWith(d.toLowerCase()) ? p.slice(d.length).replace(/\\/g, '/') : basename(p);
}

/** Outline of a single file text (used for the active file when not part of a project). */
export function guessEngine(text) {
  const mc = magicComments(text);
  const prog = (mc.program || mc.compiler || mc['txs-program:compile'] || mc['txs-program:quick'] || '').toLowerCase();
  if (/xelatex/.test(prog)) return 'xelatex';
  if (/lualatex/.test(prog)) return 'lualatex';
  if (/pdflatex/.test(prog)) return 'pdflatex';
  if (/latexmk/.test(prog)) return 'latexmk';
  return null;
}

export function guessBibTool(text) {
  const mc = magicComments(text);
  const v = (mc['txs-program:bibliography'] || mc.bib || mc.bibliography || '').toLowerCase();
  if (/biber/.test(v)) return 'biber';
  if (/bibtex/.test(v)) return 'bibtex';
  return null;
}
