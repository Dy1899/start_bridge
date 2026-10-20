const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('indicator',{stop:()=>ipcRenderer.send('indicator:stop')});
