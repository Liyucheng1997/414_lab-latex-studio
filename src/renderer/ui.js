// Toasts, modals, menus — all built on tokens.css.
import { h, fmtKey } from './util.js';
import { icon } from './icons.js';

// ---------- toast ----------
let toastHost;
export function toast(msg, type = 'info', ms = 2400) {
  if (!toastHost) { toastHost = h('div', { class: 'toast-host' }); document.body.append(toastHost); }
  const el = h('div', { class: `toast toast-${type}` }, msg);
  toastHost.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 350); }, ms);
}

// ---------- modal ----------
export function modal({ title, body, footer, width = 440, onClose, className = '' }) {
  const overlay = h('div', { class: 'modal-overlay' });
  const close = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey, true); onClose?.(v); };
  const x = h('button', { class: 'modal-x', title: '关闭', onclick: () => close(null) }, icon('x', 14, 2));
  const box = h('div', { class: `modal ${className}`, style: { width: width + 'px' } },
    title != null ? h('div', { class: 'modal-header' }, h('span', {}, title), x) : null,
    h('div', { class: 'modal-body' }, body),
    footer ? h('div', { class: 'modal-footer' }, footer) : null,
  );
  overlay.append(box);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(null); });
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(null); }
  };
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  // Drag by header
  const header = box.querySelector('.modal-header');
  if (header) {
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      const r = box.getBoundingClientRect();
      const ox = e.clientX - r.left, oy = e.clientY - r.top;
      box.style.position = 'fixed';
      box.style.margin = '0';
      const mv = (ev) => { box.style.left = ev.clientX - ox + 'px'; box.style.top = ev.clientY - oy + 'px'; };
      const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
      addEventListener('mousemove', mv); addEventListener('mouseup', up);
    });
  }
  setTimeout(() => box.querySelector('[autofocus], input, select, textarea, .btn-primary')?.focus(), 30);
  return { close, box, overlay };
}

export function confirmDialog({ title, message, ok = '确定', cancel = '取消', danger = false, third }) {
  return new Promise((resolve) => {
    let m;
    const done = (v) => { m.close(); resolve(v); };
    const body = h('div', { class: 'confirm' },
      h('div', { class: `confirm-ico ${danger ? 'danger' : ''}` }, icon(danger ? 'warning' : 'info', 24, 1.75)),
      h('div', { class: 'confirm-title' }, title),
      message ? h('div', { class: 'modal-msg confirm-msg' }, message) : null,
    );
    const footer = [
      third ? h('button', { class: 'btn btn-danger-ghost', onclick: () => done('third') }, third) : null,
      h('button', { class: 'btn', onclick: () => done(false) }, cancel),
      h('button', { class: `btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`, onclick: () => done(true) }, ok),
    ];
    m = modal({ title: null, body, footer, width: 380, onClose: (v) => { if (v === null) resolve(false); } });
    m.box.classList.add('confirm-box');
    m.box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(true); } });
  });
}

export function promptDialog({ title, label, value = '', placeholder = '', ok = '确定', validate }) {
  return new Promise((resolve) => {
    let m;
    const input = h('input', { class: 'input', value, placeholder, style: { width: '100%' } });
    const err = h('div', { class: 'form-error' });
    const submit = () => {
      const v = input.value;
      const e = validate?.(v);
      if (e) { err.textContent = e; return; }
      m.close(); resolve(v);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    m = modal({
      title, width: 420,
      body: h('div', { class: 'form' }, label ? h('label', { class: 'form-label' }, label) : null, input, err),
      footer: [h('button', { class: 'btn', onclick: () => { m.close(); resolve(null); } }, '取消'), h('button', { class: 'btn btn-primary', onclick: submit }, ok)],
      onClose: (v) => { if (v === null) resolve(null); },
    });
    setTimeout(() => { input.focus(); input.select(); }, 40);
  });
}

// ---------- menus ----------
let openMenus = [];
export function closeMenus(level = 0) {
  while (openMenus.length > level) openMenus.pop().remove();
  if (level === 0) document.dispatchEvent(new CustomEvent('menus-closed'));
}

document.addEventListener('mousedown', (e) => {
  if (!openMenus.length) return;
  if (openMenus.some((m) => m.contains(e.target))) return;
  if (e.target.closest('.menubar-btn')) return;
  closeMenus();
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openMenus.length) { closeMenus(); e.stopPropagation(); } }, true);
window.addEventListener('blur', () => closeMenus());

/**
 * items: [{label, icon, shortcut, run, disabled, checked, submenu: items|() => items, sep: true, header}]
 */
export function showMenu(items, x, y, { level = 0, minWidth = 210, anchor } = {}) {
  closeMenus(level);
  if (typeof items === 'function') items = items();
  const menu = h('div', { class: 'popover menu', style: { minWidth: minWidth + 'px' } });
  let subTimer;
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { menu.append(h('div', { class: 'menu-sep' })); continue; }
    if (it.header) { menu.append(h('div', { class: 'menu-header' }, it.header)); continue; }
    const row = h('div', { class: `menu-item ${it.disabled ? 'disabled' : ''}` },
      h('span', { class: 'menu-icon' }, it.checked ? icon('check', 14, 2.2) : it.icon ? icon(it.icon, 15) : it.glyph ? h('span', { class: 'menu-glyph' }, it.glyph) : null),
      h('span', { class: 'menu-label' }, it.label),
      it.shortcut ? h('span', { class: 'menu-shortcut' }, fmtKey(it.shortcut)) : null,
      it.submenu ? h('span', { class: 'menu-shortcut menu-arrow' }, icon('chevron-right', 13, 2)) : null,
    );
    if (it.submenu) {
      const openSub = () => {
        clearTimeout(subTimer);
        const r = row.getBoundingClientRect();
        showMenu(it.submenu, r.right + 2, r.top - 5, { level: level + 1 });
      };
      row.addEventListener('mouseenter', () => { clearTimeout(subTimer); subTimer = setTimeout(openSub, 120); });
      row.addEventListener('click', openSub);
    } else {
      row.addEventListener('mouseenter', () => { clearTimeout(subTimer); subTimer = setTimeout(() => closeMenus(level + 1), 150); });
      row.addEventListener('click', () => { if (it.disabled) return; closeMenus(); it.run?.(); });
    }
    menu.append(row);
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  const vw = innerWidth, vh = innerHeight;
  let left = x, top = y;
  if (left + r.width > vw - 4) left = level > 0 ? Math.max(4, x - r.width - 220) : vw - r.width - 4;
  if (top + r.height > vh - 4) top = Math.max(4, vh - r.height - 4);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  openMenus.push(menu);
  return menu;
}

export const menuOpen = () => openMenus.length > 0;

// ---------- tooltip for icon buttons ----------
let tipEl, tipTimer;
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest?.('[data-tip]');
  clearTimeout(tipTimer);
  if (!t) { tipEl?.remove(); tipEl = null; return; }
  tipTimer = setTimeout(() => {
    tipEl?.remove();
    tipEl = h('div', { class: 'tip' }, t.dataset.tip, t.dataset.key ? h('span', { class: 'tip-key' }, fmtKey(t.dataset.key)) : null);
    document.body.append(tipEl);
    const r = t.getBoundingClientRect();
    const tr = tipEl.getBoundingClientRect();
    let left = r.left + r.width / 2 - tr.width / 2;
    left = Math.max(6, Math.min(innerWidth - tr.width - 6, left));
    let top = r.bottom + 8;
    if (top + tr.height > innerHeight - 6) top = r.top - tr.height - 8;
    tipEl.style.left = left + 'px';
    tipEl.style.top = top + 'px';
  }, 450);
});
document.addEventListener('mousedown', () => { clearTimeout(tipTimer); tipEl?.remove(); tipEl = null; }, true);

export function iconButton(name, tip, onclick, { key, cls = '', size = 16 } = {}) {
  return h('button', { class: `icon-btn ${cls}`, 'data-tip': tip, 'data-key': key, onclick }, icon(name, size));
}

// ---------- splitters ----------
export function makeSplitter(el, { axis = 'x', onMove, onEnd }) {
  el.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const start = axis === 'x' ? e.clientX : e.clientY;
    document.body.classList.add(axis === 'x' ? 'resizing-x' : 'resizing-y');
    el.classList.add('active');
    const mv = (ev) => onMove((axis === 'x' ? ev.clientX : ev.clientY) - start, ev);
    const up = () => {
      removeEventListener('mousemove', mv); removeEventListener('mouseup', up);
      document.body.classList.remove('resizing-x', 'resizing-y');
      el.classList.remove('active');
      onEnd?.();
    };
    addEventListener('mousemove', mv); addEventListener('mouseup', up);
  });
}
