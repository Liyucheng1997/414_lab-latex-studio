// Locate the TeX distribution (TeX Live / MiKTeX) on this machine.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const EXE = process.platform === 'win32' ? '.exe' : '';

function hasEngine(dir) {
  try { return fs.existsSync(path.join(dir, 'pdflatex' + EXE)); } catch { return false; }
}

function fromPath() {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(cmd, ['pdflatex'], { encoding: 'utf8', windowsHide: true, timeout: 4000 });
    const first = out.split(/\r?\n/).find(Boolean);
    if (first) return path.dirname(first.trim());
  } catch {}
  return null;
}

function scanCommon() {
  const found = [];
  if (process.platform === 'win32') {
    for (const drive of 'CDEFGH') {
      const base = `${drive}:\\texlive`;
      try {
        const years = fs.readdirSync(base).filter((y) => /^\d{4}$/.test(y)).sort().reverse();
        for (const y of years) {
          for (const arch of ['windows', 'win64', 'win32']) {
            const d = path.join(base, y, 'bin', arch);
            if (hasEngine(d)) found.push(d);
          }
        }
      } catch {}
    }
    const local = process.env.LOCALAPPDATA || '';
    for (const d of [
      path.join(local, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64'),
      'C:\\Program Files\\MiKTeX\\miktex\\bin\\x64',
      'C:\\Program Files (x86)\\MiKTeX\\miktex\\bin',
    ]) if (hasEngine(d)) found.push(d);
  } else {
    for (const d of ['/Library/TeX/texbin', '/usr/local/texlive/2025/bin/x86_64-linux', '/usr/bin', '/usr/local/bin']) {
      if (hasEngine(d)) found.push(d);
    }
  }
  return found;
}

let cached = null;
function findTexBin(preferred) {
  if (preferred && hasEngine(preferred)) return preferred;
  if (cached) return cached;
  cached = scanCommon()[0] || fromPath() || null;
  return cached;
}

function tool(bin, name) {
  if (!bin) return name;
  const p = path.join(bin, name + EXE);
  return fs.existsSync(p) ? p : name;
}

module.exports = { findTexBin, tool, scanCommon };
