// Version control dock at the bottom of the sidebar: changes, commit, sync with GitHub, version tree.
import { app, on, projectDir, openFile, saveAll, saveSessionSoon, refreshProjectFiles } from './app.js';
import { h, basename, debounce } from './util.js';
import { icon } from './icons.js';
import { iconButton, showMenu, confirmDialog, promptDialog, modal, toast, makeSplitter } from './ui.js';

const api = window.api;
const git = api.git;

const CODE_LABEL = { M: '修改', A: '新增', D: '删除', R: '重命名', C: '复制', '?': '新文件', U: '冲突', T: '类型变化' };

export function mountVersionDock(sidebar) {
  defaults(app.layout);

  const split = h('div', { class: 'splitter sy vc-split' });
  const bar = h('div', { class: 'vc-bar' });
  const body = h('div', { class: 'vc-body' });
  const dock = h('div', { class: 'vc-dock' }, split, bar, body);
  sidebar.append(dock);

  let st = null;          // last status
  let hist = null;        // last log
  let busy = '';          // '', 'commit', 'sync', …
  let dir = null;

  // ---------------- bar ----------------
  function renderBar() {
    const chev = icon('chevron-up', 14, 2);
    chev.classList.add('vc-chev');
    if (!dir) { bar.replaceChildren(icon('git-branch', 15), h('span', { class: 'vc-branch muted' }, '版本管理'), h('span', { class: 'vc-flex' }), h('span', { class: 'vc-hint' }, '打开项目后可用')); return; }
    if (!st || !st.repo) {
      bar.replaceChildren(icon('git-branch', 15), h('span', { class: 'vc-branch muted' }, st?.gitMissing ? '未安装 Git' : '未启用版本管理'), h('span', { class: 'vc-flex' }), chev);
      return;
    }
    const n = st.files.length;
    const syncBtn = h('button', {
      class: `vc-sync ${busy === 'sync' ? 'spinning' : ''}`,
      'data-tip': !st.remoteUrl ? '发布到 GitHub' : st.ahead || st.behind ? `与 GitHub 同步（上传 ${st.ahead}，下载 ${st.behind}）` : '与 GitHub 同步',
      onclick: (e) => { e.stopPropagation(); sync(); },
    }, icon(st.remoteUrl ? 'refresh' : 'cloud-upload', 14, 2),
      st.remoteUrl && (st.ahead || st.behind) ? h('span', { class: 'vc-ab tabular' }, st.behind ? `↓${st.behind}` : '', st.ahead ? `↑${st.ahead}` : '') : null);
    bar.replaceChildren(...[
      icon('git-branch', 15),
      h('span', { class: 'vc-branch', title: st.root }, st.detached ? '游离 HEAD' : st.branch || 'main'),
      st.state ? h('span', { class: 'vc-pill warn' }, st.state === 'rebase' ? '变基中' : '合并中') : null,
      n ? h('span', { class: 'vc-pill', 'data-tip': `${n} 个文件有未提交的修改` }, String(n)) : null,
      h('span', { class: 'vc-flex' }),
      syncBtn,
      chev,
    ].filter(Boolean));
  }
  bar.addEventListener('click', () => setOpen(!app.layout.vcOpen));

  function setOpen(open) {
    app.layout.vcOpen = open;
    dock.classList.toggle('open', open);
    body.style.height = open ? app.layout.vcHeight + 'px' : '';
    saveSessionSoon();
    if (open) refresh({ withLog: true });
  }

  let start;
  makeSplitter(split, { axis: 'y', onMove: (dy) => {
    start ??= app.layout.vcHeight;
    const max = Math.max(160, sidebar.clientHeight - 170);
    app.layout.vcHeight = Math.max(150, Math.min(max, start - dy));
    body.style.height = app.layout.vcHeight + 'px';
  }, onEnd: () => { start = null; saveSessionSoon(); } });

  // ---------------- body ----------------
  const seg = h('div', { class: 'seg seg-sm vc-seg' });
  const changesBtn = h('button', { 'data-k': 'changes', onclick: () => show('changes') }, '更改');
  const histBtn = h('button', { 'data-k': 'history', onclick: () => show('history') }, '版本树');
  seg.append(changesBtn, histBtn);
  const viewHost = h('div', { class: 'vc-view' });
  const head = h('div', { class: 'vc-head' }, seg, h('span', { class: 'vc-flex' }),
    iconButton('refresh', '刷新', () => refresh({ withLog: true, fetch: true }), { cls: 'icon-btn-sm', size: 14 }),
    iconButton('external', '在 GitHub 上打开', () => st?.webUrl ? api.openUrl(st.webUrl) : toast('还没有连接 GitHub'), { cls: 'icon-btn-sm', size: 14 }));

  const msg = h('textarea', { class: 'input vc-msg', rows: 2, placeholder: '这次改了什么？（Ctrl+Enter 提交）', spellcheck: 'false' });
  msg.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit({ andSync: e.shiftKey }); } e.stopPropagation(); });
  const commitBtn = h('button', { class: 'btn btn-primary btn-sm', onclick: () => commit() }, icon('check', 13, 2.2), '提交');
  const commitSyncBtn = h('button', { class: 'btn btn-sm', 'data-tip': '提交后上传到 GitHub', onclick: () => commit({ andSync: true }) }, icon('cloud-upload', 13, 2), '提交并同步');
  const composer = h('div', { class: 'vc-composer' }, msg, h('div', { class: 'vc-actions' }, commitBtn, commitSyncBtn));
  const fileList = h('div', { class: 'vc-files' });
  const remoteNote = h('div', { class: 'vc-note' });
  const changesView = h('div', { class: 'vc-pane' }, remoteNote, composer, fileList);
  const histList = h('div', { class: 'vc-history' });
  const historyView = h('div', { class: 'vc-pane' }, histList);
  const setupView = h('div', { class: 'vc-pane vc-setup' });
  viewHost.append(changesView, historyView, setupView);
  body.append(head, viewHost);

  function show(k) {
    app.layout.vcView = k;
    changesBtn.classList.toggle('active', k === 'changes');
    histBtn.classList.toggle('active', k === 'history');
    renderBody();
    if (k === 'history') loadLog();
    saveSessionSoon();
  }

  function renderBody() {
    const repo = st?.repo;
    head.hidden = !repo;
    setupView.hidden = !!repo;
    changesView.hidden = !repo || app.layout.vcView !== 'changes';
    historyView.hidden = !repo || app.layout.vcView !== 'history';
    if (!repo) return renderSetup();
    const n = st.files.length;
    changesBtn.replaceChildren('更改', n ? h('span', { class: 'seg-count' }, String(n)) : '');
    renderRemoteNote();
    renderFiles();
    commitBtn.disabled = commitSyncBtn.disabled = !!busy;
  }

  function renderSetup() {
    if (!dir) { setupView.replaceChildren(h('div', { class: 'vc-empty' }, '先打开一个项目文件夹或 .tex 文件。')); return; }
    if (st?.gitMissing) {
      setupView.replaceChildren(h('div', { class: 'vc-empty' }, h('div', { class: 'vc-empty-title' }, '没有找到 Git'), '版本管理需要先安装 Git for Windows。'),
        h('button', { class: 'btn btn-sm', onclick: () => api.openUrl('https://git-scm.com/download/win') }, icon('download', 13, 2), '下载 Git'));
      return;
    }
    setupView.replaceChildren(
      h('div', { class: 'vc-empty' },
        h('div', { class: 'vc-empty-ico' }, icon('git-graph', 26, 1.6)),
        h('div', { class: 'vc-empty-title' }, '这个项目还没有版本管理'),
        '启用后，每次"提交"都会保存一个可回溯的版本，也可以同步到 GitHub 备份。'),
      h('button', { class: 'btn btn-primary btn-sm', onclick: initRepo }, icon('git-branch', 13, 2), '启用版本管理'),
      h('div', { class: 'vc-dir muted', title: dir }, dir),
    );
  }

  function renderRemoteNote() {
    remoteNote.replaceChildren();
    remoteNote.hidden = true;
    if (st.state) {
      remoteNote.hidden = false;
      remoteNote.className = 'vc-note warn';
      remoteNote.append(icon('warning', 14), h('span', {}, st.state === 'rebase' ? '仓库正处于变基中，请先在终端处理完再提交。' : '仓库正处于合并中，解决冲突后再提交。'));
      return;
    }
    if (!st.remoteUrl) {
      remoteNote.hidden = false;
      remoteNote.className = 'vc-note';
      remoteNote.append(icon('cloud-off', 14), h('span', { class: 'vc-flex' }, '还没有连接 GitHub'), h('button', { class: 'chip chip-xs', onclick: publishDialog }, '连接'));
    }
  }

  function renderFiles() {
    fileList.replaceChildren();
    if (!st.files.length) {
      fileList.append(h('div', { class: 'vc-clean' }, icon('check', 14, 2.2), st.noCommits ? '还没有文件' : '所有修改都已提交'));
      return;
    }
    for (const f of st.files) {
      const row = h('div', { class: 'vc-file', title: f.rel },
        h('span', { class: `vc-code c-${f.code === '?' ? 'n' : f.code}`, 'data-tip': CODE_LABEL[f.code] || f.code }, f.code === '?' ? 'N' : f.code),
        h('span', { class: 'vc-fname' }, basename(f.rel)),
        h('span', { class: 'vc-fdir' }, relDir(f.rel)),
      );
      row.addEventListener('click', () => diffDialog({ rel: f.rel, path: f.path, code: f.code }));
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showMenu([
          f.code !== 'D' ? { label: '打开文件', icon: 'file', run: () => openPath(f.path) } : null,
          { label: '查看改动', icon: 'git-compare', run: () => diffDialog({ rel: f.rel, path: f.path, code: f.code }) },
          { sep: true },
          { label: f.code === '?' ? '删除这个新文件' : '放弃修改', icon: 'undo', run: () => discard(f) },
          { sep: true },
          { label: '在资源管理器中显示', icon: 'folder-open', run: () => api.reveal(f.path) },
        ], e.clientX, e.clientY);
      });
      fileList.append(row);
    }
  }

  // ---------------- history / version tree ----------------
  async function loadLog() {
    if (!st?.repo) return;
    const r = await git.log(st.root, 400);
    hist = r;
    renderHistory();
  }

  function renderHistory() {
    histList.replaceChildren();
    const commits = hist?.commits || [];
    if (!commits.length) { histList.append(h('div', { class: 'vc-clean' }, hist?.error || '还没有提交过版本')); return; }
    const rows = layoutGraph(commits);
    const lanes = Math.min(6, Math.max(1, ...rows.map((r) => Math.max(r.before.length, r.after.length, r.col + 1))));
    const unpushed = new Set(hist.unpushed || []);
    for (const r of rows) {
      const c = r.commit;
      const row = h('div', { class: 'vc-commit' },
        graphCell(r, lanes, unpushed.has(c.hash)),
        h('div', { class: 'vc-cmain' },
          h('div', { class: 'vc-csubj' }, ...refBadges(c.refs, st.branch), h('span', { class: 'vc-ctext' }, c.subject)),
          h('div', { class: 'vc-cmeta' }, `${c.author} · ${relTime(c.time)}`, unpushed.has(c.hash) ? h('span', { class: 'vc-local' }, ' · 未同步') : ''),
        ),
      );
      row.title = `${c.subject}\n${c.hash.slice(0, 8)} · ${new Date(c.time).toLocaleString()}`;
      row.addEventListener('click', () => commitDialog(c));
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showMenu([
          { label: '查看这个版本的改动', icon: 'git-compare', run: () => commitDialog(c) },
          { label: '复制版本号', icon: 'copy', run: () => { api.clipboardWrite(c.hash); toast('已复制 ' + c.hash.slice(0, 8)); } },
          st.webUrl ? { label: '在 GitHub 上查看', icon: 'external', run: () => api.openUrl(`${st.webUrl}/commit/${c.hash}`) } : null,
        ], e.clientX, e.clientY);
      });
      histList.append(row);
    }
  }

  // ---------------- actions ----------------
  async function initRepo() {
    const r = await git.init(dir);
    if (!r.ok) return toast(r.error, 'error', 4000);
    toast('已启用版本管理：写好说明后点"提交"保存第一个版本', 'success', 3600);
    app.layout.vcView = 'changes';
    await refresh({ withLog: true });
    refreshProjectFiles();
  }

  async function commit({ andSync = false } = {}) {
    if (busy || !st?.repo) return;
    if (!(await saveAll({ silentUntitled: true }))) return;
    await refresh();
    if (!st.files.length) { if (andSync) return sync(); return toast('没有需要提交的修改'); }
    const text = msg.value.trim() || defaultMessage(st.files);
    busy = 'commit';
    renderBody();
    let r = await git.commit(st.root, text);
    if (!r.ok && r.error === 'IDENTITY' && (await askIdentity())) r = await git.commit(st.root, text);
    busy = '';
    if (!r.ok) { await refresh(); return toast(r.error === 'IDENTITY' ? '提交需要先设置姓名和邮箱' : r.error, 'error', 4200); }
    msg.value = '';
    toast(`已提交：${text.split('\n')[0].slice(0, 40)}`, 'success');
    await refresh({ withLog: true });
    if (andSync) await sync();
  }

  async function sync() {
    if (busy || !st?.repo) return;
    if (!st.remoteUrl) return publishDialog();
    if (st.noCommits) return toast('请先提交一个版本');
    busy = 'sync';
    renderBar(); renderBody();
    const r = await git.sync(st.root);
    busy = '';
    if (!r.ok) {
      await refresh({ withLog: true });
      if (r.error === 'NO_REMOTE') return publishDialog();
      return confirmDialog({ title: '同步失败', message: r.error + (/同一处/.test(r.error) ? '\n\n本地内容没有丢失。可以在终端里用 git pull 手动合并，或先把 GitHub 上的修改合并后再同步。' : ''), ok: '好', cancel: '关闭' });
    }
    const parts = [];
    if (r.pulled) parts.push(`下载 ${r.pulled} 个版本`);
    if (r.pushed) parts.push(r.first ? '已上传到 GitHub' : `上传 ${r.pushed} 个版本`);
    toast(parts.length ? '同步完成：' + parts.join('，') : '已经是最新的', 'success');
    await refresh({ withLog: true });
  }

  async function discard(f) {
    const ok = await confirmDialog({
      title: f.code === '?' ? `删除 ${basename(f.rel)}？` : `放弃对 ${basename(f.rel)} 的修改？`,
      message: f.code === '?' ? '这个文件还没有提交过，会被移到回收站。' : '文件会恢复成上一次提交时的样子，未提交的修改将丢失。',
      ok: f.code === '?' ? '移到回收站' : '放弃修改', danger: true,
    });
    if (!ok) return;
    const r = await git.discard(st.root, f.rel, f.code);
    if (!r.ok) return toast(r.error, 'error');
    await refresh();
    refreshProjectFiles();
  }

  async function askIdentity() {
    const name = await promptDialog({ title: '设置提交者姓名', label: '会显示在每个版本上（只需设置一次）', placeholder: '例如 Zhang San' });
    if (!name) return false;
    const email = await promptDialog({ title: '设置提交者邮箱', label: '建议使用 GitHub 账号的邮箱', placeholder: 'name@example.com', validate: (v) => (/.+@.+/.test(v) ? '' : '请输入邮箱') });
    if (!email) return false;
    const r = await git.setIdentity(name.trim(), email.trim());
    if (!r.ok) toast(r.error, 'error');
    return r.ok;
  }

  function publishDialog() {
    const guess = (basename(st.root).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'latex-paper').slice(0, 80);
    const name = h('input', { class: 'input', value: guess, spellcheck: 'false' });
    const priv = h('input', { type: 'checkbox', checked: true });
    const url = h('input', { class: 'input', placeholder: 'https://github.com/用户名/仓库名.git', spellcheck: 'false' });
    const err = h('div', { class: 'form-error' });
    const pubBtn = h('button', { class: 'btn btn-primary' }, '创建并上传');
    let m;
    const body = h('div', { class: 'form vc-publish' },
      h('div', { class: 'muted' }, '在 GitHub 上新建一个仓库，并把现在的所有版本上传上去。'),
      h('div', { class: 'form-row' }, h('label', { class: 'form-label' }, '仓库名'), name),
      h('label', { class: 'form-check' }, priv, h('span', {}, '私有仓库（只有你能看到）')),
      h('div', { class: 'vc-or' }, h('span', {}, '或者连接已有的仓库')),
      h('div', { class: 'form-row' }, h('label', { class: 'form-label' }, '仓库地址'), url),
      err,
    );
    pubBtn.addEventListener('click', async () => {
      err.textContent = '';
      pubBtn.disabled = true;
      pubBtn.replaceChildren(h('span', { class: 'btn-spinner' }), url.value.trim() ? '正在连接…' : '正在创建…');
      let r;
      if (url.value.trim()) {
        r = await git.setRemote(st.root, url.value.trim());
        if (r.ok) { m.close(); await refresh(); return sync(); }
      } else {
        if (st.noCommits || st.files.length) {
          if (!(await saveAll({ silentUntitled: true }))) { pubBtn.disabled = false; pubBtn.replaceChildren('创建并上传'); return; }
          await refresh();
          if (st.files.length) {
            let c = await git.commit(st.root, msg.value.trim() || (st.noCommits ? '第一个版本' : defaultMessage(st.files)));
            if (!c.ok && c.error === 'IDENTITY' && (await askIdentity())) c = await git.commit(st.root, msg.value.trim() || '第一个版本');
            if (!c.ok && c.error !== '没有需要提交的修改') { r = c; }
            else msg.value = '';
          }
        }
        if (!r) r = await git.publish(st.root, name.value.trim(), priv.checked);
        if (r.ok) { m.close(); toast('已上传到 GitHub', 'success'); await refresh({ withLog: true }); return; }
      }
      err.textContent = r.error === 'IDENTITY' ? '提交需要先设置姓名和邮箱' : r.error;
      pubBtn.disabled = false;
      pubBtn.replaceChildren('创建并上传');
    });
    url.addEventListener('input', () => { pubBtn.textContent = url.value.trim() ? '连接并同步' : '创建并上传'; });
    m = modal({ title: '连接 GitHub', body, width: 460, footer: [h('button', { class: 'btn', onclick: () => m.close() }, '取消'), pubBtn] });
  }

  // ---------------- dialogs ----------------
  async function diffDialog({ rel, path, code, hash }) {
    const pre = h('div', { class: 'vc-diff' }, h('div', { class: 'muted vc-diff-loading' }, '正在读取…'));
    const footer = [];
    let m;
    if (!hash && code !== 'D') footer.push(h('button', { class: 'btn', onclick: () => { m.close(); openPath(path); } }, '打开文件'));
    footer.push(h('button', { class: 'btn btn-primary', onclick: () => m.close() }, '关闭'));
    m = modal({ title: basename(rel), body: pre, footer, width: 820, className: 'vc-diff-modal' });
    const r = await git.diff(st.root, rel, hash);
    pre.replaceChildren(...renderDiff(r));
  }

  async function commitDialog(c) {
    const r = await git.show(st.root, c.hash);
    if (!r.ok) return toast(r.error, 'error');
    const diffBox = h('div', { class: 'vc-diff' }, h('div', { class: 'muted vc-diff-loading' }, '选择一个文件查看改动'));
    const files = h('div', { class: 'vc-cfiles' });
    let current = null;
    const pick = async (f, row) => {
      files.querySelectorAll('.vc-file').forEach((x) => x.classList.toggle('active', x === row));
      current = f;
      diffBox.replaceChildren(h('div', { class: 'muted vc-diff-loading' }, '正在读取…'));
      const d = await git.diff(st.root, f.rel, c.hash);
      if (current === f) diffBox.replaceChildren(...renderDiff(d));
    };
    for (const f of r.files) {
      const row = h('div', { class: 'vc-file' },
        h('span', { class: `vc-code c-${f.code}` }, f.code),
        h('span', { class: 'vc-fname' }, basename(f.rel)),
        h('span', { class: 'vc-fdir' }, relDir(f.rel)));
      row.addEventListener('click', () => pick(f, row));
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showMenu([
          { label: '查看改动', icon: 'git-compare', run: () => pick(f, row) },
          f.code !== 'D' ? { label: '把这个文件恢复到这个版本', icon: 'undo', run: () => restore(c, f) } : null,
        ], e.clientX, e.clientY);
      });
      files.append(row);
    }
    const lines = r.message.split('\n');
    const body = h('div', { class: 'vc-cdetail' },
      h('div', { class: 'vc-cinfo' },
        h('span', { class: 'vc-hash', 'data-tip': '复制版本号', onclick: () => { api.clipboardWrite(r.hash); toast('已复制'); } }, r.hash.slice(0, 8)),
        h('span', { class: 'muted' }, `${r.author} · ${new Date(r.time).toLocaleString()}`)),
      lines.length > 1 ? h('div', { class: 'vc-cbody' }, lines.slice(1).join('\n').trim()) : null,
      h('div', { class: 'vc-csplit' }, files, diffBox),
    );
    const footer = [
      st.webUrl ? h('button', { class: 'btn', onclick: () => api.openUrl(`${st.webUrl}/commit/${r.hash}`) }, icon('external', 13), '在 GitHub 查看') : null,
      h('button', { class: 'btn btn-primary', onclick: () => m.close() }, '关闭'),
    ].filter(Boolean);
    const m = modal({ title: lines[0], body, footer, width: 900, className: 'vc-diff-modal' });
    const first = files.querySelector('.vc-file');
    const firstText = r.files.findIndex((f) => /\.(tex|bib|sty|cls|txt|md|py)$/i.test(f.rel));
    if (first) pick(r.files[Math.max(0, firstText)], files.children[Math.max(0, firstText)]);
  }

  async function restore(c, f) {
    const ok = await confirmDialog({ title: `把 ${basename(f.rel)} 恢复到这个版本？`, message: `文件内容会变成版本 ${c.hash.slice(0, 8)}（${relTime(c.time)}）时的样子。\n恢复后它会出现在"更改"里，确认无误再提交；不满意可以右键"放弃修改"撤回。`, ok: '恢复' });
    if (!ok) return;
    const r = await git.restoreFile(st.root, c.hash, f.rel);
    if (!r.ok) return toast(r.error, 'error');
    toast('已恢复，记得提交', 'success');
    await refresh();
  }

  // ---------------- refresh ----------------
  let seq = 0;
  async function refresh({ withLog = false, fetch = false } = {}) {
    dir = projectDir();
    const my = ++seq;
    if (!dir) { st = null; renderBar(); renderBody(); return; }
    if (fetch) await git.fetch(dir);
    const s = await git.status(dir);
    if (my !== seq) return;
    st = s;
    renderBar();
    renderBody();
    if (st.repo && (withLog || app.layout.vcView === 'history') && app.layout.vcOpen) loadLog();
  }
  const refreshSoon = debounce(() => refresh(), 400);

  // Check GitHub for new commits now and then, without ever prompting for credentials.
  let lastFetch = 0;
  async function backgroundFetch() {
    if (!st?.repo || !st.remoteUrl || busy || Date.now() - lastFetch < 4 * 60 * 1000) return;
    lastFetch = Date.now();
    await git.fetch(st.root);
    refresh();
  }

  on('saved', refreshSoon);
  on('build-end', refreshSoon);
  on('active', debounce(() => { if (projectDir() !== dir) { lastFetch = 0; refresh({ withLog: true }).then(backgroundFetch); } }, 300));
  on('project-files', refreshSoon);
  on('file-changed', refreshSoon);
  addEventListener('focus', () => { refreshSoon(); backgroundFetch(); });
  setInterval(() => { if (document.hasFocus()) backgroundFetch(); }, 60 * 1000);

  dock.classList.toggle('open', app.layout.vcOpen);
  if (app.layout.vcOpen) body.style.height = app.layout.vcHeight + 'px';
  show(app.layout.vcView);
  refresh({ withLog: true }).then(backgroundFetch);

  app.vc = {
    open(view = 'changes') { if (!app.layout.sidebar) app.layoutApi.toggle('sidebar'); setOpen(true); show(view); if (view === 'changes') setTimeout(() => msg.focus(), 60); },
    sync,
    commit: () => app.vc.open('changes'),
    refresh,
    // Session restore replaces app.layout after mounting; re-read the dock's part of it.
    applyLayout() {
      defaults(app.layout);
      dock.classList.toggle('open', app.layout.vcOpen);
      body.style.height = app.layout.vcOpen ? app.layout.vcHeight + 'px' : '';
      changesBtn.classList.toggle('active', app.layout.vcView === 'changes');
      histBtn.classList.toggle('active', app.layout.vcView === 'history');
      renderBody();
    },
  };
}

// ---------------- helpers ----------------
function relDir(rel) {
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
}

function defaults(L) {
  L.vcOpen ??= false;
  L.vcHeight ??= 300;
  L.vcView ??= 'changes';
}

function openPath(p) {
  if (/\.pdf$/i.test(p)) app.pdf?.show(p, { reveal: true });
  else if (/\.(png|jpe?g|eps|svg|gif)$/i.test(p)) api.openExternal(p);
  else openFile(p);
}

function defaultMessage(files) {
  const names = files.map((f) => basename(f.rel));
  return names.length <= 3 ? '修改 ' + names.join('、') : `修改 ${names.slice(0, 2).join('、')} 等 ${names.length} 个文件`;
}

function relTime(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  const d = new Date(t);
  if (s < 2 * 86400) return '昨天 ' + d.toTimeString().slice(0, 5);
  if (s < 7 * 86400) return Math.floor(s / 86400) + ' 天前';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function refBadges(refs, current) {
  const out = [];
  const head = refs.find((r) => r.startsWith('HEAD -> '));
  const local = head ? head.slice(8) : null;
  if (refs.includes('HEAD')) out.push(h('span', { class: 'vc-ref head' }, 'HEAD'));
  for (const r of refs) {
    if (r === 'HEAD' || r.endsWith('/HEAD')) continue;
    if (r.startsWith('HEAD -> ')) out.push(h('span', { class: 'vc-ref head', 'data-tip': '当前所在的版本' }, local));
    else if (r.startsWith('tag: ')) out.push(h('span', { class: 'vc-ref tag' }, icon('tag', 10, 2.2), r.slice(5)));
    else if (r.startsWith('origin/')) out.push(h('span', { class: 'vc-ref remote', 'data-tip': 'GitHub 上的 ' + r.slice(7) }, icon('cloud', 10, 2.2), r.slice(7) === current ? 'GitHub' : 'GitHub/' + r.slice(7)));
    else out.push(h('span', { class: 'vc-ref' }, r));
  }
  return out;
}

function renderDiff(r) {
  if (!r.ok) return [h('div', { class: 'vc-diff-loading', style: { color: 'var(--danger)' } }, r.error)];
  if (r.binary) return [h('div', { class: 'muted vc-diff-loading' }, '二进制文件（如 PDF、图片），无法逐行对比')];
  if (!r.text.trim()) return [h('div', { class: 'muted vc-diff-loading' }, '没有文本上的改动')];
  const frag = [];
  let oldN = 0, newN = 0;
  for (const line of r.text.split('\n')) {
    if (line.startsWith('\\ No newline')) continue;
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (m) { oldN = +m[1]; newN = +m[2]; frag.push(h('div', { class: 'dl hunk' }, h('span', { class: 'ln' }), h('span', { class: 'ln' }), h('span', { class: 'tx' }, line.replace(/^@@.*?@@ ?/, '⋯ ') || '⋯'))); continue; }
    if (line.startsWith('@@')) { frag.push(h('div', { class: 'dl hunk' }, h('span', { class: 'ln' }), h('span', { class: 'ln' }), h('span', { class: 'tx' }, '新文件'))); newN = 1; continue; }
    const k = line[0];
    if (k === '+') frag.push(h('div', { class: 'dl add' }, h('span', { class: 'ln' }), h('span', { class: 'ln' }, String(newN++)), h('span', { class: 'tx' }, line.slice(1))));
    else if (k === '-') frag.push(h('div', { class: 'dl del' }, h('span', { class: 'ln' }, String(oldN++)), h('span', { class: 'ln' }), h('span', { class: 'tx' }, line.slice(1))));
    else frag.push(h('div', { class: 'dl' }, h('span', { class: 'ln' }, String(oldN++)), h('span', { class: 'ln' }, String(newN++)), h('span', { class: 'tx' }, line.slice(1))));
  }
  return frag;
}

// Lane layout for the version tree (like `git log --graph`): each row knows the lanes above and below it.
export function layoutGraph(commits) {
  let lanes = [];
  const rows = [];
  for (const c of commits) {
    let col = lanes.indexOf(c.hash);
    if (col < 0) { col = lanes.indexOf(null); if (col < 0) col = lanes.length; lanes[col] = c.hash; }
    const before = lanes.slice();
    const after = lanes.map((x) => (x === c.hash ? null : x));
    c.parents.forEach((p, i) => {
      if (after.includes(p)) return;
      if (i === 0) after[col] = p;
      else { const free = after.indexOf(null); if (free >= 0) after[free] = p; else after.push(p); }
    });
    while (after.length && after[after.length - 1] == null) after.pop();
    rows.push({ commit: c, col, before, after });
    lanes = after;
  }
  return rows;
}

const LANE_W = 12, ROW_H = 44, NODE_Y = 15;
function graphCell(r, lanes, hollow) {
  const W = lanes * LANE_W + 6;
  const x = (i) => 9 + Math.min(i, lanes - 1) * LANE_W;
  const cls = (i) => (i === 0 ? 'g0' : 'g1');
  const curve = (x1, y1, x2, y2) => (x1 === x2 ? `M${x1} ${y1}L${x2} ${y2}` : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`);
  const paths = [];
  r.before.forEach((hsh, i) => {
    if (hsh == null) return;
    if (hsh === r.commit.hash) paths.push([curve(x(i), 0, x(r.col), NODE_Y), cls(i)]);
    else { const j = r.after.indexOf(hsh); if (j >= 0) paths.push([curve(x(i), 0, x(j), ROW_H), cls(Math.max(i, j))]); }
  });
  r.commit.parents.forEach((p) => { const j = r.after.indexOf(p); if (j >= 0) paths.push([curve(x(r.col), NODE_Y, x(j), ROW_H), cls(Math.max(j, r.col))]); });
  const svg = `<svg width="${W}" height="${ROW_H}" viewBox="0 0 ${W} ${ROW_H}">${paths.map(([d, c]) => `<path d="${d}" class="${c}"/>`).join('')}<circle cx="${x(r.col)}" cy="${NODE_Y}" r="4" class="node ${r.col === 0 ? 'g0' : 'g1'} ${hollow ? 'hollow' : ''}"/></svg>`;
  const el = h('div', { class: 'vc-graph' });
  el.innerHTML = svg;
  return el;
}
