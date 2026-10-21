import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createSignalingServer} from '../server/index.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));const signal=createSignalingServer({env:{}});await signal.listen(17887);
const files=new Map(['/style.css','/app.js','/geometry.mjs','/share-start.mjs','/media-quality.mjs','/pointer-order.mjs','/codec-preference.mjs','/performance.mjs','/performance-view.mjs'].map(name=>[name,path.join(root,'ui',name.slice(1))]));
const fixture=`window.bridge={info:async()=>({version:'0.1.0',deviceName:'界面测试电脑',serverUrl:'ws://127.0.0.1:17887/signal',relayOnly:false}),screens:async()=>[{id:'fixture',name:'测试屏幕'}],saveSettings:async v=>v,copy:async()=>true,onEvent:()=>()=>{},stopHost:async()=>true,approve:async()=>({accepted:false}),beginHost:async()=>{throw Error('UI fixture cannot share a real desktop')},input:()=>{throw Error('UI fixture cannot inject input')}};`;
const browser=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/'){let text=await fs.readFile(path.join(root,'ui/index.html'),'utf8');text=text.replace('<script type="module" src="app.js">','<script src="/fixture-bridge.js"></script><script type="module" src="app.js">');res.setHeader('Content-Type','text/html; charset=utf-8');res.end(text);return;}
  if(url.pathname==='/fixture-bridge.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(fixture);return;}
  if(url.pathname==='/webrtc'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await fs.readFile(path.join(root,'tests/webrtc.html')));return;}
  if(url.pathname==='/webrtc-test.mjs'){res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(path.join(root,'tests/webrtc-test.mjs')));return;}
  if(files.has(url.pathname)){res.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(files.get(url.pathname)));return;}
  res.writeHead(404);res.end();
}catch(e){res.writeHead(500);res.end(e.message);}});
browser.listen(17888,'127.0.0.1',()=>console.log('UI fixture http://127.0.0.1:17888 / WebRTC test /webrtc (no native access)'));
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{browser.close();signal.close().finally(()=>process.exit());});
