const { contextBridge, ipcRenderer } = require("electron");

// Expose a window.storage API compatible with the artifact's persistent storage
contextBridge.exposeInMainWorld("storage", {
  get: async (key) => {
    return await ipcRenderer.invoke("store:get", key);
  },
  set: async (key, value) => {
    return await ipcRenderer.invoke("store:set", key, value);
  },
  delete: async (key) => {
    return await ipcRenderer.invoke("store:delete", key);
  },
  list: async (prefix) => {
    return await ipcRenderer.invoke("store:list", prefix);
  },
});
