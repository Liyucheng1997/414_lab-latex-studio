// Parse a TeX .log file into structured issues.
// Assumes max_print_line is large (we set it in the environment), so lines are not wrapped.
const path = require('path');

const FILE_RE = /^(?:"([^"]+)"|((?:[A-Za-z]:)?[^()\s"]*[\\/][^()\s"]*|[^()\s"]+\.(?:tex|sty|cls|bbl|aux|toc|lof|lot|cfg|def|fd|clo|ldf|ltx|bib|bst|out|nav|snm|tikz|pgf|lco|dtx|ins|code\.tex|mkii|dict)))/i;
const FILE_LINE_ERROR = /^((?:[A-Za-z]:)?[^:]*?\.[A-Za-z0-9]+):(\d+): (.*)$/;
const WARNING = /^(LaTeX(?: Font)?|Package ([^\s]+)|Class ([^\s]+)|pdfTeX|LaTeX3?) Warning: (.*)$/;
const BADBOX = /^((?:Over|Under)full \\[hv]box .*?)(?: in paragraph| in alignment| detected| has occurred while \\output is active)?(?: at lines? (\d+)(?:--(\d+))?)?\s*$/;

// "Undefined control sequence." → name the command, which TeX prints at the end of the l.N line.
function withCulprit(msg, context) {
  if (!/^Undefined control sequence/.test(msg)) return msg;
  const l = context.map((c) => c.split('\n')[0]).find((c) => /^l\.\d+/.test(c));
  const m = l && /(\\[A-Za-z@]+|\\.)\s*$/.exec(l);
  return m ? `Undefined control sequence: ${m[1]}` : msg;
}

function parseLog(text, cwd) {
  const lines = text.split(/\r?\n/);
  const issues = [];
  const stack = [];
  let mainFile = null;
  const flags = { rerun: false, needBib: false, needBiber: false, undefinedRefs: false, undefinedCites: false, fatal: false, noOutput: false };

  const current = () => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i]) return stack[i];
    return mainFile;
  };
  const resolve = (f) => {
    if (!f) return null;
    f = f.replace(/^"|"$/g, '');
    try { return path.resolve(cwd, f); } catch { return f; }
  };

  // Track the file stack via parentheses on a single line.
  const scanParens = (line) => {
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (ch === '(') {
        const m = FILE_RE.exec(line.slice(i + 1));
        if (m) {
          const f = resolve(m[1] || m[2]);
          stack.push(f);
          if (!mainFile && /\.tex$/i.test(f)) mainFile = f;
          i += 1 + m[0].length;
          continue;
        }
        stack.push(null);
      } else if (ch === ')') {
        stack.pop();
      }
      i++;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    let m = FILE_LINE_ERROR.exec(line);
    if (m && !/^(?:Package|LaTeX|Class)\b/.test(line)) {
      const file = resolve(m[1]);
      let msg = m[3];
      let context = [];
      for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
        const l = lines[j];
        if (/^l\.\d+/.test(l)) { context.push(l + (lines[j + 1] ? '\n' + lines[j + 1] : '')); break; }
        if (l.trim() === '' && context.length) break;
        if (l.trim() !== '') context.push(l);
      }
      issues.push({ type: 'error', file, line: +m[2], message: withCulprit(msg.trim(), context), context: context.join('\n') });
      if (/Emergency stop|Fatal error/i.test(msg)) flags.fatal = true;
      continue;
    }

    if (line.startsWith('! ')) {
      let msg = line.slice(2);
      let ln = null;
      const context = [];
      for (let j = i + 1; j < Math.min(lines.length, i + 14); j++) {
        const lm = /^l\.(\d+)/.exec(lines[j]);
        if (lm) { ln = +lm[1]; context.push(lines[j]); break; }
        if (lines[j].trim()) context.push(lines[j]);
      }
      if (/Emergency stop/.test(msg)) { flags.fatal = true; if (issues.some((x) => x.type === 'error')) continue; }
      issues.push({ type: 'error', file: current(), line: ln, message: withCulprit(msg.trim(), context), context: context.join('\n') });
      continue;
    }

    m = WARNING.exec(line);
    if (m) {
      let msg = m[4];
      const pkg = m[2] || m[3];
      // Continuation lines are indented with "(pkg)" or spaces.
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (pkg && l.startsWith('(' + pkg + ')')) { msg += ' ' + l.slice(pkg.length + 2).trim(); i = j; continue; }
        if (!pkg && /^\s{2,}\S/.test(l) && !/^\s*\(/.test(l)) { msg += ' ' + l.trim(); i = j; continue; }
        break;
      }
      const lm = /on input line (\d+)/.exec(msg) || /at lines? (\d+)/.exec(msg);
      const type = 'warning';
      if (/Rerun to get|Label\(s\) may have changed|Please rerun LaTeX|rerun LaTeX|Rerun LaTeX/i.test(msg)) flags.rerun = true;
      if (/There were undefined references/.test(msg) || /Reference .* undefined/.test(msg)) flags.undefinedRefs = true;
      if (/Citation .* undefined/.test(msg) || /There were undefined citations/.test(msg)) flags.undefinedCites = true;
      if (/Please \(re\)run Biber/i.test(msg)) flags.needBiber = true;
      if (/Please \(re\)run BibTeX/i.test(msg)) flags.needBib = true;
      issues.push({ type, file: current(), line: lm ? +lm[1] : null, message: (pkg ? `[${pkg}] ` : '') + msg.trim() });
      scanParens(line.replace(/\(.*?\)/g, ''));
      continue;
    }

    m = BADBOX.exec(line);
    if (m && /^(Over|Under)full/.test(line)) {
      issues.push({ type: 'badbox', file: current(), line: m[2] ? +m[2] : null, message: m[1].trim() });
      // Skip the box content dump that follows (it is not file stack information).
      while (i + 1 < lines.length && lines[i + 1].trim() !== '' && !/^\(|^\)/.test(lines[i + 1])) i++;
      continue;
    }

    if (/^No pages of output\./.test(line)) { flags.noOutput = true; issues.push({ type: 'warning', file: mainFile, line: null, message: '没有生成任何页面 (No pages of output)' }); }
    if (/Rerun to get cross-references right|Rerun to get outlines right|Rerun LaTeX/.test(line)) flags.rerun = true;
    if (/^Runaway argument\?/.test(line)) issues.push({ type: 'error', file: current(), line: null, message: 'Runaway argument? ' + (lines[i + 1] || '') });

    scanParens(line);
  }

  // De-duplicate identical messages.
  const seen = new Set();
  const out = [];
  for (const x of issues) {
    const k = `${x.type}|${x.file}|${x.line}|${x.message}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return { issues: out, flags };
}

module.exports = { parseLog };
