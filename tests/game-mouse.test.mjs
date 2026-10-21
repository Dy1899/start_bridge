import test from 'node:test';import assert from 'node:assert/strict';
import {GameMouse} from '../ui/game-mouse.mjs';import {PointerOrder} from '../ui/pointer-order.mjs';import {codecPath} from '../ui/codec-status.mjs';
function fixture(){
  const events={},commands=[],errors=[],requests=[];let allowed=true;const document={pointerLockElement:null,addEventListener:(name,fn)=>events[name]=fn,exitPointerLock(){this.pointerLockElement=null;events.pointerlockchange();}};
  const video={focus(){},requestPointerLock:async options=>{requests.push(options);document.pointerLockElement=video;events.pointerlockchange();}};
  const mouse=new GameMouse({document,video,canStart:()=>allowed,send:c=>{commands.push(c);return true;},release:()=>commands.push({type:'release'}),onError:m=>errors.push(m),schedule:()=>1,cancel(){}});
  return{mouse,events,document,video,commands,errors,requests,setAllowed:value=>allowed=value};
}
test('relative mouse coalesces movement, preserves fractional sensitivity and never sends absolute positions',async()=>{
  const f=fixture();await f.mouse.start();assert.equal(f.mouse.active,true);assert.equal(f.requests[0].unadjustedMovement,true);assert.deepEqual(f.commands.slice(0,2),[{type:'release'},{type:'input-mode',mode:'relative'}]);
  f.mouse.sensitivity=0.5;f.mouse.move(1,1);f.mouse.flush();assert.equal(f.commands.filter(c=>c.type==='relative').length,0);f.mouse.move(3,-5);f.mouse.flush();assert.deepEqual(f.commands.at(-1),{type:'relative',dx:2,dy:-2});
  f.mouse.sensitivity=1;f.mouse.move(4096,-3000);f.mouse.flush();const moves=f.commands.filter(c=>c.type==='relative');assert.equal(moves.reduce((n,c)=>n+c.dx,0),4098);assert.ok(moves.every(c=>Math.abs(c.dx)<=2048&&Math.abs(c.dy)<=2048&&!('x' in c)));
  f.mouse.stop();assert.equal(f.mouse.active,false);assert.equal(f.document.pointerLockElement,null);assert.deepEqual(f.commands.slice(-2),[{type:'release'},{type:'input-mode',mode:'absolute'}]);f.mouse.move(100,100);assert.equal(f.commands.at(-1).type,'input-mode');
});
test('relative mouse falls back only for unsupported raw movement, and a denied request does not retry',async()=>{
  const f=fixture(),original=f.video.requestPointerLock;f.video.requestPointerLock=async options=>{if(options){f.requests.push(options);const error=Error('unsupported');error.name='NotSupportedError';throw error;}return original();};
  await f.mouse.start();assert.equal(f.mouse.active,true);assert.equal(f.mouse.rawRequested,false);assert.equal(f.requests.length,2);f.mouse.stop();
  const denied=fixture();denied.video.requestPointerLock=async()=>{denied.requests.push(1);const error=Error('denied');error.name='NotAllowedError';throw error;};await denied.mouse.start();assert.equal(denied.requests.length,1);assert.equal(denied.mouse.active,false);assert.equal(denied.errors.length,1);assert.equal(denied.commands.length,0);
});
test('unsupported sessions, late pointer-lock results and congested movement cannot leave game input active',async()=>{
  const f=fixture();f.setAllowed(false);assert.equal(await f.mouse.start(),false);assert.equal(f.requests.length,0);
  const late=fixture();let resolve;late.video.requestPointerLock=()=>new Promise(r=>resolve=r);const pending=late.mouse.start();late.mouse.stop();late.document.pointerLockElement=late.video;resolve();await pending;assert.equal(late.mouse.active,false);assert.equal(late.document.pointerLockElement,null);assert.equal(late.commands.length,0);
  const stalled=fixture();await stalled.mouse.start();stalled.mouse.send=c=>{stalled.commands.push(c);return c.type!=='relative';};stalled.mouse.move(10,20);stalled.mouse.flush();assert.equal(stalled.mouse.active,false);assert.deepEqual(stalled.commands.at(-1),{type:'input-mode',mode:'absolute'});assert.equal(stalled.errors.length,1);
});
test('input-mode sequence barriers reject old unordered desktop moves after leaving game mode',()=>{
  const order=new PointerOrder();assert.equal(order.accept({type:'move',x:0.5,y:0.5,seq:1},true),true);assert.equal(order.barrier(4),true);assert.equal(order.barrier(4),false);assert.equal(order.accept({type:'move',x:0.7,y:0.8,seq:3},true),false);assert.equal(order.barrier(8),true);assert.equal(order.accept({type:'move',x:0,y:0,seq:7},true),false);assert.equal(order.accept({type:'move',x:0.3,y:0.4,seq:9},true),true);
});
test('codec path hints distinguish known software, known hardware and ambiguous wrappers without trusting codec names',()=>{
  assert.equal(codecPath({codec:'video/H264',powerEfficient:true}).kind,'unknown');assert.equal(codecPath({implementation:'MojoVideoEncoder',powerEfficient:true}).kind,'unknown');assert.equal(codecPath({implementation:'MediaFoundationVideoEncoder'}).kind,'unknown');assert.equal(codecPath({implementation:'libvpx'}).kind,'software');assert.equal(codecPath({implementation:'OpenH264'}).kind,'software');assert.equal(codecPath({implementation:'D3D11VideoDecoder'}).kind,'hardware');assert.equal(codecPath({implementation:'NVIDIA NVENC'}).kind,'hardware');
});
