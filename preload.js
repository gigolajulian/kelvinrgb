// Sandboxed preload: the page only gets these named calls, never ipcRenderer itself.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rgb', {
  get: () => ipcRenderer.invoke('get'),
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
  lighting: (patch) => ipcRenderer.send('lighting', patch),
  device: (key, patch) => ipcRenderer.send('device', key, patch),
  identify: (key) => ipcRenderer.send('identify', key),
  leds: (on) => ipcRenderer.send('leds', on === true), // live LED colours for the Lighting page strips
  onLeds: (fn) => ipcRenderer.on('leds', (_e, m) => fn(m)),
  layout: (key, spot) => ipcRenderer.send('layout', String(key), spot ?? null), // Arrange: [x, y], or null to reset
  theme: (op, arg) => ipcRenderer.send('theme', String(op), arg), // save name | apply index | delete index
  fan: (id, cfg) => ipcRenderer.send('fan', id, cfg),
  rescan: () => ipcRenderer.send('rescan'),
  closeConflicts: (on) => ipcRenderer.send('closeConflicts', on),
  conflictClose: (name) => ipcRenderer.send('conflictClose', name),
  conflictDone: () => ipcRenderer.send('conflictDone'),
  glass: (on) => ipcRenderer.send('glass', on),
  splash: (on) => ipcRenderer.send('splash', on),
  openLog: () => ipcRenderer.send('openLog'),
  backup: (action) => ipcRenderer.send('backup', String(action)), // export | import
  quit: () => ipcRenderer.send('quit'),
  autostart: (on) => ipcRenderer.send('autostart', on),
  setup: (action) => ipcRenderer.send('setup', String(action)), // recheck | openrgb | pawnio
  setupSeen: () => ipcRenderer.send('setupSeen'),
  drivers: (action) => ipcRenderer.send('drivers', String(action)), // check | openrgb | pawnio | a catalog row id
  update: (action) => ipcRenderer.send('update', String(action)), // check | install | releases | openrgb, anything else is ignored

  onSettings: (fn) => ipcRenderer.on('settings', (_e, s) => fn(s)),
});
