import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { WebSocket } from 'ws';
import { localAddresses } from '../server/lan.mjs';
import { createSignalingServer } from '../server/index.mjs';
const { validateServerUrl } = createRequire(import.meta.url)('../desktop/control.cjs');

test('LAN test URLs accept only private IPv4 networks and existing loopback addresses',()=>{
  for (const host of ['10.0.0.1','172.16.0.1','172.31.255.254','192.168.20.57','127.0.0.1','localhost','[::1]']) {
    assert.equal(validateServerUrl(`ws://${host}:8787`),`ws://${host}:8787/signal`);
  }
  for (const host of ['172.15.0.1','172.32.0.1','192.169.1.1','192.167.1.1','8.8.8.8','198.18.0.1','0.0.0.0','224.0.0.1','public.example']) {
    assert.throws(()=>validateServerUrl(`ws://${host}:8787`));
  }
  assert.equal(validateServerUrl('wss://remote.example/path'),'wss://remote.example/signal');
  for (const url of ['ws://user:pass@192.168.1.1:8787','ws://192.168.1.1:8787?token=x','ws://192.168.1.1:8787#x']) assert.throws(()=>validateServerUrl(url));
});

test('LAN service lists private IPv4 addresses and skips proxy, loopback and IPv6 addresses',()=>{
  const row=(address,extra={})=>({address,family:'IPv4',internal:false,...extra});
  const interfaces={Ethernet:[row('192.168.20.57')],WLAN:[row('10.1.2.3')],Proxy:[row('198.18.0.1')],Loopback:[row('127.0.0.1',{internal:true})],IPv6:[row('fe80::1',{family:'IPv6'})],Duplicate:[row('10.1.2.3')],Empty:null};
  assert.deepEqual(localAddresses(interfaces),[{name:'Ethernet',url:'ws://192.168.20.57:8787'},{name:'WLAN',url:'ws://10.1.2.3:8787'}]);
});

test('all-interface LAN listener registers clients and keeps local approval before creating a session',async t=>{
  const service=createSignalingServer({env:{}});
  const address=await service.listen(0,'0.0.0.0');
  t.after(()=>service.close());
  assert.equal(address.address,'0.0.0.0');
  const url=`ws://127.0.0.1:${address.port}/signal`;
  async function connect(name) {
    const ws=new WebSocket(url),queued=[],waiters=[];
    ws.on('message',data=>{const message=JSON.parse(data.toString());const index=waiters.findIndex(w=>w.type===message.type);if(index<0)queued.push(message);else{const waiter=waiters.splice(index,1)[0];clearTimeout(waiter.timer);waiter.resolve(message);}});
    const next=type=>{const index=queued.findIndex(m=>m.type===type);if(index>=0)return Promise.resolve(queued.splice(index,1)[0]);return new Promise((resolve,reject)=>{const waiter={type,resolve};waiter.timer=setTimeout(()=>reject(Error('Timed out: '+type)),3000);waiters.push(waiter);});};
    await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
    const send=message=>ws.send(JSON.stringify(message));send({type:'register',name});
    return {ws,send,next,credentials:await next('registered')};
  }
  const host=await connect('LAN host'),controller=await connect('LAN controller');
  controller.send({type:'connect',peerId:host.credentials.peerId,secret:host.credentials.secret});
  const request=await host.next('request.incoming');
  assert.equal(service.sessions.size,0);
  host.send({type:'respond',requestId:request.requestId,accepted:true,viewOnly:true});
  const hostSession=await host.next('session.ready'),controllerSession=await controller.next('session.ready');
  assert.equal(hostSession.sessionId,controllerSession.sessionId);
  assert.equal(controllerSession.viewOnly,true);
  controller.send({type:'disconnect'});
  await host.next('session.ended');
  assert.equal(service.sessions.size,0);
});
