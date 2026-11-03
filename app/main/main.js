const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu, clipboard } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const compiler = require('./compiler');
const synctex = require('./synctex');
const ai = require('./ai');
const updater = require('./updater');
const git = require('./git');
const { findTexBin, tool, scanCommon } = require('./texenv');

const TEXT_EXT = /\.(tex|ltx|bib|sty|cls|bst|dtx|ins|txt|md|bbx|cbx|def|cfg|clo|tikz|pgf|lco|latexmkrc|bbl|log|aux|toc|py|m|csv|dat|json|yaml|yml)$/i;
const OPENABLE = /\.(tex|ltx|bib|sty|cls|dtx|ins|txt|md|bst|bbx|cbx|cfg|def|tikz)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.idea', '.vscode', '__pycache__', '.venv', 'venv']);

if (process.env.TXS_USERDATA) app.setPath('userData', process.env.TXS_USERDATA);
const userData = app.getPath('userData');
const settingsFile = path.join(userData, 'settings.json');
const sessionFile = path.join(userData, 'session.json');

const DEFAULTS = {
  theme: 'system',
  editorBg: 'default',
  editorBgCustom: '#cce8cf',
  engine: 'pdflatex',
  buildMode: 'smart',
  bibTool: 'auto',
  shellEscape: true,
  texBin: '',
  extraArgs: '',
  fontFamily: 'Consolas',
  fontSize: 15,
  lineHeight: 1.65,
  wrap: true,
  tabSize: 2,
  lineNumbers: true,
  autoCloseBrackets: true,
  autoCloseEnv: true,
  spellcheck: true,
  mathPreview: true,
  autoCompileOnSave: false,
  liveCompile: false,
  liveDelay: 1500,
  syncAfterCompile: true,
  autosave: false,
  showLogOnError: true,
  pdfInvert: false,
  pdfZoom: 'width',
  pdfDblClick: true,
  aiModel: 'claude-opus-5-5',
  aiEffort: 'medium',
  aiBaseURL: '',
  aiKeyEnc: '',
  aiLanguage: 'auto',
  autoCheckUpdate: true,
  skipVersion: '',
  recentFiles: [],
  recentFolders: [],
  windowBounds: null,
  maximized: false,
};

function readJSON(f, fallback) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } }
function writeJSON(f, v) { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); } catch {} }

let settings = { ...DEFAULTS, ...readJSON(settingsFile, {}) };
let win = null;
let forceClose = false;
const pendingOpen = [];

const texBin = () => findTexBin(settings.texBin || null);
const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };

function filesFromArgv(argv) {
  return argv.slice(1).filter((a) => !a.startsWith('-') && OPENABLE.test(a) && fs.existsSync(a)).map((a) => path.resolve(a));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const files = filesFromArgv(argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      for (const f of files) send('app:open-file', { path: f });
    }
  });
}

function overlayColors(dark) {
  return dark ? { color: '#000000', symbolColor: '#f5f5f7', height: 48 } : { color: '#f5f5f7', symbolColor: '#1d1d1f', height: 48 };
}

function createWindow() {
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && nativeTheme.shouldUseDarkColors);
  const b = settings.windowBounds || {};
  win = new BrowserWindow({
    width: b.width || 1560,
    height: b.height || 960,
    x: b.x, y: b.y,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: dark ? '#000000' : '#f5f5f7',
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? true : overlayColors(dark),
    trafficLightPosition: { x: 16, y: 16 },
    icon: path.join(__dirname, '..', 'renderer', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
    },
  });
  if (settings.maximized) win.maximize();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  try { win.webContents.session.setSpellCheckerLanguages(['en-US']); } catch {}

  const saveBounds = () => {
    if (!win || win.isDestroyed()) return;
    settings.maximized = win.isMaximized();
    if (!settings.maximized && !win.isMinimized()) settings.windowBounds = win.getBounds();
    writeJSON(settingsFile, settings);
  };
  win.on('resize', debounce(saveBounds, 600));
  win.on('move', debounce(saveBounds, 600));
  win.on('close', (e) => {
    saveBounds();
    if (!forceClose) { e.preventDefault(); send('app:request-close'); }
  });
  win.on('closed', () => { win = null; });

  win.webContents.on('context-menu', (_e, params) => {
    send('editor:context-menu', {
      x: params.x, y: params.y,
      misspelledWord: params.misspelledWord,
      suggestions: params.dictionarySuggestions || [],
    });
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });

  pendingOpen.push(...filesFromArgv(process.argv));
  if (process.env.TXS_SCRIPT) runDebugScript(process.env.TXS_SCRIPT);
}

// Development aid: run a JSON list of steps ({js, wait, shot}) against the renderer and capture screenshots.
function runDebugScript(file) {
  win.webContents.on('console-message', (e) => console.log('[renderer]', e.message || e));
  win.webContents.once('did-finish-load', async () => {
    const steps = JSON.parse(fs.readFileSync(file, 'utf8'));
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await sleep(1500);
    for (const s of steps) {
      try {
        if (s.js) { const r = await win.webContents.executeJavaScript(s.js, true); if (r !== undefined) console.log('[step]', JSON.stringify(r).slice(0, 2000)); }
        if (s.key) win.webContents.sendInputEvent({ type: 'keyDown', keyCode: s.key, modifiers: s.mods || [] }), win.webContents.sendInputEvent({ type: 'keyUp', keyCode: s.key, modifiers: s.mods || [] });
        if (s.move) win.webContents.sendInputEvent({ type: 'mouseMove', x: s.move[0], y: s.move[1] });
        if (s.click) for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, x: s.click[0], y: s.click[1], button: 'left', clickCount: 1, modifiers: s.mods || [] });
        if (s.wait) await sleep(s.wait);
        if (s.shot) { const img = await win.webContents.capturePage(); fs.writeFileSync(s.shot, img.toPNG()); console.log('[shot]', s.shot); }
      } catch (e) { console.log('[step-error]', e.message); }
    }
    if (process.env.TXS_QUIT !== '0') { forceClose = true; app.quit(); }
  });
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
});
app.on('window-all-closed', () => app.quit());
app.on('open-file', (e, p) => { e.preventDefault(); if (win) send('app:open-file', { path: p }); else pendingOpen.push(p); });

// ---------- IPC: app / window ----------
ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  texBin: texBin(),
  texCandidates: scanCommon(),
  home: os.homedir(),
  launchFiles: pendingOpen.splice(0),
  userData,
}));
ipcMain.handle('app:confirm-close', () => { forceClose = true; win?.close(); });
ipcMain.handle('app:set-theme', (_e, dark) => {
  if (win && process.platform !== 'darwin') try { win.setTitleBarOverlay(overlayColors(dark)); } catch {}
  win?.setBackgroundColor(dark ? '#000000' : '#f5f5f7');
});
ipcMain.handle('app:system-dark', () => nativeTheme.shouldUseDarkColors);
nativeTheme.on('updated', () => send('app:system-theme', nativeTheme.shouldUseDarkColors));
ipcMain.handle('app:toggle-devtools', () => win?.webContents.toggleDevTools());
ipcMain.handle('app:toggle-fullscreen', () => win?.setFullScreen(!win.isFullScreen()));
ipcMain.handle('app:zoom', (_e, delta) => { if (!win) return; const wc = win.webContents; wc.setZoomLevel(delta === 0 ? 0 : wc.getZoomLevel() + delta); });
ipcMain.handle('app:replace-misspelling', (_e, word) => win?.webContents.replaceMisspelling(word));
ipcMain.handle('app:add-to-dictionary', (_e, word) => win?.webContents.session.addWordToSpellCheckerDictionary(word));
ipcMain.handle('app:set-spell-langs', (_e, langs) => { try { win?.webContents.session.setSpellCheckerLanguages(langs); } catch {} });
ipcMain.handle('app:clipboard-write', (_e, text) => clipboard.writeText(text));

// ---------- updates ----------
const sendUpdate = (ev) => send('update:event', ev);
ipcMain.handle('update:check', () => updater.check(sendUpdate));
ipcMain.handle('update:download', () => updater.download(sendUpdate));
ipcMain.handle('update:install', () => { forceClose = true; updater.install(); });

// ---------- settings / session ----------
const publicSettings = () => { const { aiKeyEnc, ...rest } = settings; return { ...rest, aiKeySaved: !!aiKeyEnc }; };
ipcMain.handle('settings:get', () => publicSettings());
ipcMain.handle('settings:set', (_e, patch) => { const { aiKeyEnc, aiKeySaved, ...safe } = patch; settings = { ...settings, ...safe }; writeJSON(settingsFile, settings); return publicSettings(); });
ipcMain.handle('settings:defaults', () => ({ ...DEFAULTS }));
ipcMain.handle('session:get', () => readJSON(sessionFile, null));
ipcMain.handle('session:set', (_e, s) => writeJSON(sessionFile, s));

// ---------- file system ----------
ipcMain.handle('fs:read', async (_e, p) => {
  const buf = await fsp.readFile(p);
  const st = await fsp.stat(p);
  let text;
  // Detect UTF-8 vs legacy GBK files.
  const utf8 = buf.toString('utf8');
  if (utf8.includes('�')) {
    try { text = new TextDecoder('gbk').decode(buf); } catch { text = utf8; }
    return { content: text, mtime: st.mtimeMs, encoding: 'GBK' };
  }
  return { content: utf8.replace(/^﻿/, ''), mtime: st.mtimeMs, encoding: 'UTF-8' };
});
ipcMain.handle('fs:read-binary', async (_e, p) => { const b = await fsp.readFile(p); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); });
ipcMain.handle('fs:write', async (_e, p, content) => {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  ignoreWatch.set(p, Date.now());
  await fsp.writeFile(p, content, 'utf8');
  const st = await fsp.stat(p);
  return { mtime: st.mtimeMs };
});
ipcMain.handle('fs:stat', async (_e, p) => { try { const s = await fsp.stat(p); return { exists: true, isDir: s.isDirectory(), mtime: s.mtimeMs, size: s.size }; } catch { return { exists: false }; } });
ipcMain.handle('fs:readdir', async (_e, dir) => {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
    .map((e) => ({ name: e.name, path: path.join(dir, e.name), isDir: e.isDirectory() }))
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'zh') : a.isDir ? -1 : 1));
});
ipcMain.handle('fs:list', async (_e, root, maxFiles = 6000) => {
  const out = [];
  const walk = async (d, depth) => {
    if (depth > 7 || out.length >= maxFiles) return;
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p, depth + 1);
      else out.push(p);
      if (out.length >= maxFiles) return;
    }
  };
  await walk(root, 0);
  return out;
});
ipcMain.handle('fs:mkdir', (_e, p) => fsp.mkdir(p, { recursive: true }));
ipcMain.handle('fs:create', async (_e, p, content = '') => { if (fs.existsSync(p)) throw new Error('文件已存在'); await fsp.writeFile(p, content, 'utf8'); });
ipcMain.handle('fs:rename', (_e, a, b) => fsp.rename(a, b));
ipcMain.handle('fs:trash', (_e, p) => shell.trashItem(p));
ipcMain.handle('fs:reveal', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('fs:open-external', (_e, p) => shell.openPath(p));
ipcMain.handle('fs:open-url', (_e, u) => shell.openExternal(u));

ipcMain.handle('fs:search', async (_e, root, query, opts = {}) => {
  const files = [];
  const walk = async (d, depth) => {
    if (depth > 7 || files.length > 4000) return;
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p, depth + 1);
      else if (/\.(tex|ltx|bib|sty|cls|txt|md)$/i.test(e.name)) files.push(p);
    }
  };
  await walk(root, 0);
  let re;
  try {
    const src = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(opts.word ? `\\b${src}\\b` : src, opts.caseSensitive ? 'g' : 'gi');
  } catch (err) { return { error: String(err.message) }; }
  const results = [];
  let total = 0;
  for (const f of files) {
    let text;
    try { text = await fsp.readFile(f, 'utf8'); } catch { continue; }
    const lines = text.split(/\r?\n/);
    const matches = [];
    lines.forEach((l, i) => {
      re.lastIndex = 0;
      const m = re.exec(l);
      if (m) matches.push({ line: i + 1, col: m.index, len: m[0].length, text: l.length > 240 ? l.slice(Math.max(0, m.index - 60), m.index + 180) : l, offset: l.length > 240 ? Math.max(0, m.index - 60) : 0 });
    });
    if (matches.length) { results.push({ file: f, matches: matches.slice(0, 200) }); total += matches.length; }
    if (total > 3000) break;
  }
  return { results, total };
});

// ---------- dialogs ----------
const TEX_FILTERS = [
  { name: 'LaTeX 文件', extensions: ['tex', 'ltx', 'bib', 'sty', 'cls', 'dtx', 'txt', 'md'] },
  { name: '所有文件', extensions: ['*'] },
];
ipcMain.handle('dialog:open', async (_e, opts = {}) => {
  const r = await dialog.showOpenDialog(win, {
    title: opts.title || '打开',
    defaultPath: opts.defaultPath,
    properties: opts.folder ? ['openDirectory', 'createDirectory'] : ['openFile', ...(opts.multi ? ['multiSelections'] : [])],
    filters: opts.folder ? undefined : opts.filters || TEX_FILTERS,
  });
  return r.canceled ? null : r.filePaths;
});
ipcMain.handle('dialog:save', async (_e, opts = {}) => {
  const r = await dialog.showSaveDialog(win, { title: opts.title || '保存', defaultPath: opts.defaultPath, filters: opts.filters || TEX_FILTERS });
  return r.canceled ? null : r.filePath;
});

// ---------- compile ----------
ipcMain.handle('tex:build', async (_e, opts) => {
  const res = await compiler.build({ ...opts, texBin: texBin() }, (chunk) => send('tex:output', chunk), (step) => send('tex:step', step));
  return res;
});
ipcMain.handle('tex:stop', () => compiler.stop());
ipcMain.handle('tex:clean', (_e, root) => compiler.clean(root));
ipcMain.handle('tex:tool', (_e, name, root) => compiler.runTool(name, root, texBin(), (chunk) => send('tex:output', chunk)));
ipcMain.handle('tex:forward', (_e, args) => synctex.forward({ ...args, texBin: texBin() }));
ipcMain.handle('tex:inverse', (_e, args) => synctex.inverse({ ...args, texBin: texBin() }));
ipcMain.handle('tex:texcount', (_e, file) => new Promise((resolve) => {
  execFile(tool(texBin(), 'texcount'), ['-inc', '-total', '-utf8', '-ch', '-sum', path.basename(file)], { cwd: path.dirname(file), windowsHide: true, encoding: 'utf8', timeout: 20000 }, (err, stdout) => resolve(stdout || (err ? String(err.message) : '')));
}));
ipcMain.handle('tex:format', async (_e, content, tabSize) => {
  const tmp = path.join(os.tmpdir(), `txs-fmt-${Date.now()}.tex`);
  await fsp.writeFile(tmp, content, 'utf8');
  return new Promise((resolve) => {
    execFile(tool(texBin(), 'latexindent'), ['-g', path.join(os.tmpdir(), 'txs-indent.log'), tmp], { cwd: os.tmpdir(), windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 60000 }, (err, stdout) => {
      fsp.unlink(tmp).catch(() => {});
      resolve(err && !stdout ? { error: err.message } : { content: stdout });
    });
  });
});
ipcMain.handle('tex:kpsewhich', (_e, name, cwd) => new Promise((resolve) => {
  execFile(tool(texBin(), 'kpsewhich'), [name], { cwd, windowsHide: true, encoding: 'utf8', timeout: 5000 }, (err, stdout) => resolve(err ? null : stdout.trim() || null));
}));

// ---------- AI ----------
ipcMain.handle('ai:status', () => ai.status(settings));
ipcMain.handle('ai:set-key', async (_e, key) => { settings.aiKeyEnc = await ai.encryptKey((key || '').trim()); writeJSON(settingsFile, settings); return ai.status(settings); });
ipcMain.handle('ai:stream', (_e, req) => ai.stream(settings, req, (type, payload) => send('ai:event', { id: req.id, type, ...payload })));
ipcMain.handle('ai:abort', (_e, id) => ai.abort(id));
ipcMain.handle('ai:fix', (_e, req) => ai.fix(settings, req));

// ---------- version control ----------
for (const k of ['status', 'log', 'show', 'diff', 'commit', 'sync', 'fetch', 'discard', 'restoreFile', 'init', 'setRemote', 'publish', 'setIdentity']) {
  ipcMain.handle('git:' + k, (_e, ...args) => git[k](...args));
}

// ---------- watching ----------
const watchers = new Map();
const ignoreWatch = new Map();
ipcMain.handle('fs:watch', (_e, p) => {
  if (watchers.has(p)) return;
  try {
    let t;
    const w = fs.watch(p, () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const ig = ignoreWatch.get(p);
        if (ig && Date.now() - ig < 1500) return;
        fs.stat(p, (err, st) => send('fs:changed', { path: p, exists: !err, mtime: st?.mtimeMs }));
      }, 250);
    });
    w.on('error', () => { watchers.delete(p); });
    watchers.set(p, w);
  } catch {}
});
ipcMain.handle('fs:unwatch', (_e, p) => { const w = watchers.get(p); if (w) { w.close(); watchers.delete(p); } });
