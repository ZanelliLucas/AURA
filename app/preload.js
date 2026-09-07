const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aura', {
  version: '0.1.0',
  getStatus: () => ipcRenderer.invoke('aura:get-status'),
  setApiKey: (key) => ipcRenderer.invoke('aura:set-api-key', key),
  sendMessage: (text) => ipcRenderer.invoke('aura:send-message', text)
});
