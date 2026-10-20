import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {createHmac} from 'node:crypto';
import {createSignalingServer,turnConfiguration} from '../server/index.mjs';

async function client(url,name){
  const ws=new WebSocket(url),queue=[],waiters=[];
  ws.on('message',data=>{const m=JSON.parse(data.toString());const i=waiters.findIndex(w=>w.type===m.type);if(i>=0){const w=waiters.splice(i,1)[0];clearTimeout(w.timer);w.resolve(m);}else queue.push(m);});
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  const c={ws,send:m=>ws.send(JSON.stringify(m)),next(type){const i=queue.findIndex(m=>m.type===type);if(i>=0)return Promise.resolve(queue.splice(i,1)[0]);return new Promise((resolve,reject)=>{const w={type,resolve};w.timer=setTimeout(()=>{const i=waiters.indexOf(w);if(i>=0)waiters.splice(i,1);reject(Error('Timeout: '+type));},4000);waiters.push(w);});}};
  c.send({type:'register',name});c.credentials=await c.next('registered');return c;
}
test('a stranger cannot signal; only the requested host can accept; disconnect cleans both peers',async t=>{
  const service=createSignalingServer({env:{}});const a=await service.listen(0);t.after(()=>service.close());
  const url=`ws://127.0.0.1:${a.port}/signal`,host=await client(url,'Host'),controller=await client(url,'Controller'),stranger=await client(url,'Stranger');
  stranger.send({type:'signal',sessionId:'guessed',payload:{kind:'offer',sdp:'x'}});assert.match((await stranger.next('error')).message,/授权/);
  controller.send({type:'connect',peerId:host.credentials.peerId,secret:'wrong'});assert.match((await controller.next('error')).message,/不正确/);
  controller.send({type:'connect',peerId:host.credentials.peerId,secret:host.credentials.secret});const incoming=await host.next('request.incoming');
  stranger.send({type:'respond',requestId:incoming.requestId,accepted:true});assert.match((await stranger.next('error')).message,/失效/);
  assert.equal(service.sessions.size,0);
  host.send({type:'respond',requestId:incoming.requestId,accepted:true,viewOnly:true});
  const h=await host.next('session.ready'),c=await controller.next('session.ready');assert.equal(h.sessionId,c.sessionId);assert.equal(c.viewOnly,true);
  host.send({type:'signal',sessionId:h.sessionId,payload:{kind:'offer',sdp:'test-offer'}});assert.equal((await controller.next('signal')).payload.sdp,'test-offer');
  stranger.send({type:'signal',sessionId:h.sessionId,payload:{kind:'candidate',candidate:{}}});assert.match((await stranger.next('error')).message,/授权/);
  controller.ws.close();assert.equal((await host.next('session.ended')).reason,'对方已离线');assert.equal(service.sessions.size,0);
});
test('request timeout releases busy state and rejects late approval',async t=>{
  const service=createSignalingServer({env:{},requestTimeout:60});const a=await service.listen(0);t.after(()=>service.close());const url=`ws://127.0.0.1:${a.port}/signal`;
  const host=await client(url,'Host'),controller=await client(url,'Controller');controller.send({type:'connect',peerId:host.credentials.peerId,secret:host.credentials.secret});const incoming=await host.next('request.incoming');await controller.next('request.ended');
  host.send({type:'respond',requestId:incoming.requestId,accepted:true});await host.next('error');assert.equal(service.sessions.size,0);assert.equal([...service.peers.values()].some(p=>p.pending),false);
});
test('TURN credentials match coturn REST HMAC and remain time limited',()=>{
  const [ice]=turnConfiguration({TURN_URLS:'turn:relay.example:3478?transport=udp',TURN_SECRET:'test-secret'});assert.equal(ice.credential,createHmac('sha1','test-secret').update(ice.username).digest('base64'));const expiry=Number(ice.username.split(':')[0]);assert.ok(expiry>Date.now()/1000+3500&&expiry<Date.now()/1000+3700);
});
