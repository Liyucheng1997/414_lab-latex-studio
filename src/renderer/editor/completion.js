// LaTeX autocompletion: commands, environments, labels, citations, files, packages.
import { snippet } from '@codemirror/autocomplete';
import { COMMANDS, ENVIRONMENTS, ENV_BODIES, ENV_ARGS, PACKAGES, CLASSES, REF_RE, CITE_RE, FILE_RE, PKG_RE, CLASS_RE, BEGIN_RE } from '../data/latex-data.js';
import { relative, extname, stripExt, dirname } from '../util.js';

let ctx = { index: null, files: [], rootDir: null, fileDir: null };
export function setCompletionContext(c) { ctx = { ...ctx, ...c }; }

// Convert "\frac{num}{den}" into a snippet template "\frac{${num}}{${den}}"
export function toTemplate(sig) {
  let out = '';
  let i = 0;
  while (i < sig.length) {
    const c = sig[i];
    // A literal \{ must be written \\{ in the template, since the parser strips one backslash before braces.
    if (c === '\\' && (sig[i + 1] === '{' || sig[i + 1] === '}')) { out += '\\\\' + sig[i + 1]; i += 2; continue; }
    if (c === '{' || c === '[' || (c === '<' && sig[i - 1] !== ' ')) {
      const close = { '{': '}', '[': ']', '<': '>' }[c];
      let depth = 1, j = i + 1;
      while (j < sig.length && depth > 0) { if (sig[j] === c) depth++; else if (sig[j] === close) depth--; j++; }
      const inner = sig.slice(i + 1, j - 1);
      if (/[{}]/.test(inner)) out += c + inner.replace(/\\([{}])/g, '\\\\$1') + close;
      else out += c + '${' + inner + '}' + close;
      i = j;
    } else if (c === '|' && /\\(verb|lstinline)\|/.test(sig)) {
      const j = sig.indexOf('|', i + 1);
      out += '|${' + sig.slice(i + 1, j) + '}|';
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out + '${}';
}

const MATH_HINT = /^\\(frac|dfrac|tfrac|cfrac|binom|sqrt|sum|prod|int|iint|iiint|oint|lim|mathbf|mathrm|mathit|mathsf|mathtt|mathcal|mathbb|mathfrak|mathscr|boldsymbol|bm|hat|widehat|bar|overline|tilde|widetilde|vec|dot|ddot|check|breve|acute|grave|over|under|stackrel|left|right|big|Big|bigg|Bigg|[a-z]*arrow|[A-Z][a-z]*arrow|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|leq|geq|neq|approx|equiv|sim|in|notin|subset|cdot|times|infty|partial|nabla|forall|exists)/;

// Frequently used commands rank above rarer ones that match equally well.
const COMMON = new Set(['frac', 'section', 'subsection', 'subsubsection', 'textbf', 'textit', 'emph', 'begin', 'end', 'label', 'ref', 'eqref', 'cite', 'citep', 'citet', 'cref', 'includegraphics', 'caption', 'centering', 'item', 'usepackage', 'mathbf', 'mathrm', 'mathcal', 'mathbb', 'sqrt', 'sum', 'int', 'left', 'right', 'alpha', 'beta', 'theta', 'lambda', 'sigma', 'omega', 'footnote', 'input', 'include', 'hline', 'toprule', 'midrule', 'bottomrule', 'text', 'quad', 'qquad', 'cdot', 'times', 'leq', 'geq', 'infty', 'partial', 'hat', 'bar', 'tilde', 'vec', 'dot', 'url', 'href', 'textwidth', 'linewidth', 'noindent', 'vspace', 'hspace', 'newcommand', 'chapter', 'paragraph', 'texttt', 'underline', 'tableofcontents', 'maketitle', 'documentclass']);
let commandOptions = null;
function buildCommandOptions() {
  const seen = new Map();
  for (const sig of COMMANDS) {
    const m = /^\\([a-zA-Z@]+\*?)/.exec(sig);
    const name = m ? m[1] : sig.slice(1);
    const hasArgs = sig.length > name.length + 1;
    const label = sig.replace(/\{([^{}]*)\}/g, '{…}').replace(/\[([^\[\]]*)\]/g, '[…]');
    const key = sig;
    if (seen.has(key)) continue;
    seen.set(key, {
      label: '\\' + name,
      displayLabel: hasArgs ? label : undefined,
      detail: hasArgs ? sig.slice(name.length + 1) : undefined,
      type: MATH_HINT.test(sig) ? 'math' : 'cmd',
      apply: hasArgs ? snippet(toTemplate(sig)) : '\\' + name,
      boost: COMMON.has(name) ? 3 : 0,
    });
  }
  return [...seen.values()];
}

function userCommandOptions() {
  const out = [];
  const seen = new Set();
  for (const c of ctx.index?.commands || []) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    const tpl = '\\' + c.name + Array.from({ length: c.args }, (_, i) => `{\${${i + 1}}}`).join('') + '${}';
    out.push({ label: '\\' + c.name, detail: c.args ? `[${c.args}] 自定义` : '自定义', type: 'user', apply: c.args ? snippet(tpl) : '\\' + c.name, boost: 2 });
  }
  return out;
}

function envOption(name, prefix, closeBrace) {
  const body = (ENV_BODIES[name] ?? '\t|').replace(/\\([{}])/g, '\\\\$1');
  const args = ENV_ARGS[name] || '';
  const argTpl = args.replace(/\{([^{}]*)\}/g, (_, x) => `{\${${x}}}`).replace(/\[([^\[\]]*)\]/g, (_, x) => `[\${${x}}]`);
  return {
    label: name,
    type: 'env',
    detail: '环境',
    apply: (view, completion, from, to) => {
      // snippet() re-indents following lines and expands leading tabs to the indent unit.
      const inner = body.replace(/\|/g, '${}');
      const t = `${name}}${argTpl}\n${inner}\n\\end{${name}}`;
      snippet(t)(view, completion, from, closeBrace ? to + 1 : to);
    },
  };
}

function rangeAfterLastComma(text, from, start) {
  const i = text.lastIndexOf(',');
  return i >= 0 ? from + i + 1 + (/^\s*/.exec(text.slice(i + 1))[0].length) : start;
}

export function latexCompletion(context) {
  const { state, pos } = context;
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(Math.max(0, pos - line.from - 300), pos - line.from);
  const after = line.text.slice(pos - line.from, pos - line.from + 1);
  const closeBrace = after === '}';

  // \begin{  / \end{
  let m = BEGIN_RE.exec(before);
  if (m) {
    const from = pos - m[2].length;
    if (m[1] === 'end') {
      // Suggest the innermost open environment first
      const text = state.doc.sliceString(Math.max(0, pos - 20000), pos);
      const stack = [];
      const re = /\\(begin|end)\{([^}]+)\}/g;
      let x;
      while ((x = re.exec(text))) { if (x[1] === 'begin') stack.push(x[2]); else { const i = stack.lastIndexOf(x[2]); if (i >= 0) stack.splice(i, 1); } }
      const open = stack.reverse();
      const names = [...new Set([...open, ...ENVIRONMENTS, ...(ctx.index?.envs || [])])];
      return { from, to: closeBrace ? pos + 1 : pos, options: names.map((n, i) => ({ label: n, type: 'env', apply: n + '}', boost: i < open.length ? 50 - i : 0 })), validFor: /^[a-zA-Z*]*$/ };
    }
    const names = [...new Set([...ENVIRONMENTS, ...(ctx.index?.envs || [])])];
    return { from, options: names.map((n) => envOption(n, m[2], closeBrace)), validFor: /^[a-zA-Z*]*$/ };
  }

  // references
  m = REF_RE.exec(before);
  if (m) {
    const from = rangeAfterLastComma(m[1], pos - m[1].length, pos - m[1].length);
    const labels = ctx.index?.labels || [];
    return {
      from,
      options: labels.map((l) => ({ label: l.key, type: 'label', detail: shortFile(l.file) + ':' + l.line, info: l.context })),
      validFor: /^[^,}\s]*$/,
    };
  }

  // citations
  m = CITE_RE.exec(before);
  if (m) {
    const from = rangeAfterLastComma(m[1], pos - m[1].length, pos - m[1].length);
    const entries = ctx.index?.bibEntries || [];
    return {
      from,
      options: entries.map((e) => ({
        label: e.key, type: 'cite',
        detail: [e.author.split(/ and /)[0]?.split(',')[0], e.year].filter(Boolean).join(' · '),
        info: () => citeInfo(e),
      })),
      validFor: /^[^,}\s]*$/,
    };
  }

  // files
  m = FILE_RE.exec(before);
  if (m && ctx.rootDir) {
    const kind = m[1];
    const typed = m[2];
    const from = pos - typed.length;
    const exts = kind === 'includegraphics' ? ['.pdf', '.png', '.jpg', '.jpeg', '.eps', '.svg'] : kind === 'includepdf' ? ['.pdf'] : (kind === 'bibliography' || kind === 'addbibresource') ? ['.bib'] : kind === 'lstinputlisting' ? null : ['.tex'];
    const dropExt = kind === 'input' || kind === 'include' || kind === 'subfile' || kind === 'bibliography' || kind === 'includeonly';
    const files = (ctx.files || []).filter((f) => !exts || exts.includes(extname(f)));
    return {
      from,
      options: files.map((f) => {
        let rel = relative(ctx.rootDir, f);
        if (dropExt) rel = stripExt(rel);
        return { label: rel, type: kind === 'includegraphics' ? 'image' : 'file' };
      }),
      validFor: /^[^}]*$/,
    };
  }

  m = PKG_RE.exec(before);
  if (m) {
    const from = rangeAfterLastComma(m[1], pos - m[1].length, pos - m[1].length);
    return { from, options: PACKAGES.map((p) => ({ label: p, type: 'pkg' })), validFor: /^[\w-]*$/ };
  }
  m = CLASS_RE.exec(before);
  if (m) return { from: pos - m[1].length, options: CLASSES.map((p) => ({ label: p, type: 'pkg' })), validFor: /^[\w-]*$/ };

  // commands
  const word = context.matchBefore(/\\[a-zA-Z@]*\*?/);
  if (word && (word.from < word.to || context.explicit)) {
    if (!commandOptions) commandOptions = buildCommandOptions();
    return { from: word.from, options: [...userCommandOptions(), ...commandOptions], validFor: /^\\[a-zA-Z@]*\*?$/ };
  }
  return null;
}

function shortFile(f) { return (f || '').split(/[\\/]/).pop(); }

export function citeInfo(e) {
  const el = document.createElement('div');
  el.className = 'cite-info';
  el.innerHTML = `<div class="ci-title"></div><div class="ci-meta"></div><div class="ci-src"></div>`;
  el.children[0].textContent = e.title || e.key;
  el.children[1].textContent = [e.author, e.year].filter(Boolean).join(' · ');
  el.children[2].textContent = [e.journal, e.type].filter(Boolean).join(' · ');
  return el;
}
