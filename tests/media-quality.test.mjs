import test from 'node:test';
import assert from 'node:assert/strict';
import {applyVideoProfile,videoConstraints,preferLowDelay,videoMetrics,withLanStartupBitrate} from '../ui/media-quality.mjs';
import {PointerOrder,clickPosition} from '../ui/pointer-order.mjs';

test('negotiated video applies the capture and encoder budget together; failures are reported',async()=>{
  let resized,applied;
  const sender={track:{kind:'video',applyConstraints:async c=>resized=c,getSettings:()=>({width:1920,height:1080,frameRate:60})},getParameters:()=>({transactionId:'preserved',encodings:[{rid:'main'}]}),setParameters:async p=>applied=p};
  const settings=await applyVideoProfile(sender,'balanced');
  assert.equal(settings.frameRate,60);assert.equal(resized.frameRate.max,60);assert.equal(applied.encodings[0].maxBitrate,16000000);assert.equal(applied.encodings[0].rid,'main');assert.equal(applied.transactionId,'preserved');assert.equal(applied.degradationPreference,'maintain-framerate');assert.equal(sender.track.contentHint,'motion');
  await applyVideoProfile(sender,'detail');assert.equal(resized.width.max,2560);assert.equal(applied.degradationPreference,'maintain-resolution');assert.equal(sender.track.contentHint,'detail');
  sender.setParameters=async()=>{throw Error('Encoder rejected settings');};await assert.rejects(applyVideoProfile(sender,'smooth'),/Encoder rejected/);
  sender.getParameters=()=>({encodings:[]});await assert.rejects(applyVideoProfile(sender,'balanced'),/协商尚未完成/);
  assert.throws(()=>videoConstraints('shell'),/未知画质/);
});
test('unsupported low-delay receivers fall back without breaking playback',()=>{
  assert.equal(preferLowDelay({}),false);const receiver={jitterBufferTarget:null};assert.equal(preferLowDelay(receiver),true);assert.equal(receiver.jitterBufferTarget,20);
  assert.equal(preferLowDelay({set jitterBufferTarget(_){throw Error('unsupported');}}),false);
});
test('video delay uses interval deltas and cannot mix samples from different streams',()=>{
  const first={id:'video',timestamp:1000,bytesReceived:1000000,framesDecoded:100,totalDecodeTime:0.2,jitterBufferDelay:2,jitterBufferEmittedCount:100};
  const next={id:'video',timestamp:2000,bytesReceived:2000000,framesDecoded:160,totalDecodeTime:0.32,jitterBufferDelay:3.2,jitterBufferEmittedCount:160};
  const m=videoMetrics(next,first);assert.equal(m.bitrate,8);assert.ok(Math.abs(m.bufferMs-20)<1e-8);assert.ok(Math.abs(m.decodeMs-2)<1e-8);
  assert.equal(videoMetrics({...next,id:'new-video'},first).bitrate,null);assert.equal(videoMetrics(first,null).bufferMs,null);
});
test('a delayed unordered pointer cannot override a newer reliable click position',()=>{
  const order=new PointerOrder(),move=seq=>({type:'move',seq,x:0.5,y:0.5});
  assert.equal(order.accept(move(1),true),true);assert.equal(order.accept(move(3)),true);assert.equal(order.accept(move(2),true),false);assert.equal(order.accept(move(3)),false);assert.equal(order.accept(move(4),true),true);
  assert.equal(order.accept({type:'key',code:'KeyA'},true),false);assert.equal(order.accept({...move(5),x:Infinity},true),false);assert.equal(order.accept({...move(5),seq:1.5}),false);
  assert.equal(order.accept({type:'move',x:0,y:0}),false);
  const legacy=new PointerOrder();assert.equal(legacy.accept({type:'move',x:0,y:0}),true);assert.equal(legacy.accept({type:'move',x:0,y:0},true),false);
  assert.deepEqual(clickPosition({type:'button',button:'left',state:'down',x:0.7,y:0.8}),{type:'move',x:0.7,y:0.8});assert.equal(clickPosition({type:'button',x:100,y:0}),null);assert.equal(clickPosition({type:'key',x:0,y:0}),null);
});
test('LAN startup hint affects only primary video codecs and survives repeated processing',()=>{
  const audio='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10\r\n';
  const video='m=video 9 UDP/TLS/RTP/SAVPF 96 97 102\r\na=rtpmap:96 VP8/90000\r\na=rtpmap:97 rtx/90000\r\na=fmtp:97 apt=96\r\na=rtpmap:102 H264/90000\r\na=fmtp:102 packetization-mode=1;profile-level-id=42001f\r\na=fingerprint:sha-256 PRESERVED\r\n';
  const data='m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=sctp-port:5000\r\n';
  const patched=withLanStartupBitrate(audio+video+data);assert.ok(patched.startsWith(audio));assert.ok(patched.endsWith(data));assert.ok(patched.includes('a=fmtp:97 apt=96\r\n'));assert.ok(patched.includes('a=fingerprint:sha-256 PRESERVED'));
  assert.ok(patched.includes('a=fmtp:96 x-google-start-bitrate=6000'));assert.ok(patched.includes('a=fmtp:102 packetization-mode=1;profile-level-id=42001f;x-google-start-bitrate=6000'));assert.equal(withLanStartupBitrate(patched),patched);
});
