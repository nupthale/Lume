// preload：向渲染进程暴露最小 API 面
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('omnara', {
  config: () => ipcRenderer.invoke('omnara:config'),
  fetch: (apiPath, opts) => ipcRenderer.invoke('omnara:fetch', { path: apiPath, ...opts }),
})
