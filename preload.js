// Sandboxed preload: the page only gets these named calls, never ipcRenderer itself.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rgb', {
  get: () => ipcRenderer.invoke('get'),
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
  lighting: (patch) => ipcRenderer.send('lighting', patch),
  device: (key, patch) => ipcRenderer.send('device', key, patch),
  identify: (key) => ipcRenderer.send('identify', key),
  fan: (id, cfg) => ipcRenderer.send('fan', id, cfg),
  rescan: () => ipcRenderer.send('rescan'),
  closeConflicts: (on) => ipcRenderer.send('closeConflicts', on),
  conflictClose: (name) => ipcRenderer.send('conflictClose', name),
  conflictDone: () => ipcRenderer.send('conflictDone'),
  glass: (on) => ipcRenderer.send('glass', on),
  splash: (on) => ipcRenderer.send('splash', on),
  openLog: () => ipcRenderer.send('openLog'),
  quit: () => ipcRenderer.send('quit'),
  autostart: (on) => ipcRenderer.send('autostart', on),
  onSettings: (fn) => ipcRenderer.on('settings', (_e, s) => fn(s)),
});
