const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('lume', {
  createConversation: () => ipcRenderer.invoke('lume:createConversation'),
  listConversations: () => ipcRenderer.invoke('lume:listConversations'),
  getMessages: (conversationId) => ipcRenderer.invoke('lume:getMessages', conversationId),
  deleteConversation: (conversationId) =>
    ipcRenderer.invoke('lume:deleteConversation', conversationId),
  sendMessage: (conversationId, content) =>
    ipcRenderer.invoke('lume:sendMessage', conversationId, content),
  interrupt: (conversationId) => ipcRenderer.invoke('lume:interrupt', conversationId),
  feedback: (conversationId, messageSeq, likeType) =>
    ipcRenderer.invoke('lume:feedback', conversationId, messageSeq, likeType),
  permissionResponse: (requestId, approved) =>
    ipcRenderer.invoke('lume:permissionResponse', requestId, approved),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload.conversationId, payload.event)
    ipcRenderer.on('lume:event', listener)
    return () => ipcRenderer.removeListener('lume:event', listener)
  },
})
