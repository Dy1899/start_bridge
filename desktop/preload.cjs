const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('bridge',{
  info:()=>ipcRenderer.invoke('app:info'),
  saveSettings:value=>ipcRenderer.invoke('settings:save',value),
  screens:()=>ipcRenderer.invoke('screen:list'),
  approve:request=>ipcRenderer.invoke('host:approve',request),
  beginHost:request=>ipcRenderer.invoke('host:begin',request),
  hostStarted:request=>ipcRenderer.invoke('host:started',request),
  diagnostic:entry=>ipcRenderer.invoke('diagnostic:record',entry),
  savePerformance:value=>ipcRenderer.invoke('performance:save',value),
  stopHost:()=>ipcRenderer.invoke('host:stop'),
  input:(sessionId,command)=>ipcRenderer.send('input:send',sessionId,command),
  copy:text=>ipcRenderer.invoke('clipboard:copy',text),
  onEvent:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('app:event',listener);return()=>ipcRenderer.removeListener('app:event',listener);}
});
