import {spawn} from 'node:child_process';
import path from 'node:path';
import {WebSocket} from 'ws';
const root=path.resolve('build/StarBridge-win32-x64');
const child=spawn(path.join(root,'StarBridge.exe'),[path.join(root,'resources/app/server/index.mjs')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',HOST:'127.0.0.1',PORT:'18787'},windowsHide:true,stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
try{
  let health;
  for(let i=0;i<40;i++){try{health=await(await fetch('http://127.0.0.1:18787/healthz')).json();break;}catch{await new Promise(r=>setTimeout(r,150));}}
  if(!health?.ok)throw Error('Packaged server did not become ready: '+stderr);
  const ws=new WebSocket('ws://127.0.0.1:18787/signal');
  const message=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Registration timeout')),3000);ws.on('open',()=>ws.send(JSON.stringify({type:'register',name:'Packaged check'})));ws.on('message',data=>{clearTimeout(timer);resolve(JSON.parse(data.toString()));});ws.on('error',reject);});
  ws.close();if(message.type!=='registered'||!/^\d{9}$/.test(message.peerId))throw Error('Registration failed');
  console.log(JSON.stringify({packagedServer:true,healthEndpoint:true,webSocketRegistration:true,turnConfigured:health.turnConfigured}));
}finally{child.kill();}
