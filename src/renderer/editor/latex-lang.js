// LaTeX stream tokenizer with math, verbatim, sectioning and reference awareness.
import { StreamLanguage, HighlightStyle, foldService, LanguageSupport } from '@codemirror/language';
import { Tag, tags } from '@lezer/highlight';

export const T = {
  command: Tag.define(),
  keyword: Tag.define(), // \begin \end
  envName: Tag.define(),
  section: Tag.define(), // \section
  heading: Tag.define(), // section title text
  math: Tag.define(),
  mathCmd: Tag.define(),
  mathDelim: Tag.define(),
  brace: Tag.define(),
  bracket: Tag.define(),
  special: Tag.define(),
  comment: tags.comment,
  magic: Tag.define(),
  todo: Tag.define(),
  verbatim: Tag.define(),
  refArg: Tag.define(),
  refCmd: Tag.define(),
  escape: Tag.define(),
  optArg: Tag.define(),
};

const MATH_ENVS = new Set(['equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*', 'flalign', 'flalign*', 'eqnarray', 'eqnarray*', 'displaymath', 'math', 'alignat', 'alignat*', 'dmath', 'dmath*', 'IEEEeqnarray', 'IEEEeqnarray*']);
const VERB_ENVS = new Set(['verbatim', 'verbatim*', 'lstlisting', 'minted', 'Verbatim', 'comment', 'filecontents', 'filecontents*', 'BVerbatim', 'LVerbatim', 'alltt', 'pycode', 'luacode', 'luacode*']);
const SECTIONS = new Set(['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph', 'title', 'frametitle', 'caption']);
const REF_CMDS = /^(?:label|ref|eqref|pageref|autoref|nameref|cref|Cref|crefrange|vref|labelcref|cite[a-zA-Z]*|[a-z]*cite[a-z]*|Cite[a-zA-Z]*|nocite|input|include|includeonly|subfile|includegraphics|bibliography|addbibresource|usepackage|RequirePackage|documentclass|includepdf|url|href|hyperref|bibliographystyle|subimport|import|lstinputlisting|inputminted)\*?$/;
const TEXT_CMDS = /^(?:text|textrm|textsf|texttt|textbf|textit|mbox|hbox|intertext|shortintertext|operatorname)$/;

const latexParser = {
  name: 'latex',
  startState: () => ({ math: 0, mathEnv: [], textInMath: 0, verbEnv: null, verbDelim: null, expect: null, argKind: null, argDepth: 0, pendingEnv: null, envStack: [] }),
  copyState: (s) => ({ ...s, mathEnv: s.mathEnv.slice(), envStack: s.envStack.slice() }),
  token(stream, s) {
    // Inline \verb|...|
    if (s.verbDelim) {
      while (!stream.eol()) {
        if (stream.next() === s.verbDelim) { s.verbDelim = null; break; }
      }
      if (stream.eol()) s.verbDelim = null;
      return 'verbatim';
    }
    // Verbatim environments
    if (s.verbEnv) {
      const end = '\\end{' + s.verbEnv + '}';
      if (stream.sol() || true) {
        const idx = stream.string.indexOf(end, stream.pos);
        if (idx === stream.pos) {
          stream.pos += 4;
          s.verbEnv = null;
          s.expect = 'endEnv';
          return 'keyword';
        }
        if (idx > stream.pos) { stream.pos = idx; return 'verbatim'; }
        stream.skipToEnd();
        return 'verbatim';
      }
    }

    // Environment name after \begin / \end
    if (s.expect === 'beginEnv' || s.expect === 'endEnv') {
      const kind = s.expect;
      s.expect = null;
      const m = stream.match(/^\s*\{([^{}]*)\}/);
      if (m) {
        const env = m[1].trim();
        if (kind === 'beginEnv') {
          if (VERB_ENVS.has(env)) { s.verbEnv = env; s.pendingVerbOpts = true; }
          else if (MATH_ENVS.has(env)) s.mathEnv.push(env);
          s.envStack.push(env);
        } else {
          if (MATH_ENVS.has(env) && s.mathEnv.length) s.mathEnv.pop();
          if (s.envStack.length && s.envStack[s.envStack.length - 1] === env) s.envStack.pop();
        }
        return 'envName';
      }
    }

    const inMath = (s.math > 0 || s.mathEnv.length > 0) && s.textInMath === 0;
    const ch = stream.peek();

    if (ch === '%') {
      stream.skipToEnd();
      const t = stream.current();
      if (/^%\s*!T[eE]X/.test(t)) return 'magic';
      if (/^%\s*(TODO|FIXME|XXX|NOTE)\b/i.test(t)) return 'todo';
      return 'comment';
    }

    if (ch === '\\') {
      stream.next();
      if (stream.eat(/[a-zA-Z@]/)) {
        stream.eatWhile(/[a-zA-Z@]/);
        const name = stream.current().slice(1);
        if (name === 'begin') { s.expect = 'beginEnv'; return 'keyword'; }
        if (name === 'end') { s.expect = 'endEnv'; return 'keyword'; }
        if (name === 'verb' || name === 'lstinline' || name === 'mintinline') {
          if (name === 'verb') { stream.eat('*'); const d = stream.next(); if (d) s.verbDelim = d; return 'refCmd'; }
          return 'command';
        }
        stream.eat('*');
        if (inMath && TEXT_CMDS.test(name) && stream.peek() === '{') { s.argKind = 'text'; s.argDepth = 0; return 'mathCmd'; }
        if (inMath) return 'mathCmd';
        if (SECTIONS.has(name)) { s.argKind = 'heading'; s.argDepth = 0; return 'section'; }
        if (REF_CMDS.test(name)) { s.argKind = 'ref'; s.argDepth = 0; return 'refCmd'; }
        return 'command';
      }
      const c = stream.next();
      if (c === '(' || c === '[') { s.math++; return 'mathDelim'; }
      if (c === ')' || c === ']') { if (s.math > 0) s.math--; return 'mathDelim'; }
      if (c === '\\') return 'special';
      return inMath ? 'math' : 'escape';
    }

    if (ch === '$') {
      stream.next();
      const dbl = stream.eat('$');
      if (s.math > 0 && s.mathEnv.length === 0) s.math--; else s.math++;
      return 'mathDelim';
    }

    if (ch === '{' || ch === '}') {
      stream.next();
      if (s.argKind) {
        if (ch === '{') {
          s.argDepth++;
          if (s.argKind === 'text') s.textInMath++;
        } else {
          s.argDepth--;
          if (s.argDepth <= 0) {
            if (s.argKind === 'text') s.textInMath = Math.max(0, s.textInMath - 1);
            s.argKind = null;
          }
        }
        return inMath && s.argKind !== 'text' ? 'math' : 'brace';
      }
      return inMath ? 'math' : 'brace';
    }

    if (s.argKind && s.argDepth > 0) {
      // Inside argument of a heading / reference command.
      if (s.argKind === 'heading') {
        stream.eatWhile(/[^\\{}$%]/);
        if (stream.current()) return 'heading';
      } else if (s.argKind === 'ref') {
        stream.eatWhile(/[^\\{}%]/);
        if (stream.current()) return 'refArg';
      }
    }
    if (s.argKind && s.argDepth === 0 && ch === '[') {
      stream.next();
      let depth = 1;
      while (!stream.eol() && depth > 0) { const c = stream.next(); if (c === '[') depth++; else if (c === ']') depth--; }
      return 'optArg';
    }
    if (s.argKind && s.argDepth === 0 && !/\s/.test(ch)) s.argKind = null;

    if (inMath) {
      if (/[\^_&]/.test(ch)) { stream.next(); return 'special'; }
      stream.next();
      stream.eatWhile(/[^\\$%{}\^_&\]\)]/);
      return 'math';
    }

    if (ch === '[' || ch === ']') { stream.next(); return 'bracket'; }
    if (ch === '&' || ch === '~' || ch === '#') { stream.next(); return 'special'; }
    if (/\s/.test(ch)) { stream.eatSpace(); return null; }
    stream.next();
    stream.eatWhile(/[^\\$%{}\[\]&~#\s]/);
    return null;
  },
  blankLine(s) { if (s.math > 0 && s.mathEnv.length === 0) s.math = 0; },
  languageData: {
    commentTokens: { line: '%' },
    closeBrackets: { brackets: ['(', '[', '{'] },
    wordChars: '\\@',
  },
  tokenTable: {
    command: T.command, keyword: T.keyword, envName: T.envName, section: T.section, heading: T.heading,
    math: T.math, mathCmd: T.mathCmd, mathDelim: T.mathDelim, brace: T.brace, bracket: T.bracket, special: T.special,
    comment: T.comment, magic: T.magic, todo: T.todo, verbatim: T.verbatim, refArg: T.refArg, refCmd: T.refCmd,
    escape: T.escape, optArg: T.optArg,
  },
};

export const latexLanguage = StreamLanguage.define(latexParser);

export const latexHighlight = HighlightStyle.define([
  { tag: T.command, class: 'tk-cmd' },
  { tag: T.keyword, class: 'tk-kw' },
  { tag: T.envName, class: 'tk-env' },
  { tag: T.section, class: 'tk-sec' },
  { tag: T.heading, class: 'tk-head' },
  { tag: T.math, class: 'tk-math' },
  { tag: T.mathCmd, class: 'tk-mathcmd' },
  { tag: T.mathDelim, class: 'tk-mathdelim' },
  { tag: T.brace, class: 'tk-brace' },
  { tag: T.bracket, class: 'tk-bracket' },
  { tag: T.special, class: 'tk-special' },
  { tag: T.comment, class: 'tk-comment' },
  { tag: T.magic, class: 'tk-magic' },
  { tag: T.todo, class: 'tk-todo' },
  { tag: T.verbatim, class: 'tk-verb' },
  { tag: T.refArg, class: 'tk-ref' },
  { tag: T.refCmd, class: 'tk-refcmd' },
  { tag: T.escape, class: 'tk-escape' },
  { tag: T.optArg, class: 'tk-opt' },
]);

// BibTeX: minimal highlighting
const bibParser = {
  name: 'bibtex',
  startState: () => ({ inEntry: false, depth: 0, expectKey: false }),
  token(stream, s) {
    if (stream.eatSpace()) return null;
    const ch = stream.peek();
    if (ch === '%' && s.depth === 0) { stream.skipToEnd(); return 'comment'; }
    if (ch === '@') { stream.next(); stream.eatWhile(/[A-Za-z]/); s.expectKey = true; return 'keyword'; }
    if (ch === '{' || ch === '(') { stream.next(); s.depth++; return 'brace'; }
    if (ch === '}' || ch === ')') { stream.next(); s.depth = Math.max(0, s.depth - 1); return 'brace'; }
    if (s.expectKey && s.depth === 1) { stream.eatWhile(/[^,\s}]/); s.expectKey = false; return 'envName'; }
    if (s.depth === 1 && stream.match(/^[A-Za-z_-]+(?=\s*=)/)) return 'command';
    if (ch === '\\') { stream.next(); stream.eatWhile(/[a-zA-Z]/); return 'command'; }
    if (ch === '"' ) { stream.next(); return 'brace'; }
    if (ch === '$') { stream.next(); return 'mathDelim'; }
    stream.next();
    stream.eatWhile(/[^{}()\\"@%\s$]/);
    return s.depth >= 2 ? 'heading' : null;
  },
  languageData: { commentTokens: { line: '%' } },
  tokenTable: latexParser.tokenTable,
};
export const bibLanguage = StreamLanguage.define(bibParser);

// ---------- folding ----------
const SECTION_LEVEL = { part: -1, chapter: 0, section: 1, subsection: 2, subsubsection: 3, paragraph: 4, subparagraph: 5 };
const SEC_RE = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*[\[{]/;
const BEGIN_RE = /\\begin\s*\{([^}]+)\}/g;

export const latexFolding = foldService.of((state, lineStart, lineEnd) => {
  const line = state.doc.lineAt(lineStart);
  const text = line.text;
  const ci = commentIndex(text);
  const code = ci >= 0 ? text.slice(0, ci) : text;

  // Section folds
  const sm = SEC_RE.exec(code);
  if (sm) {
    const level = SECTION_LEVEL[sm[1]];
    const max = Math.min(state.doc.lines, line.number + 20000);
    let endLine = null;
    for (let n = line.number + 1; n <= max; n++) {
      const t = state.doc.line(n).text;
      const m2 = SEC_RE.exec(t);
      if ((m2 && SECTION_LEVEL[m2[1]] <= level) || /^\s*\\end\{document\}/.test(t) || /^\s*\\(appendix|bibliography|printbibliography)\b/.test(t)) { endLine = n - 1; break; }
    }
    if (endLine == null) endLine = state.doc.lines;
    while (endLine > line.number && state.doc.line(endLine).text.trim() === '') endLine--;
    if (endLine > line.number) return { from: line.to, to: state.doc.line(endLine).to };
    return null;
  }

  // Environment folds
  BEGIN_RE.lastIndex = 0;
  const bm = BEGIN_RE.exec(code);
  if (bm && bm[1] !== 'document') {
    const env = bm[1];
    const esc = env.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const reB = new RegExp(`\\\\begin\\s*\\{${esc}\\}`, 'g');
    const reE = new RegExp(`\\\\end\\s*\\{${esc}\\}`, 'g');
    let depth = 0;
    const max = Math.min(state.doc.lines, line.number + 5000);
    for (let n = line.number; n <= max; n++) {
      let t = state.doc.line(n).text;
      const c = commentIndex(t);
      if (c >= 0) t = t.slice(0, c);
      const startCol = n === line.number ? bm.index : 0;
      const seg = t.slice(startCol);
      depth += (seg.match(reB) || []).length;
      const ends = (seg.match(reE) || []).length;
      depth -= ends;
      if (depth <= 0 && n > line.number) {
        const l = state.doc.line(n);
        const endIdx = l.text.search(reE);
        return { from: line.to, to: l.from + Math.max(0, endIdx) };
      }
      if (depth <= 0 && n === line.number) return null;
    }
  }
  return null;
});

export function commentIndex(text) {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '%') {
      let bs = 0;
      for (let j = i - 1; j >= 0 && text[j] === '\\'; j--) bs++;
      if (bs % 2 === 0) return i;
    }
  }
  return -1;
}

export function latex() {
  return new LanguageSupport(latexLanguage, [latexFolding]);
}
export function bibtex() {
  return new LanguageSupport(bibLanguage);
}
