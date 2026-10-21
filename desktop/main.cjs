const { app, BrowserWindow, ipcMain, desktopCapturer, screen, session, dialog, globalShortcut, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { ControlGate, validateServerUrl } = require('./control.cjs');
const { allowCapturePermission } = require('./capture-permissions.cjs');
const { buildPerformanceReport } = require('./performance-report.cjs');
const electronMajor = Number.parseInt(process.versions.electron, 10);
const root = path.join(__dirname, '..');
const portableRoot = process.env.STARBRIDGE_DATA || (app.isPackaged ? path.join(path.dirname(process.execPath), 'data') : path.join(root, 'runtime'));
fs.mkdirSync(portableRoot, { recursive: true });
const instanceRoot = path.join(portableRoot,'profiles',randomUUID());
fs.mkdirSync(path.join(instanceRoot,'chromium'), { recursive: true });
app.setPath('userData', instanceRoot);
app.setPath('sessionData', path.join(instanceRoot,'chromium'));
const logRoot=path.join(portableRoot,'logs');
fs.mkdirSync(logRoot,{recursive:true});
const diagnosticPath=path.join(logRoot,'session-'+process.pid+'.jsonl');
function diagnostic(phase,fields={}) {
  try {
    if(fs.existsSync(diagnosticPath)&&fs.statSync(diagnosticPath).size>1048576)return;
    const entry={at:new Date().toISOString(),phase:String(phase).slice(0,60)};
    for(const key of ['name','message','reasonCode'])if(typeof fields[key]==='string')entry[key]=fields[key].slice(0,1600);
    fs.appendFileSync(diagnosticPath,JSON.stringify(entry)+'\n');
  }catch{}
}
app.setAppUserModelId('StarBridge.Remote');
let mainWindow, indicator, helper, heartbeat, captureAllowed = false, capturePendingUntil = 0;
const gate = new ControlGate();
const uiUrl = pathToFileURL(path.join(root, 'ui', 'index.html')).href;
const configPath = path.join(portableRoot, 'settings.json');
function emit(type, payload = {}) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:event', { type, ...payload }); }
function trusted(event) { if (event.sender !== mainWindow?.webContents || event.senderFrame?.url !== uiUrl) throw new Error('不允许的请求来源'); }
function config() {
  try { const c = JSON.parse(fs.readFileSync(configPath,'utf8')); return { serverUrl: validateServerUrl(c.serverUrl), deviceName: String(c.deviceName || os.hostname()).slice(0,40), relayOnly: c.relayOnly === true, codecPreference:['auto','h264','vp8'].includes(c.codecPreference)?c.codecPreference:'auto' }; }
  catch { return { serverUrl: 'ws://127.0.0.1:8787/signal', deviceName: os.hostname(), relayOnly: false, codecPreference:'auto' }; }
}
function nativeWrite(command) { if (helper?.stdin.writable) helper.stdin.write(JSON.stringify(command) + '\n'); }
function release() { nativeWrite({ type: 'release' }); }
function stopHost() {
  captureAllowed = false; capturePendingUntil = 0; gate.clear(); release(); clearInterval(heartbeat);
  if (helper) { const previous = helper; helper = null; previous.stdin.end(); setTimeout(() => { if (previous.exitCode === null) previous.kill(); }, 1500).unref(); }
  if (indicator && !indicator.isDestroyed()) indicator.destroy(); indicator = null;
  globalShortcut.unregister('CommandOrControl+Alt+F12');
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle('星桥远控');
}
function startHelper(bounds) {
  const executable = path.join(root,'native','InputAgent.exe');
  if (!fs.existsSync(executable)) throw new Error('缺少 Windows 输入组件，请先运行构建步骤');
  helper = spawn(executable, [], { windowsHide: true, stdio: ['pipe','pipe','pipe'] });
  const child = helper;
  let buffer = '';
  helper.stdout.setEncoding('utf8');
  helper.stdout.on('data', data => { buffer += data; let i; while ((i = buffer.indexOf('\n')) >= 0) { const line=buffer.slice(0,i); buffer=buffer.slice(i+1); try { const m=JSON.parse(line); if (m.ok === false) emit('input-error',{message:m.error}); } catch {} } });
  let helperFailure='';
  helper.stderr.setEncoding('utf8');
  helper.stderr.on('data',data=>{helperFailure=(helperFailure+data).slice(-1600);});
  helper.on('error', error => {
    diagnostic('input-start-failed',error);
    emit('force-stop',{reasonCode:'input-failed',message:error.message});stopHost();
  });
  helper.on('exit', (code,signal) => {
    if (helper === child && gate.active && !gate.active.viewOnly) {
      const message='Windows 输入组件退出，代码 '+String(code)+(helperFailure?'：'+helperFailure:'');
      diagnostic('input-exited',{message});
      emit('force-stop',{reasonCode:'input-failed',message});stopHost();
    }
  });
  helper.stdin.on('error', () => {});
  nativeWrite({ type: 'bounds', ...bounds }); nativeWrite({ type: 'ping' });
  heartbeat = setInterval(() => nativeWrite({type:'ping'}),1500);
}
function hostIndicator(viewOnly) {
  const { workArea } = screen.getPrimaryDisplay();
  indicator = new BrowserWindow({ width:380,height:64,x:workArea.x+workArea.width-400,y:workArea.y+20,frame:false,resizable:false,alwaysOnTop:true,skipTaskbar:true,show:false,focusable:false,backgroundColor:'#122c29',webPreferences:{preload:path.join(__dirname,'indicator-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true} });
  indicator.setAlwaysOnTop(true,'screen-saver');
  const statusWindow=indicator;
  statusWindow.loadFile(path.join(root,'ui','indicator.html'),{query:{mode:viewOnly?'仅观看':'允许控制'}}).then(()=>{
    if(!statusWindow.isDestroyed()&&gate.active)statusWindow.showInactive();
  }).catch(error=>diagnostic('indicator-load',error));
  indicator.on('close', () => { if (gate.active) { emit('force-stop'); stopHost(); } });
}
ipcMain.handle('app:info', event => { trusted(event); return { version:app.getVersion(), platform:process.platform, ...config() }; });
ipcMain.handle('settings:save', (event,value) => {
  trusted(event); if (gate.active) throw new Error('请先结束当前远程会话');
  const settings = { serverUrl:validateServerUrl(String(value.serverUrl||'')), deviceName:String(value.deviceName||os.hostname()).replace(/[\x00-\x1f]/g,'').slice(0,40), relayOnly:value.relayOnly===true, codecPreference:['auto','h264','vp8'].includes(value.codecPreference)?value.codecPreference:'auto' };
  fs.writeFileSync(configPath,JSON.stringify(settings,null,2)); return settings;
});
ipcMain.handle('screen:list', async event => { trusted(event); const sources = await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:280,height:160}}); return sources.map(s=>({id:s.id,name:s.name,displayId:s.display_id,thumbnail:s.thumbnail.toDataURL()})); });
ipcMain.handle('host:approve', async (event,request) => {
  trusted(event);
  if (gate.active || typeof request.requestId !== 'string' || request.requestId.length > 80) throw new Error('当前请求无效');
  const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:0,height:0}});
  const source=sources.find(s=>s.id===request.sourceId);
  if (!source) throw new Error('所选屏幕已不可用');
  const display=screen.getAllDisplays().find(d=>String(d.id)===source.display_id);
  if (!display) throw new Error('无法确定屏幕坐标，请重新选择');
  const viewOnly=request.viewOnly===true;
  const peerName=String(request.controllerName||'另一台电脑').replace(/[\x00-\x1f]/g,'').slice(0,40);
  const {response}=await dialog.showMessageBox(mainWindow,{type:'question',title:'确认远程协助',message:`允许“${peerName}”${viewOnly?'观看':'观看并操作'}你的屏幕吗？`,detail:`共享：${source.name}\n你可随时点击顶部的结束按钮，或按 Ctrl+Alt+F12 断开。`,buttons:['拒绝','允许本次连接'],defaultId:0,cancelId:0,noLink:true});
  if(response!==1) return {accepted:false};
  const bounds=screen.dipToScreenRect(null,display.bounds);
  const grantId=gate.approve(request.requestId,source.id,bounds,viewOnly);
  return {accepted:true,grantId,viewOnly};
});
ipcMain.handle('host:begin', (event,request) => {
  trusted(event);
  const active=gate.activate(request.requestId,request.sessionId,request.grantId);
  captureAllowed=true;
  capturePendingUntil=Date.now()+30000;
  diagnostic('capture-prepared');
  return {viewOnly:active.viewOnly};
});
ipcMain.handle('host:started', (event,request) => {
  trusted(event);
  const active=gate.active;
  if(!captureAllowed||!active||active.sessionId!==request.sessionId)throw new Error('本机共享授权已失效');
  if (!active.viewOnly) startHelper(active.bounds);
  hostIndicator(active.viewOnly);
  mainWindow.setTitle('正在共享屏幕 · 星桥远控');
  globalShortcut.register('CommandOrControl+Alt+F12',()=>{emit('force-stop');stopHost();});
  diagnostic('capture-started');
  return {viewOnly:active.viewOnly};
});
ipcMain.handle('diagnostic:record',(event,entry)=>{
  trusted(event);diagnostic(entry?.phase||'renderer',entry||{});return true;
});
ipcMain.handle('performance:save',(event,value)=>{
  trusted(event);
  const report=buildPerformanceReport(value,{version:app.getVersion()});
  const reportRoot=path.join(portableRoot,'reports');fs.mkdirSync(reportRoot,{recursive:true});
  const name='performance-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8)+'.json';
  fs.writeFileSync(path.join(reportRoot,name),JSON.stringify(report,null,2),{encoding:'utf8',flag:'wx'});
  return {name};
});
ipcMain.handle('host:stop',event=>{trusted(event);stopHost();return true;});
ipcMain.on('input:send',(event,sessionId,command)=>{trusted(event);if(gate.permits(sessionId,command))nativeWrite(command);});
ipcMain.handle('clipboard:copy',(event,text)=>{trusted(event);clipboard.writeText(String(text).slice(0,100));return true;});
ipcMain.on('indicator:stop',event=>{if(event.sender===indicator?.webContents){emit('force-stop');stopHost();}});

app.whenReady().then(async()=>{
  const captureArmed=()=>captureAllowed&&!!gate.active&&Date.now()<capturePendingUntil;
  const permissionAllowed=(phase,webContents,permission,details)=>{
    const ownMainFrame=webContents===mainWindow?.webContents&&details?.isMainFrame===true&&details?.requestingUrl===uiUrl;
    const allowed=(permission==='fullscreen'&&ownMainFrame)||allowCapturePermission({phase,webContents,permission,details,expectedWebContents:mainWindow?.webContents,uiUrl,armed:captureArmed(),electronMajor});
    if(permission==='media'||permission==='display-capture')diagnostic('permission-'+phase,{name:permission,message:JSON.stringify({allowed,armed:captureArmed(),ownWindow:webContents===mainWindow?.webContents,mainFrame:details?.isMainFrame,ownDocument:details?.requestingUrl===uiUrl,mediaTypes:details?.mediaTypes,mediaType:details?.mediaType})});
    return allowed;
  };
  session.defaultSession.setPermissionRequestHandler((webContents,permission,callback,details)=>callback(permissionAllowed('request',webContents,permission,details)));
  session.defaultSession.setPermissionCheckHandler((webContents,permission,requestingOrigin,details)=>permissionAllowed('check',webContents,permission,details));
  session.defaultSession.setDisplayMediaRequestHandler(async(request,callback)=>{
    const active=gate.active,frame=request.frame;
    if(!captureArmed()||frame!==mainWindow?.webContents.mainFrame||frame?.url!==uiUrl||!request.videoRequested){diagnostic('capture-denied',{message:'Capture request is not bound to the approved main frame'});callback(null);return;}
    capturePendingUntil=0;
    try{
      const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:0,height:0}});
      if(!captureAllowed||gate.active!==active||frame.isDestroyed()){callback(null);return;}
      const source=sources.find(s=>s.id===active.sourceId);
      if(!source){diagnostic('capture-source-missing');callback(null);return;}
      const streams={video:source};if(request.audioRequested)streams.audio='loopback';
      diagnostic('capture-source-granted');callback(streams);
    }catch(error){diagnostic('capture-handler-failed',error);callback(null);}
  });
  diagnostic('runtime',{message:'Electron '+process.versions.electron+' / app '+app.getVersion()});
  const smoke=process.argv.includes('--smoke-ui');
  mainWindow=new BrowserWindow({width:1180,height:830,minWidth:940,minHeight:700,show:!smoke,backgroundColor:'#f3f6f8',title:'星桥远控',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  mainWindow.webContents.on('will-navigate',(event,url)=>{if(url!==uiUrl)event.preventDefault();});
  mainWindow.webContents.on('render-process-gone',()=>stopHost());
  mainWindow.on('closed',()=>{stopHost();mainWindow=null;});
  screen.on('display-removed',()=>{if(gate.active){emit('force-stop');stopHost();}});
  await mainWindow.loadURL(uiUrl);
  if(smoke){
    try { await new Promise(r=>setTimeout(r,1800)); const result=await mainWindow.webContents.executeJavaScript('({title:document.title,ready:!!window.bridge,body:document.body.innerText,errors:window.__uiErrors||[]})');fs.writeFileSync(path.join(portableRoot,'smoke.json'),JSON.stringify(result,null,2));const image=await mainWindow.webContents.capturePage();fs.writeFileSync(path.join(portableRoot,'smoke.png'),image.toPNG());app.exit(result.ready&&result.errors.length===0?0:1); }catch(e){fs.writeFileSync(path.join(portableRoot,'smoke-error.txt'),e.stack);app.exit(1);}
  }
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>stopHost());
