// Embedded PDF viewer built on pdf.js: lazy page rendering, flicker-free reloads, SyncTeX hooks.
import * as pdfjs from 'pdfjs-dist';
import { h } from './util.js';

pdfjs.GlobalWorkerOptions.workerSrc = './pdf.worker.mjs';
const DOC_OPTS = { cMapUrl: './cmaps/', cMapPacked: true, standardFontDataUrl: './standard_fonts/', isEvalSupported: false, enableXfa: false };

const GAP = 14;

export class PdfViewer {
  constructor(scroll, { onInverse, onPageChange, onZoomChange, onStatus } = {}) {
    this.scroll = scroll;
    this.inner = h('div', { class: 'pdf-pages' });
    this.scroll.append(this.inner);
    this.pages = [];
    this.doc = null;
    this.path = null;
    this.zoomMode = 'width'; // 'width' | 'page' | number
    this.scale = 1;
    this.onInverse = onInverse;
    this.onPageChange = onPageChange;
    this.onZoomChange = onZoomChange;
    this.onStatus = onStatus;
    this.renderQueue = new Set();
    this.loadToken = 0;
    this.textCache = new Map();
    this.search = { query: '', hits: [], index: -1 };

    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const p = this.pages[+e.target.dataset.index];
        if (!p) continue;
        p.visible = e.isIntersecting;
        if (e.isIntersecting) this.queue(p);
      }
    }, { root: this.scroll, rootMargin: '120% 0px' });

    this.scroll.addEventListener('scroll', () => this.updateCurrentPage(), { passive: true });
    this.scroll.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0022);
      this.zoomAt(this.scale * factor, e.clientX, e.clientY);
    }, { passive: false });
    this.scroll.addEventListener('click', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const pageEl = e.target.closest('.pdf-page');
      if (!pageEl) return;
      e.preventDefault();
      const p = this.pages[+pageEl.dataset.index];
      const r = pageEl.getBoundingClientRect();
      const x = (e.clientX - r.left) / this.scale;
      const y = (e.clientY - r.top) / this.scale;
      this.flashPoint(p, e.clientX - r.left, e.clientY - r.top);
      this.onInverse?.({ page: p.index + 1, x, y });
    });
    this.scroll.addEventListener('dblclick', (e) => {
      // double-click also performs inverse search (like many viewers) when no text is being selected
      if (e.ctrlKey || e.metaKey) return;
      const pageEl = e.target.closest('.pdf-page');
      if (!pageEl || !this.dblClickSync) return;
      const p = this.pages[+pageEl.dataset.index];
      const r = pageEl.getBoundingClientRect();
      getSelection()?.removeAllRanges();
      this.flashPoint(p, e.clientX - r.left, e.clientY - r.top);
      this.onInverse?.({ page: p.index + 1, x: (e.clientX - r.left) / this.scale, y: (e.clientY - r.top) / this.scale });
    });
    // Drag-to-pan with middle mouse or while holding space
    let pan = null;
    this.scroll.addEventListener('mousedown', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      pan = { x: e.clientX, y: e.clientY, sl: this.scroll.scrollLeft, st: this.scroll.scrollTop };
      this.scroll.classList.add('panning');
    });
    addEventListener('mousemove', (e) => { if (!pan) return; this.scroll.scrollLeft = pan.sl - (e.clientX - pan.x); this.scroll.scrollTop = pan.st - (e.clientY - pan.y); });
    addEventListener('mouseup', () => { if (pan) { pan = null; this.scroll.classList.remove('panning'); } });

    this.ro = new ResizeObserver(() => {
      if (!this.doc || typeof this.zoomMode === 'number') return;
      clearTimeout(this.roT);
      this.roT = setTimeout(() => this.applyZoom(this.zoomMode, true), 60);
    });
    this.ro.observe(this.scroll);
  }

  get numPages() { return this.doc?.numPages || 0; }

  async load(path, { keepPosition = true } = {}) {
    const token = ++this.loadToken;
    let data;
    try { data = await window.api.readBinary(path); } catch (e) { this.onStatus?.('error', '无法读取 PDF'); return false; }
    if (token !== this.loadToken) return false;
    let doc;
    try {
      doc = await pdfjs.getDocument({ ...DOC_OPTS, data }).promise;
    } catch (e) {
      // PDF may still be being written; retry once.
      await new Promise((r) => setTimeout(r, 400));
      try { data = await window.api.readBinary(path); doc = await pdfjs.getDocument({ ...DOC_OPTS, data }).promise; } catch (e2) { this.onStatus?.('error', 'PDF 解析失败'); return false; }
    }
    if (token !== this.loadToken) { doc.destroy(); return false; }

    const samePath = this.path && this.path.toLowerCase() === path.toLowerCase();
    const pos = keepPosition && samePath ? this.savePosition() : null;
    const old = this.doc;
    this.doc = doc;
    this.path = path;
    this.textCache.clear();

    const sizes = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1).then((pg) => { const v = pg.getViewport({ scale: 1 }); return { page: pg, w: v.width, h: v.height }; })));
    if (token !== this.loadToken) return false;

    // Reuse existing page elements (keep old canvas until the new one is ready => no flicker)
    while (this.pages.length > sizes.length) { const p = this.pages.pop(); this.io.unobserve(p.div); p.div.remove(); }
    sizes.forEach((s, i) => {
      let p = this.pages[i];
      if (!p) {
        const div = h('div', { class: 'pdf-page', 'data-index': i });
        p = { index: i, div, canvas: null, text: null, visible: false };
        this.pages.push(p);
        this.inner.append(div);
        this.io.observe(div);
      }
      p.pdfPage = s.page;
      p.w = s.w; p.h = s.h;
      p.rendered = false;
      p.stale = true;
      p.renderTask?.cancel();
    });

    if (!samePath || typeof this.zoomMode !== 'number') this.applyZoom(samePath ? this.zoomMode : this.zoomMode, false);
    else this.layout();
    if (pos) this.restorePosition(pos);
    else if (!samePath) this.scroll.scrollTop = 0;
    for (const p of this.pages) if (p.visible) this.queue(p);
    this.updateCurrentPage();
    setTimeout(() => { try { old?.destroy(); } catch {} }, 1500);
    if (this.search.query) this.find(this.search.query, { keepIndex: true });
    return true;
  }

  close() {
    this.loadToken++;
    for (const p of this.pages) { this.io.unobserve(p.div); p.div.remove(); }
    this.pages = [];
    try { this.doc?.destroy(); } catch {}
    this.doc = null;
    this.path = null;
  }

  savePosition() {
    const st = this.scroll.scrollTop;
    for (const p of this.pages) {
      const top = p.div.offsetTop;
      const hgt = p.div.offsetHeight;
      if (top + hgt + GAP > st) return { index: p.index, frac: (st - top) / Math.max(1, hgt), left: this.scroll.scrollLeft };
    }
    return null;
  }
  restorePosition(pos) {
    const p = this.pages[Math.min(pos.index, this.pages.length - 1)];
    if (!p) return;
    this.scroll.scrollTop = p.div.offsetTop + pos.frac * p.div.offsetHeight;
    this.scroll.scrollLeft = pos.left;
  }

  fitScale(mode) {
    if (!this.pages.length) return 1;
    const cw = this.scroll.clientWidth - 40;
    const ch = this.scroll.clientHeight - 28;
    const maxW = Math.max(...this.pages.slice(0, 5).map((p) => p.w));
    const p0 = this.pages[Math.min(this.currentPage || 0, this.pages.length - 1)];
    if (mode === 'page') return Math.max(0.1, Math.min(cw / p0.w, ch / p0.h));
    return Math.max(0.1, cw / maxW);
  }

  applyZoom(mode, keep = true) {
    const pos = keep ? this.savePosition() : null;
    this.zoomMode = mode;
    this.scale = typeof mode === 'number' ? mode : this.fitScale(mode);
    this.layout();
    if (pos) this.restorePosition(pos);
    this.onZoomChange?.(this.scale, this.zoomMode);
  }

  zoomAt(scale, cx, cy) {
    scale = Math.max(0.2, Math.min(6, scale));
    const r = this.scroll.getBoundingClientRect();
    const ox = cx - r.left + this.scroll.scrollLeft;
    const oy = cy - r.top + this.scroll.scrollTop;
    const ratio = scale / this.scale;
    this.zoomMode = scale;
    this.scale = scale;
    this.layout();
    this.scroll.scrollLeft = ox * ratio - (cx - r.left);
    this.scroll.scrollTop = oy * ratio - (cy - r.top);
    this.onZoomChange?.(this.scale, this.zoomMode);
  }

  zoomBy(f) {
    const r = this.scroll.getBoundingClientRect();
    this.zoomAt(this.scale * f, r.left + r.width / 2, r.top + r.height / 2);
  }

  layout() {
    for (const p of this.pages) {
      const w = Math.floor(p.w * this.scale), hh = Math.floor(p.h * this.scale);
      p.div.style.width = w + 'px';
      p.div.style.height = hh + 'px';
      p.div.style.setProperty('--total-scale-factor', this.scale);
      p.div.style.setProperty('--scale-factor', this.scale);
      p.div.style.setProperty('--scale-round-x', '1px');
      p.div.style.setProperty('--scale-round-y', '1px');
      if (p.renderedScale !== this.scale) { p.rendered = false; if (p.visible) this.queue(p); }
    }
  }

  queue(p) {
    if (p.rendered || p.rendering) return;
    this.renderQueue.add(p);
    if (!this.pumping) this.pump();
  }

  async pump() {
    this.pumping = true;
    // Always render the queued page closest to the current viewport next.
    while (this.renderQueue.size) {
      for (const p of this.renderQueue) if (!p.visible || p.rendered) this.renderQueue.delete(p);
      if (!this.renderQueue.size) break;
      const center = this.scroll.scrollTop + this.scroll.clientHeight / 2;
      let best = null, bestD = Infinity;
      for (const p of this.renderQueue) {
        const d = Math.abs(p.div.offsetTop + p.div.offsetHeight / 2 - center);
        if (d < bestD) { bestD = d; best = p; }
      }
      this.renderQueue.delete(best);
      await this.renderPage(best);
    }
    this.pumping = false;
    this.evict();
  }

  async renderPage(p) {
    const scale = this.scale;
    const token = this.loadToken;
    p.rendering = true;
    try {
      const dpr = window.devicePixelRatio || 1;
      const viewport = p.pdfPage.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-canvas';
      const outW = Math.floor(viewport.width * dpr), outH = Math.floor(viewport.height * dpr);
      // Cap canvas size to keep memory sane at high zoom.
      const cap = Math.min(1, Math.sqrt(16777216 / (outW * outH)));
      canvas.width = Math.floor(outW * cap);
      canvas.height = Math.floor(outH * cap);
      canvas.style.width = Math.floor(viewport.width) + 'px';
      canvas.style.height = Math.floor(viewport.height) + 'px';
      const ctx = canvas.getContext('2d', { alpha: false });
      const task = p.pdfPage.render({ canvasContext: ctx, canvas, viewport, transform: [dpr * cap, 0, 0, dpr * cap, 0, 0], background: 'white' });
      p.renderTask = task;
      await task.promise;
      if (token !== this.loadToken || scale !== this.scale) { p.rendering = false; return; }
      // Text layer for selection & search
      const textDiv = h('div', { class: 'textLayer' });
      try {
        const tl = new pdfjs.TextLayer({ textContentSource: p.pdfPage.streamTextContent({ includeMarkedContent: true, disableNormalization: true }), container: textDiv, viewport });
        await tl.render();
        p.textDivs = tl.textDivs;
      } catch { p.textDivs = []; }
      if (token !== this.loadToken || scale !== this.scale) { p.rendering = false; return; }
      p.canvas?.remove();
      p.text?.remove();
      p.div.prepend(canvas);
      canvas.after(textDiv);
      p.canvas = canvas;
      p.text = textDiv;
      p.rendered = true;
      p.stale = false;
      p.renderedScale = scale;
      if (this.search.query) this.paintSearch(p);
    } catch (e) {
      if (e?.name !== 'RenderingCancelledException') console.warn('render failed', e);
    }
    p.rendering = false;
  }

  evict() {
    // Free canvases of pages far away from the viewport
    const st = this.scroll.scrollTop, vh = this.scroll.clientHeight;
    for (const p of this.pages) {
      if (!p.canvas) continue;
      const top = p.div.offsetTop;
      if (top + p.div.offsetHeight < st - vh * 4 || top > st + vh * 5) {
        p.canvas.width = 0; p.canvas.height = 0; p.canvas.remove(); p.canvas = null;
        p.text?.remove(); p.text = null;
        p.rendered = false; p.renderedScale = null;
      }
    }
  }

  updateCurrentPage() {
    const st = this.scroll.scrollTop + this.scroll.clientHeight * 0.35;
    let cur = 0;
    for (const p of this.pages) { if (p.div.offsetTop <= st) cur = p.index; else break; }
    if (cur !== this.currentPage) { this.currentPage = cur; this.onPageChange?.(cur + 1, this.pages.length); }
    clearTimeout(this.evictT);
    this.evictT = setTimeout(() => this.evict(), 400);
  }

  goToPage(n) {
    const p = this.pages[Math.max(0, Math.min(this.pages.length - 1, n - 1))];
    if (p) this.scroll.scrollTo({ top: p.div.offsetTop - 10, behavior: 'auto' });
  }

  // Show SyncTeX result boxes and scroll them into view.
  showSync(result) {
    if (!result) return;
    const p = this.pages[result.page - 1];
    if (!p) return;
    p.div.querySelectorAll('.sync-mark').forEach((e) => e.remove());
    const boxes = result.boxes?.length ? result.boxes : [{ h: result.x, v: result.y, W: 0, H: 0 }];
    let minTop = Infinity, maxBottom = -Infinity, minLeft = Infinity;
    for (const b of boxes.slice(0, 12)) {
      const W = b.W > 0 ? b.W : p.w * 0.6;
      const H = b.H > 0 ? b.H : 12;
      const left = (b.W > 0 ? b.h : Math.max(0, b.h - 10)) * this.scale;
      const top = (b.v - H) * this.scale;
      const el = h('div', { class: 'sync-mark', style: { left: left - 3 + 'px', top: top - 3 + 'px', width: W * this.scale + 6 + 'px', height: H * this.scale + 6 + 'px' } });
      p.div.append(el);
      minTop = Math.min(minTop, top); maxBottom = Math.max(maxBottom, top + H * this.scale); minLeft = Math.min(minLeft, left);
      setTimeout(() => el.classList.add('fade'), 1600);
      setTimeout(() => el.remove(), 2600);
    }
    const target = p.div.offsetTop + (minTop + maxBottom) / 2 - this.scroll.clientHeight / 2;
    const viewTop = this.scroll.scrollTop, viewBottom = viewTop + this.scroll.clientHeight;
    const absTop = p.div.offsetTop + minTop, absBottom = p.div.offsetTop + maxBottom;
    if (absTop < viewTop + 40 || absBottom > viewBottom - 40) {
      const far = Math.abs(target - viewTop) > this.scroll.clientHeight * 2.5;
      this.scroll.scrollTo({ top: target, behavior: far ? 'auto' : 'smooth' });
    }
    const absLeft = p.div.offsetLeft + minLeft;
    if (absLeft < this.scroll.scrollLeft || absLeft > this.scroll.scrollLeft + this.scroll.clientWidth - 60) this.scroll.scrollLeft = absLeft - 40;
  }

  flashPoint(p, x, y) {
    const el = h('div', { class: 'sync-dot', style: { left: x + 'px', top: y + 'px' } });
    p.div.append(el);
    setTimeout(() => el.remove(), 700);
  }

  // ---------- search ----------
  async pageText(i) {
    if (this.textCache.has(i)) return this.textCache.get(i);
    const tc = await this.pages[i].pdfPage.getTextContent({ disableNormalization: true });
    const items = tc.items.filter((it) => 'str' in it);
    let text = '';
    const map = [];
    for (let k = 0; k < items.length; k++) {
      map.push({ start: text.length, item: k });
      text += items[k].str + (items[k].hasEOL ? '\n' : '');
    }
    const r = { text, map, count: items.length };
    this.textCache.set(i, r);
    return r;
  }

  async find(query, { backwards = false, keepIndex = false } = {}) {
    if (!this.doc) return { total: 0, index: -1 };
    if (query !== this.search.query || keepIndex) {
      const q = query.toLowerCase();
      const hits = [];
      if (q) {
        for (let i = 0; i < this.pages.length; i++) {
          const { text } = await this.pageText(i);
          const t = text.toLowerCase();
          let idx = t.indexOf(q);
          while (idx >= 0) { hits.push({ page: i, start: idx, end: idx + q.length }); idx = t.indexOf(q, idx + 1); }
        }
      }
      const prevIdx = this.search.index;
      this.search = { query, hits, index: hits.length ? (keepIndex ? Math.min(Math.max(prevIdx, 0), hits.length - 1) : this.firstHitFromCurrent(hits)) : -1 };
      if (!keepIndex) this.revealHit();
    } else if (this.search.hits.length) {
      const n = this.search.hits.length;
      this.search.index = (this.search.index + (backwards ? -1 : 1) + n) % n;
      this.revealHit();
    }
    for (const p of this.pages) if (p.rendered) this.paintSearch(p);
    return { total: this.search.hits.length, index: this.search.index };
  }

  firstHitFromCurrent(hits) {
    const cur = this.currentPage || 0;
    const i = hits.findIndex((x) => x.page >= cur);
    return i < 0 ? 0 : i;
  }

  revealHit() {
    const hit = this.search.hits[this.search.index];
    if (!hit) return;
    const p = this.pages[hit.page];
    const pageTop = p.div.offsetTop;
    if (pageTop > this.scroll.scrollTop + this.scroll.clientHeight - 60 || pageTop + p.div.offsetHeight < this.scroll.scrollTop + 60) this.scroll.scrollTop = pageTop - 20;
    setTimeout(() => {
      const el = p.div.querySelector('.textLayer .hit.current');
      if (el) {
        const r = el.getBoundingClientRect(), sr = this.scroll.getBoundingClientRect();
        if (r.top < sr.top + 40 || r.bottom > sr.bottom - 40) this.scroll.scrollTop += r.top - sr.top - sr.height / 3;
      }
    }, 120);
  }

  async paintSearch(p) {
    if (!p.text) return;
    p.text.querySelectorAll('.hit').forEach((e) => e.classList.remove('hit', 'current'));
    if (!this.search.query) return;
    const hits = this.search.hits.filter((x) => x.page === p.index);
    if (!hits.length) return;
    const { map } = await this.pageText(p.index);
    const spans = p.textDivs || [];
    const cur = this.search.hits[this.search.index];
    for (const hit of hits) {
      for (let k = 0; k < map.length; k++) {
        const s = map[k].start, e = k + 1 < map.length ? map[k + 1].start : Infinity;
        if (e > hit.start && s < hit.end) {
          const span = spans[map[k].item];
          if (span) { span.classList.add('hit'); if (hit === cur) span.classList.add('current'); }
        }
      }
    }
  }

  clearSearch() {
    this.search = { query: '', hits: [], index: -1 };
    for (const p of this.pages) p.text?.querySelectorAll('.hit').forEach((e) => e.classList.remove('hit', 'current'));
  }
}

// Render first page of a PDF (e.g. an included figure) into a small canvas.
export async function renderPdfThumb(path, width = 300) {
  try {
    const data = await window.api.readBinary(path);
    const doc = await pdfjs.getDocument({ ...DOC_OPTS, data }).promise;
    const page = await doc.getPage(1);
    const v1 = page.getViewport({ scale: 1 });
    const scale = width / v1.width;
    const dpr = window.devicePixelRatio || 1;
    const v = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.floor(v.width * dpr); c.height = Math.floor(v.height * dpr);
    c.style.width = Math.floor(v.width) + 'px'; c.style.height = Math.floor(v.height) + 'px';
    await page.render({ canvasContext: c.getContext('2d'), canvas: c, viewport: v, transform: [dpr, 0, 0, dpr, 0, 0] }).promise;
    doc.destroy();
    return c;
  } catch { return null; }
}
