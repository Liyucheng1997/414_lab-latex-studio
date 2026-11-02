const { contextBridge, ipcRenderer, webUtils } = require('electron');

const inv = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);
const on = (ch) => (cb) => {
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld('api', {
  info: inv('app:info'),
  confirmClose: inv('app:confirm-close'),
  setTheme: inv('app:set-theme'),
  systemDark: inv('app:system-dark'),
  toggleDevtools: inv('app:toggle-devtools'),
  toggleFullscreen: inv('app:toggle-fullscreen'),
  zoom: inv('app:zoom'),
  replaceMisspelling: inv('app:replace-misspelling'),
  addToDictionary: inv('app:add-to-dictionary'),
  setSpellLangs: inv('app:set-spell-langs'),
  clipboardWrite: inv('app:clipboard-write'),
  pathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch { return null; } },

  getSettings: inv('settings:get'),
  setSettings: inv('settings:set'),
  defaultSettings: inv('settings:defaults'),
  getSession: inv('session:get'),
  setSession: inv('session:set'),

  read: inv('fs:read'),
  readBinary: inv('fs:read-binary'),
  write: inv('fs:write'),
  stat: inv('fs:stat'),
  readdir: inv('fs:readdir'),
  list: inv('fs:list'),
  mkdir: inv('fs:mkdir'),
  create: inv('fs:create'),
  rename: inv('fs:rename'),
  trash: inv('fs:trash'),
  reveal: inv('fs:reveal'),
  openExternal: inv('fs:open-external'),
  openUrl: inv('fs:open-url'),
  search: inv('fs:search'),
  watch: inv('fs:watch'),
  unwatch: inv('fs:unwatch'),

  openDialog: inv('dialog:open'),
  saveDialog: inv('dialog:save'),

  build: inv('tex:build'),
  stop: inv('tex:stop'),
  clean: inv('tex:clean'),
  runTool: inv('tex:tool'),
  forward: inv('tex:forward'),
  inverse: inv('tex:inverse'),
  texcount: inv('tex:texcount'),
  format: inv('tex:format'),
  kpsewhich: inv('tex:kpsewhich'),

  onOpenFile: on('app:open-file'),
  onRequestClose: on('app:request-close'),
  onSystemTheme: on('app:system-theme'),
  onContextMenu: on('editor:context-menu'),
  onOutput: on('tex:output'),
  onStep: on('tex:step'),
  onFileChanged: on('fs:changed'),
});
