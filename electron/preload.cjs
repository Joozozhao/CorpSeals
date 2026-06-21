const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('corpSealStorage', {
  readAppData: () => ipcRenderer.invoke('corpseal:read-app-data'),
  writeAppData: async (data) => {
    await ipcRenderer.invoke('corpseal:write-app-data', data);
  },
  getStorageInfo: () => ipcRenderer.invoke('corpseal:get-storage-info'),
});
