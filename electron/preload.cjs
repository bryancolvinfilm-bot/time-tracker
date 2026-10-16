const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('timeTracker', Object.freeze({
  platform: process.platform,
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  setTheme: (theme) => ipcRenderer.invoke('settings:theme', theme),
  getWindowState: () => ipcRenderer.invoke('window:state'),
  setMiniMode: (enabled) => ipcRenderer.invoke('window:mini', enabled),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('window:top', enabled),
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  updateWorkspace: (operation, input) => ipcRenderer.invoke('workspace:update', operation, input),
}));
