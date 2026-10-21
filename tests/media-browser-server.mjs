import http from 'node:http';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createSignalingServer} from '../server/index.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const signal=createSignalingServer({env:{}}),address=await signal.listen(0);
const bridge=`window.__inputs=[];window.__diagnostics=[];window.__pcs=[];window.__channels=[];window.__reports=[];
const NativePC=window.RTCPeerConnection;window.RTCPeerConnection=class extends NativePC{constructor(...args){super(...args);window.__pcs.push(this);this.addEventListener('datachannel',e=>window.__channels.push(e.channel));}createDataChannel(...args){const dc=super.createDataChannel(...args);window.__channels.push(dc);return dc;}};
const role=new URL(location.href).searchParams.get('role');
// The fixture has no user gesture or audio. Permit silent autoplay so tests
// verify displayed video frames as well as transport and decoded counters.
document.getElementById('remote-video').muted=true;
window.bridge={info:async()=>({version:'0.1.6',deviceName:role,serverUrl:'ws://127.0.0.1:${address.port}/signal',relayOnly:false,codecPreference:new URL(location.href).searchParams.get('codec')||'auto'}),screens:async()=>[{id:'synthetic',name:'Synthetic screen'}],saveSettings:async v=>v,savePerformance:async value=>{window.__reports.push(value);return {name:'fixture-report.json'};},copy:async()=>true,onEvent:()=>{},stopHost:async()=>true,approve:async()=>({accepted:true,grantId:'synthetic-grant',viewOnly:false}),beginHost:async()=>({viewOnly:false}),hostStarted:async()=>({viewOnly:false}),input:(_,command)=>window.__inputs.push(command),diagnostic:async d=>window.__diagnostics.push(d)};
navigator.mediaDevices.getDisplayMedia=async options=>{const sourceWidth=Number(new URL(location.href).searchParams.get('screen'))===1080?1920:2560,sourceHeight=sourceWidth*9/16;const canvas=document.createElement('canvas');canvas.width=Math.min(sourceWidth,options.video.width.ideal);canvas.height=Math.min(sourceHeight,options.video.height.ideal);const ctx=canvas.getContext('2d');let frame=0;window.__draw=setInterval(()=>{ctx.fillStyle='#f8fafb';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#163e35';ctx.font='24px "Microsoft YaHei",sans-serif';ctx.fillText('星桥远控 · 小字清晰度测试（合成画面）',40,45);ctx.font='14px "Microsoft YaHei",monospace';for(let row=0;row<36;row++)for(let col=0;col<3;col++)ctx.fillText('第 '+(row+1)+' 行：原始像素 · 中文文字 ABC 123456 · 清晰度对比',40+col*680,85+row*25);ctx.fillStyle='#16896c';ctx.fillRect(40+(frame++%150)*4,canvas.height-70,30,30);},1000/60);const stream=canvas.captureStream(60),track=stream.getVideoTracks()[0],apply=track.applyConstraints.bind(track);track.getCapabilities=()=>({width:{max:sourceWidth},height:{max:sourceHeight}});track.applyConstraints=async c=>{canvas.width=Math.min(sourceWidth,c.width.max);canvas.height=Math.min(sourceHeight,c.height.max);return apply(c);};return stream;};`;
const files=new Set(['app.js','style.css','geometry.mjs','share-start.mjs','media-quality.mjs','pointer-order.mjs','codec-preference.mjs','performance.mjs','performance-view.mjs','remote-view.mjs']);
const browser=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(bridge);return;}
  if(url.pathname==='/run'){const codec=['auto','h264','vp8'].includes(url.searchParams.get('codec'))?url.searchParams.get('codec'):'auto',screen=url.searchParams.get('screen')==='1080'?'1080':'1440';res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><meta charset="utf-8"><title>StarBridge media regression</title><style>body{font:14px system-ui}iframe{width:1180px;height:900px;border:1px solid #ccc}pre{white-space:pre-wrap}</style><h1>Synthetic media regression</h1><p>No desktop capture or native input.</p><pre id="result">Running…</pre><iframe id="host" src="/?role=host&codec=${codec}&screen=${screen}"></iframe><iframe id="controller" src="/?role=controller"></iframe><script type="module" src="/runner.mjs"></script>`);return;}
  if(url.pathname==='/runner.mjs'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(await fs.readFile(path.join(root,'tests/media-browser-runner.mjs')));return;}
  if(url.pathname==='/result'&&req.method==='POST'){const codec=['auto','h264','vp8'].includes(url.searchParams.get('codec'))?url.searchParams.get('codec'):'auto',screen=url.searchParams.get('screen')==='1080'?'1080':'1440';let body='';for await(const chunk of req){body+=chunk;if(body.length>1000000){res.writeHead(413);res.end();return;}}await fs.writeFile(path.join(root,'runtime/clarity-browser-'+codec+'-'+screen+'.json'),body);res.end('saved');return;}
  if(url.pathname==='/'){let html=await fs.readFile(path.join(root,'ui/index.html'),'utf8');html=html.replace('<script type="module" src="app.js">','<script src="/fixture.js"></script><script type="module" src="app.js">');res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
  if(files.has(url.pathname.slice(1))){res.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':'text/javascript; charset=utf-8');res.end(await fs.readFile(path.join(root,'ui',url.pathname.slice(1))));return;}
  res.writeHead(404);res.end();
}catch(e){res.writeHead(500);res.end(e.message);}});
await fs.mkdir(path.join(root,'runtime'),{recursive:true});
browser.listen(18488,'127.0.0.1',()=>console.log('Synthetic media tests: http://127.0.0.1:18488/run'));
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{browser.close();signal.close().finally(()=>process.exit());});
