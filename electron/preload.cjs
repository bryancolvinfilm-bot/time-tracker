const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('timeTracker', Object.freeze({
  platform: process.platform,
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  setTheme: (theme) => ipcRenderer.invoke('settings:theme', theme),
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  updateWorkspace: (operation, input) => ipcRenderer.invoke('workspace:update', operation, input),
}));
