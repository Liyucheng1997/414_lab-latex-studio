// Small DOM and path helpers shared by the renderer.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- paths (Windows-aware, no Node in the renderer) ----
export const SEP = navigator.userAgent.includes('Windows') ? '\\' : '/';
export function normalize(p) {
  if (!p) return p;
  let s = p.replace(/[\\/]+/g, SEP);
  const parts = [];
  const lead = s.match(/^([A-Za-z]:\\|\\\\|\/)/);
  const prefix = lead ? lead[1] : '';
  for (const part of s.slice(prefix.length).split(SEP)) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (parts.length && parts[parts.length - 1] !== '..') parts.pop(); else if (!prefix) parts.push('..'); continue; }
    parts.push(part);
  }
  return prefix + parts.join(SEP);
}
export const basename = (p) => (p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
export const dirname = (p) => { const s = (p || '').replace(/[\\/]+$/, ''); const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/')); return i <= 0 ? s : (i === 2 && s[1] === ':' ? s.slice(0, 3) : s.slice(0, i)); };
export const extname = (p) => { const b = basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i).toLowerCase() : ''; };
export const stripExt = (p) => p.replace(/\.[^.\\/]+$/, '');
export const isAbsolute = (p) => /^([A-Za-z]:[\\/]|\\\\|\/)/.test(p);
export function join(...ps) { return normalize(ps.filter(Boolean).join(SEP)); }
export function resolve(base, rel) { return isAbsolute(rel) ? normalize(rel) : join(base, rel); }
export function samePath(a, b) {
  if (!a || !b) return false;
  const na = normalize(a), nb = normalize(b);
  return SEP === '\\' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}
export function relative(from, to) {
  const a = normalize(from).split(SEP), b = normalize(to).split(SEP);
  const eq = (x, y) => (SEP === '\\' ? x.toLowerCase() === y.toLowerCase() : x === y);
  let i = 0;
  while (i < a.length && i < b.length && eq(a[i], b[i])) i++;
  if (i === 0) return normalize(to);
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

export function fuzzyScore(query, text) {
  if (!query) return 1;
  const q = query.toLowerCase(), t = text.toLowerCase();
  const idx = t.indexOf(q);
  if (idx >= 0) return 1000 - idx - t.length * 0.1;
  let ti = 0, score = 0, streak = 0;
  for (const ch of q) {
    const f = t.indexOf(ch, ti);
    if (f < 0) return 0;
    streak = f === ti ? streak + 1 : 0;
    score += 1 + streak * 2;
    ti = f + 1;
  }
  return score;
}

export const isMac = navigator.userAgent.includes('Mac');
export function fmtKey(k) {
  if (!k) return '';
  return k.split('-').map((p) => ({ Mod: isMac ? '⌘' : 'Ctrl', Shift: isMac ? '⇧' : 'Shift', Alt: isMac ? '⌥' : 'Alt', Ctrl: 'Ctrl' }[p] || (p.length === 1 ? p.toUpperCase() : p))).join(isMac ? '' : '+');
}
