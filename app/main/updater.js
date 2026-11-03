// Updates from GitHub Releases via electron-updater. Nothing downloads until the user agrees in the renderer.
const { app } = require('electron');

let updater = null;
let downloading = null;

// Packaged builds read app-update.yml written by electron-builder; dev builds only check when
// TXS_UPDATE_CONFIG points at a dev-app-update.yml (used to test the flow without installing).
function supported() {
  return app.isPackaged || !!process.env.TXS_UPDATE_CONFIG;
}

function get(send) {
  if (updater) return updater;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.updateConfigPath = process.env.TXS_UPDATE_CONFIG;
  }
  autoUpdater.on('download-progress', (p) => send({ type: 'progress', percent: p.percent, transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond }));
  autoUpdater.on('update-downloaded', (info) => send({ type: 'downloaded', version: info.version }));
  // Failures reach the renderer through the rejected check/download promise; this only keeps the emitter from throwing.
  autoUpdater.on('error', () => {});
  updater = autoUpdater;
  return updater;
}

function notesText(notes) {
  if (Array.isArray(notes)) return notes.map((n) => `${n.version}\n${n.note || ''}`).join('\n\n');
  return notes || '';
}

async function check(send) {
  if (!supported()) return { supported: false, current: app.getVersion() };
  const r = await get(send).checkForUpdates();
  const info = r?.updateInfo;
  const available = !!(r?.isUpdateAvailable ?? (info && info.version !== app.getVersion()));
  return { supported: true, current: app.getVersion(), available, version: info?.version, notes: notesText(info?.releaseNotes), releaseDate: info?.releaseDate };
}

function download(send) {
  if (!supported()) throw new Error('当前版本不支持自动更新');
  downloading ||= get(send).downloadUpdate().finally(() => { downloading = null; });
  return downloading.then(() => true);
}

// Silent NSIS install into the existing folder, then relaunch.
function install() {
  updater?.quitAndInstall(true, true);
}

module.exports = { supported, check, download, install };
