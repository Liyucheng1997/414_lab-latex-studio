// Forward / inverse search using the synctex command line tool shipped with TeX distributions.
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { tool } = require('./texenv');

function exec(bin, args, cwd) {
  return new Promise((resolve) => {
    execFile(bin, args, { cwd, windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 10000 }, (err, stdout) => {
      resolve(err && !stdout ? '' : stdout || '');
    });
  });
}

function blocks(out) {
  const body = out.split('SyncTeX result begin')[1];
  if (!body) return [];
  const res = [];
  let cur = null;
  for (const raw of body.split(/\r?\n/)) {
    const i = raw.indexOf(':');
    if (i < 0) continue;
    const k = raw.slice(0, i);
    const v = raw.slice(i + 1);
    if (k === 'Output') { cur = {}; res.push(cur); continue; }
    if (!cur) { cur = {}; res.push(cur); }
    if (k in cur && (k === 'Page' || k === 'Input')) { cur = {}; res.push(cur); }
    cur[k] = v;
  }
  return res;
}

// Directory holding the .synctex.gz when it is not next to the PDF (latexmk $aux_dir, build/ …).
function synctexDirArgs(pdf) {
  const dir = path.dirname(pdf);
  const stem = path.basename(pdf, '.pdf');
  if (fs.existsSync(path.join(dir, stem + '.synctex.gz')) || fs.existsSync(path.join(dir, stem + '.synctex'))) return [];
  const { latexmkDirs } = require('./compiler');
  const cands = [latexmkDirs(dir).aux, path.join(dir, 'build'), path.join(dir, 'out'), path.join(dir, 'output')].filter(Boolean);
  for (const c of cands) if (fs.existsSync(path.join(c, stem + '.synctex.gz'))) return ['-d', c];
  return [];
}

async function forward({ pdf, tex, line, column = 0, texBin }) {
  if (!fs.existsSync(pdf)) return null;
  const bin = tool(texBin, 'synctex');
  const cwd = path.dirname(pdf);
  const dArgs = synctexDirArgs(pdf);
  const tries = [tex, path.relative(cwd, tex), './' + path.relative(cwd, tex).replace(/\\/g, '/')];
  for (const t of tries) {
    const out = await exec(bin, ['view', '-i', `${line}:${column}:${t}`, '-o', pdf, ...dArgs], cwd);
    const rs = blocks(out).filter((b) => b.Page);
    if (rs.length) {
      const pages = rs.map((b) => ({ page: +b.Page, x: +b.x, y: +b.y, h: +b.h, v: +b.v, W: +b.W, H: +b.H }));
      return { page: pages[0].page, boxes: pages.filter((p) => p.page === pages[0].page) };
    }
  }
  return null;
}

async function inverse({ pdf, page, x, y, texBin }) {
  if (!fs.existsSync(pdf)) return null;
  const bin = tool(texBin, 'synctex');
  const cwd = path.dirname(pdf);
  const out = await exec(bin, ['edit', '-o', `${page}:${x.toFixed(2)}:${y.toFixed(2)}:${pdf}`, ...synctexDirArgs(pdf)], cwd);
  const r = blocks(out).find((b) => b.Input);
  if (!r) return null;
  return { file: path.normalize(path.resolve(cwd, r.Input)), line: Math.max(1, +r.Line || 1), column: Math.max(0, +r.Column || 0) };
}

module.exports = { forward, inverse };
