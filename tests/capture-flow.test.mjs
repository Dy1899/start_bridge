import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const mainFile = fileURLToPath(new URL('../desktop/main.cjs', import.meta.url));
const code = await fs.readFile(mainFile, 'utf8');
const control = require('../desktop/control.cjs');
const permissions = require('../desktop/capture-permissions.cjs');

async function fixture() {
  const state = { now:1000, windows:[], handlers:new Map(), logs:[], sources:[{ id:'screen:0:0', name:'Screen 1', display_id:'1' }] };
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options=options; this.destroyed=false;
      this.webContents=new EventEmitter();
      this.webContents.mainFrame={ url:'', isDestroyed:()=>false };
      this.webContents.setWindowOpenHandler=()=>{};
      this.webContents.send=()=>{};
      state.windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    setTitle() {}
    setAlwaysOnTop() {}
    loadURL(url) { this.webContents.mainFrame.url=url; return Promise.resolve(); }
    loadFile() { return Promise.resolve(); }
    showInactive() { this.inactive=true; }
    destroy() { this.destroyed=true; }
  }
  const electron = {
    app:{ isPackaged:true, setPath(){}, setAppUserModelId(){}, getVersion:()=> '0.1.2', whenReady:()=>({then:fn=>state.ready=fn()}), on(){}, quit(){} },
    BrowserWindow:Window,
    ipcMain:{ handle:(name,handler)=>state.handlers.set(name,handler), on(){} },
    desktopCapturer:{ getSources:async()=>state.sourcePromise?await state.sourcePromise:state.sources },
    screen:{ getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1920,height:1080}}), getAllDisplays:()=>[{id:1,bounds:{x:0,y:0,width:1920,height:1080}}], dipToScreenRect:(_,rect)=>rect, on(){} },
    session:{ defaultSession:{ setPermissionRequestHandler:fn=>state.permissionRequest=fn, setPermissionCheckHandler:fn=>state.permissionCheck=fn, setDisplayMediaRequestHandler:fn=>state.display=fn } },
    dialog:{ showMessageBox:async()=>({response:1}) }, globalShortcut:{ register(){}, unregister(){} }, clipboard:{ writeText(){} }
  };
  const mockFs={ mkdirSync(){}, existsSync:()=>true, statSync:()=>({size:0}), appendFileSync:(_,text)=>state.logs.push(JSON.parse(text)), readFileSync(){throw Error('No saved settings');}, writeFileSync(){} };
  class Clock extends Date { static now() { return state.now; } }
  const modules={ electron, 'node:path':path, 'node:fs':mockFs, 'node:os':{hostname:()=> 'Test PC'}, 'node:child_process':{spawn(){throw Error('Read-only capture must not start input');}}, 'node:crypto':{randomUUID}, 'node:url':{pathToFileURL}, './control.cjs':control, './capture-permissions.cjs':permissions };
  vm.runInNewContext(code,{ require:name=>{if(!(name in modules))throw Error(name);return modules[name];}, __dirname:path.dirname(mainFile), process:{env:{},execPath:'C:/StarBridge/StarBridge.exe',pid:1,argv:[],platform:'win32',versions:{electron:'44.9.1'}}, Date:Clock, setInterval:()=>1, clearInterval(){}, setTimeout:()=>({unref(){}}) },{filename:mainFile});
  await state.ready;
  const wc=state.windows[0].webContents;
  state.event={sender:wc,senderFrame:wc.mainFrame};
  state.details={requestingUrl:wc.mainFrame.url,isMainFrame:true,mediaTypes:[]};
  state.request=(details=state.details,permission='media')=>{let allowed;state.permissionRequest(wc,permission,result=>allowed=result,details);return allowed;};
  state.arm=async()=>{
    const approval=await state.handlers.get('host:approve')(state.event,{requestId:'r1',sourceId:'screen:0:0',viewOnly:true});
    state.handlers.get('host:begin')(state.event,{requestId:'r1',sessionId:'s1',grantId:approval.grantId});
  };
  state.captureRequest=()=>({frame:wc.mainFrame,videoRequested:true,audioRequested:false,userGesture:true});
  return state;
}

test('actual main process accepts Electron 44 permission and captures only the selected screen once',async()=>{
  const h=await fixture();
  assert.equal(h.request(),false);
  await h.arm();
  assert.equal(h.request(),true);
  assert.equal(h.request({...h.details,mediaTypes:['video']}),false);
  assert.equal(h.windows.length,1);
  let selected;
  await h.display(h.captureRequest(),value=>selected=value);
  assert.equal(selected.video.id,'screen:0:0');
  assert.equal('audio' in selected,false);
  assert.equal(h.request(),false);
  await h.display(h.captureRequest(),value=>selected=value);
  assert.equal(selected,null);
  h.handlers.get('host:started')(h.event,{sessionId:'s1'});
  await Promise.resolve();
  assert.equal(h.windows[1].options.focusable,false);
  assert.equal(h.windows[1].inactive,true);
  h.handlers.get('host:stop')(h.event);
  assert.equal(h.request(),false);
});
test('expired capture arm and a different frame cannot receive screen contents',async()=>{
  const h=await fixture(); await h.arm();
  let selected;
  await h.display({...h.captureRequest(),frame:{...h.event.senderFrame}},value=>selected=value);
  assert.equal(selected,null);
  assert.equal(h.request(),true);
  h.now+=30001;
  assert.equal(h.request(),false);
  await h.display(h.captureRequest(),value=>selected=value);
  assert.equal(selected,null);
});
test('disconnect during source enumeration revokes an in-flight capture',async()=>{
  const h=await fixture(); await h.arm();
  let resolveSources,selected;
  h.sourcePromise=new Promise(resolve=>resolveSources=resolve);
  const pending=h.display(h.captureRequest(),value=>selected=value);
  h.handlers.get('host:stop')(h.event);
  resolveSources(h.sources); await pending;
  assert.equal(selected,null);
});
