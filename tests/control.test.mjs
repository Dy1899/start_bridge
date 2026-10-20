import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {normalizedPoint} from '../ui/geometry.mjs';
const {ControlGate,validateServerUrl,validCommand}=createRequire(import.meta.url)('../desktop/control.cjs');
test('input needs a fresh local grant, correct session and control permission',()=>{
  let now=100;const gate=new ControlGate(()=>now);const command={type:'key',code:'KeyA',state:'down'};assert.equal(gate.permits('s',command),false);let grant=gate.approve('r','screen:1',{x:0,y:0,width:1920,height:1080},false);assert.throws(()=>gate.activate('wrong','s',grant));gate.activate('r','s',grant);assert.equal(gate.permits('s',command),true);assert.equal(gate.permits('other',command),false);gate.clear();assert.equal(gate.permits('s',command),false);grant=gate.approve('r2','screen:1',{},true);gate.activate('r2','view',grant);assert.equal(gate.permits('view',command),false);gate.clear();grant=gate.approve('r3','screen:1',{},false);now+=60001;assert.throws(()=>gate.activate('r3','expired',grant));
});
test('public unencrypted signals and arbitrary input actions are refused',()=>{
  assert.throws(()=>validateServerUrl('ws://public.example:8787'));assert.throws(()=>validateServerUrl('wss://user:password@example.com'));assert.equal(validateServerUrl('ws://127.0.0.1:8787'),'ws://127.0.0.1:8787/signal');assert.equal(validCommand({type:'shell',command:'anything'}),false);assert.equal(validCommand({type:'move',x:Infinity,y:0}),false);assert.equal(validCommand({type:'key',code:'UnknownKey',state:'down'}),false);
});
test('letterboxing and negative display coordinates do not distort normalized pointer mapping',()=>{
  const rect={left:10,top:20,width:1000,height:1000};assert.equal(normalizedPoint(rect,1920,1080,510,50),null);assert.deepEqual(normalizedPoint(rect,1920,1080,510,520),{x:0.5,y:0.5});assert.deepEqual(normalizedPoint(rect,1920,1080,0,1000,true),{x:0,y:1});
});
