// Build pipeline: engine runs, bibliography, index, automatic reruns.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { tool } = require('./texenv');
const { parseLog } = require('./logparser');

const bibSignatures = new Map(); // root -> signature of citations + bib files
const idxSignatures = new Map();
let running = null;

const hash = (s) => crypto.createHash('md5').update(s).digest('hex');
const readSafe = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };

// latexmk can be configured to put auxiliary files in another directory ($aux_dir).
function latexmkDirs(cwd) {
  for (const n of ['latexmkrc', '.latexmkrc']) {
    const t = readSafe(path.join(cwd, n));
    if (!t) continue;
    const aux = /\$aux_dir\s*=\s*['"]([^'"]+)['"]/.exec(t);
    const out = /\$out_dir\s*=\s*['"]([^'"]+)['"]/.exec(t);
    return { aux: aux ? path.resolve(cwd, aux[1]) : null, out: out ? path.resolve(cwd, out[1]) : null };
  }
  return { aux: null, out: null };
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else child.kill('SIGTERM');
}

function run(cmd, args, cwd, texBin, onOutput) {
  return new Promise((resolve) => {
    const env = { ...process.env, max_print_line: '10000', error_line: '254', half_error_line: '238' };
    if (texBin) env.PATH = texBin + path.delimiter + (env.PATH || env.Path || '');
    if (process.platform === 'win32' && env.Path) { env.Path = env.PATH; }
    onOutput?.(`\n▸ ${path.basename(cmd)} ${args.join(' ')}\n`);
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, windowsHide: true });
    } catch (e) {
      onOutput?.(String(e) + '\n');
      return resolve({ code: -1, error: e });
    }
    running = child;
    child.stdout.on('data', (d) => onOutput?.(d.toString('utf8')));
    child.stderr.on('data', (d) => onOutput?.(d.toString('utf8')));
    child.on('error', (e) => { onOutput?.(`无法启动 ${cmd}: ${e.message}\n`); resolve({ code: -1, error: e }); });
    child.on('close', (code) => { if (running === child) running = null; resolve({ code, killed: child.killed || child.signalCode != null }); });
  });
}

function bibInfo(base) {
  const aux = readSafe(base + '.aux') || '';
  const bcf = fs.existsSync(base + '.bcf');
  const cites = (aux.match(/\\citation\{[^}]*\}/g) || []).join(',');
  const dataM = aux.match(/\\bibdata\{([^}]*)\}/);
  const bibs = dataM ? dataM[1].split(',').map((s) => s.trim()) : [];
  let bcfText = bcf ? readSafe(base + '.bcf') || '' : '';
  const bcfBibs = [...bcfText.matchAll(/<bcf:datasource[^>]*>([^<]+)<\/bcf:datasource>/g)].map((m) => m[1]);
  const bcfCites = [...bcfText.matchAll(/<bcf:citekey[^>]*>([^<]+)<\/bcf:citekey>/g)].map((m) => m[1]).join(',');
  const dir = path.dirname(base);
  const files = [...bibs, ...bcfBibs].map((b) => path.resolve(dir, /\.bib$/i.test(b) ? b : b + '.bib'));
  const sig = hash(cites + '|' + bcfCites + '|' + files.map((f) => f + ':' + mtime(f)).join(';'));
  return { usesBib: bibs.length > 0 || bcf, biber: bcf, sig };
}

async function build(opts, onOutput, onStep) {
  const { root, engine = 'pdflatex', shellEscape = false, bibTool = 'auto', mode = 'smart', texBin, extraArgs = '' } = opts;
  const cwd = path.dirname(root);
  const name = path.basename(root);
  const base = root.replace(/\.(tex|ltx)$/i, '');
  const pdf = base + '.pdf';
  const t0 = Date.now();
  const extra = extraArgs ? extraArgs.split(/\s+/).filter(Boolean) : [];
  const common = ['-synctex=1', '-interaction=nonstopmode', '-file-line-error', ...(shellEscape ? ['-shell-escape'] : []), ...extra];
  const steps = [];
  let stopped = false;
  const runStep = async (label, cmd, args) => {
    onStep?.(label);
    steps.push(label);
    const r = await run(cmd, args, cwd, texBin, onOutput);
    if (r.killed) stopped = true;
    return r;
  };

  let parsed = { issues: [], flags: {} };
  const readLog = () => {
    const dirs = latexmkDirs(cwd);
    const cands = [base + '.log', ...(dirs.aux ? [path.join(dirs.aux, path.basename(base) + '.log')] : [])];
    const logFile = cands.filter((f) => fs.existsSync(f)).sort((a, b) => mtime(b) - mtime(a))[0];
    const log = (logFile && readSafe(logFile)) || '';
    parsed.logFile = logFile;
    parsed = parseLog(log, cwd);
    return log;
  };

  if (mode === 'latexmk') {
    const flag = { pdflatex: '-pdf', xelatex: '-pdfxe', lualatex: '-pdflua' }[engine] || '-pdf';
    await runStep('latexmk', tool(texBin, 'latexmk'), [flag, ...common, name]);
    readLog();
  } else {
    const eng = tool(texBin, engine);
    let r = await runStep(engine, eng, [...common, name]);
    if (r.code === -1 && r.error) return { ok: false, pdf, issues: [{ type: 'error', file: root, line: null, message: `找不到编译器 ${engine}，请在设置中指定 TeX 的 bin 目录。` }], flags: {}, duration: Date.now() - t0, steps };
    readLog();
    let runs = 1;

    if (!stopped && mode === 'smart' && bibTool !== 'none' && !parsed.flags.fatal) {
      const info = bibInfo(base);
      const bblMissing = !fs.existsSync(base + '.bbl');
      const prev = bibSignatures.get(root);
      if (info.usesBib && (bblMissing || prev !== info.sig || parsed.flags.needBiber || parsed.flags.needBib)) {
        const useBiber = bibTool === 'biber' || (bibTool === 'auto' && info.biber);
        const bt = useBiber ? 'biber' : 'bibtex';
        await runStep(bt, tool(texBin, bt), [path.basename(base)]);
        bibSignatures.set(root, bibInfo(base).sig);
        if (!stopped) { await runStep(engine, eng, [...common, name]); runs++; readLog(); parsed.flags.rerun = true; }
      }
    }

    if (!stopped && mode === 'smart' && fs.existsSync(base + '.idx')) {
      const sig = hash(readSafe(base + '.idx') || '');
      if (idxSignatures.get(root) !== sig || !fs.existsSync(base + '.ind')) {
        await runStep('makeindex', tool(texBin, 'makeindex'), [path.basename(base) + '.idx']);
        idxSignatures.set(root, sig);
        parsed.flags.rerun = true;
      }
    }

    while (!stopped && mode !== 'single' && parsed.flags.rerun && !parsed.flags.fatal && runs < 5) {
      await runStep(engine + ' (rerun)', eng, [...common, name]);
      runs++;
      readLog();
    }
  }

  const pdfOk = mtime(pdf) >= t0 - 1000;
  const errors = parsed.issues.filter((x) => x.type === 'error').length;
  return { ok: !stopped && pdfOk && errors === 0, stopped, pdf, pdfUpdated: pdfOk, issues: parsed.issues, flags: parsed.flags, duration: Date.now() - t0, steps, logFile: parsed.logFile };
}

async function runTool(name, root, texBin, onOutput) {
  const cwd = path.dirname(root);
  const base = path.basename(root).replace(/\.(tex|ltx)$/i, '');
  const args = { bibtex: [base], biber: [base], makeindex: [base + '.idx'], makeglossaries: [base] }[name] || [base];
  const r = await run(tool(texBin, name), args, cwd, texBin, onOutput);
  return { ok: r.code === 0 };
}

function stop() { if (running) { killTree(running); return true; } return false; }

const AUX_EXT = ['aux', 'log', 'out', 'toc', 'lof', 'lot', 'bbl', 'blg', 'bcf', 'run.xml', 'fls', 'fdb_latexmk', 'synctex.gz', 'synctex(busy)', 'nav', 'snm', 'vrb', 'idx', 'ind', 'ilg', 'glo', 'gls', 'glg', 'ist', 'xdv', 'thm', 'loa', 'lol', 'spl'];
function clean(root) {
  const base = root.replace(/\.(tex|ltx)$/i, '');
  const removed = [];
  for (const ext of AUX_EXT) {
    const f = `${base}.${ext}`;
    try { fs.unlinkSync(f); removed.push(path.basename(f)); } catch {}
  }
  // Included chapter .aux files next to the root.
  try {
    const dir = path.dirname(root);
    const walk = (d, depth) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory() && depth < 2 && !e.name.startsWith('.') && e.name !== 'node_modules') walk(p, depth + 1);
        else if (e.isFile() && /\.aux$/i.test(e.name) && fs.existsSync(p.replace(/\.aux$/i, '.tex'))) { try { fs.unlinkSync(p); removed.push(path.relative(dir, p)); } catch {} }
      }
    };
    walk(dir, 0);
  } catch {}
  bibSignatures.delete(root);
  idxSignatures.delete(root);
  return removed;
}

module.exports = { latexmkDirs, build, stop, clean, runTool, isRunning: () => !!running };
