// Software updates: check GitHub Releases, ask before downloading, then restart to install.
import { app, updateSettings } from './app.js';
import { h } from './util.js';
import { icon } from './icons.js';
import { modal, toast, confirmDialog } from './ui.js';

const api = window.api;
const st = { checking: false, downloading: false, ready: null, pill: null };

export function initUpdates() {
  st.pill = h('button', { class: 'sb-item sb-btn sb-update', onclick: () => { if (st.ready) promptInstall(st.ready); } });
  st.pill.hidden = true;
  document.querySelector('.sb-right')?.prepend(st.pill);
  api.onUpdateEvent((ev) => { if (ev.type === 'progress' && st.downloading) setPill(`正在下载更新 ${Math.floor(ev.percent || 0)}%`); });
  if (app.settings.autoCheckUpdate) setTimeout(() => checkForUpdates({ silent: true }), 6000);
}

export async function checkForUpdates({ silent = false } = {}) {
  if (st.ready) return promptInstall(st.ready);
  if (st.downloading) { if (!silent) toast('正在下载更新…'); return; }
  if (st.checking) return;
  st.checking = true;
  if (!silent) toast('正在检查更新…');
  try {
    const r = await api.updateCheck();
    if (!r.supported) { if (!silent) toast('开发版本不检查更新'); return; }
    if (!r.available) { if (!silent) toast(`已是最新版本 ${r.current}`, 'success'); return; }
    if (silent && r.version === app.settings.skipVersion) return;
    promptAvailable(r);
  } catch (e) {
    if (!silent) toast('检查更新失败：' + errMsg(e), 'error', 4000);
  } finally {
    st.checking = false;
  }
}

function promptAvailable(r) {
  const notes = notesToText(r.notes);
  const date = r.releaseDate ? ` · 发布于 ${new Date(r.releaseDate).toLocaleDateString()}` : '';
  const body = h('div', { class: 'confirm update' },
    h('div', { class: 'confirm-ico' }, icon('download', 24, 1.75)),
    h('div', { class: 'confirm-title' }, `发现新版本 ${r.version}`),
    h('div', { class: 'muted small' }, `当前版本 ${r.current}${date}`),
    notes ? h('div', { class: 'update-notes' }, notes) : null,
  );
  const m = modal({ title: null, body, width: 500, footer: [
    h('button', { class: 'btn btn-text update-skip', onclick: () => { updateSettings({ skipVersion: r.version }); m.close(); } }, '跳过此版本'),
    h('button', { class: 'btn', onclick: () => m.close() }, '稍后'),
    h('button', { class: 'btn btn-primary', onclick: () => { m.close(); download(r.version); } }, '下载并更新'),
  ] });
}

async function download(version) {
  st.downloading = true;
  setPill('正在下载更新 0%');
  toast('开始在后台下载更新');
  try {
    await api.updateDownload();
    st.ready = version;
    setPill(`重启以更新到 ${version}`);
    promptInstall(version);
  } catch (e) {
    setPill(null);
    toast('下载更新失败：' + errMsg(e), 'error', 4000);
  } finally {
    st.downloading = false;
  }
}

async function promptInstall(version) {
  const ok = await confirmDialog({ title: `新版本 ${version} 已下载`, message: '重启软件即可完成更新，设置和打开的文件都会保留。\n选择“稍后”则在下次退出时自动安装。', ok: '立即重启', cancel: '稍后' });
  if (ok) app.requestClose(() => api.updateInstall());
}

function setPill(text) {
  if (!st.pill) return;
  st.pill.hidden = !text;
  st.pill.classList.toggle('ready', !!st.ready);
  st.pill.replaceChildren(icon(st.ready ? 'refresh' : 'download', 13, 2), h('span', {}, text || ''));
}

function errMsg(e) {
  const msg = String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '').split('\n')[0];
  if (/ERR_(INTERNET|NAME|CONNECTION|NETWORK|TIMED)|ENOTFOUND|ETIMEDOUT|ECONNRE/.test(msg)) return '无法连接到 GitHub，请检查网络';
  if (/latest\.yml|404/.test(msg)) return '新版本还没有可用的更新文件';
  return msg;
}

// GitHub release notes arrive as HTML; show them as plain text.
function notesToText(notes) {
  if (!notes) return '';
  if (!/<[a-z][\s\S]*>/i.test(notes)) return notes.trim();
  const doc = new DOMParser().parseFromString(notes, 'text/html');
  doc.querySelectorAll('li').forEach((li) => li.prepend('• '));
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  doc.querySelectorAll('p, li, h1, h2, h3, h4, pre, ul, ol').forEach((el) => el.append('\n'));
  return doc.body.textContent.replace(/\n{3,}/g, '\n\n').trim();
}
