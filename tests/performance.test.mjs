import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {orderVideoCodecs,applyCodecPreference} from '../ui/codec-preference.mjs';
import {readPerformanceStats,normalizePerformanceSample,performanceAdvice} from '../ui/performance.mjs';
import {PerformanceView} from '../ui/performance-view.mjs';
const {buildPerformanceReport}=createRequire(import.meta.url)('../desktop/performance-report.cjs');

test('codec preference preserves fallback and repair formats without modifying capabilities',()=>{
  const codecs=[{mimeType:'video/VP8'},{mimeType:'video/rtx'},{mimeType:'video/H264',sdpFmtpLine:'packetization-mode=0'},{mimeType:'video/H264',sdpFmtpLine:'packetization-mode=1'},{mimeType:'video/AV1'}];
  const before=JSON.stringify(codecs),ordered=orderVideoCodecs(codecs,'h264');
  assert.equal(ordered[0],codecs[3]);assert.equal(ordered[1],codecs[2]);assert.ok(ordered.includes(codecs[0]));assert.ok(ordered.includes(codecs[1]));assert.equal(ordered.length,codecs.length);assert.equal(JSON.stringify(codecs),before);
  assert.deepEqual(orderVideoCodecs(codecs,'auto'),codecs);assert.equal(orderVideoCodecs(codecs,'vp8')[0],codecs[0]);assert.throws(()=>orderVideoCodecs(codecs,'arbitrary-codec'),/未知/);
});
test('unsupported or rejected preferences leave system negotiation available',()=>{
  const sender={},calls=[],transceiver={sender,setCodecPreferences:codecs=>calls.push(codecs)},peer={getTransceivers:()=>[transceiver]};
  assert.equal(applyCodecPreference(peer,sender,'h264',{codecs:[{mimeType:'video/VP8'}]}).reason,'unsupported');assert.equal(calls.length,0);
  const capabilities={codecs:[{mimeType:'video/VP8'},{mimeType:'video/H264'}]};assert.equal(applyCodecPreference(peer,sender,'h264',capabilities).applied,true);assert.equal(calls[0][0],capabilities.codecs[1]);
  transceiver.setCodecPreferences=()=>{throw Error('Not supported');};assert.equal(applyCodecPreference(peer,sender,'h264',capabilities).reason,'rejected');assert.equal(applyCodecPreference(peer,sender,'auto').reason,'automatic');
});
function reportStats(video){return new Map([['video',video],['codec',{mimeType:'video/H264'}],['transport',{type:'transport',selectedCandidatePairId:'pair'}],['pair',{localCandidateId:'local',remoteCandidateId:'remote',currentRoundTripTime:0.01,availableOutgoingBitrate:20000000}],['local',{candidateType:'host',protocol:'udp',address:'private-address'}],['remote',{candidateType:'srflx',address:'public-address'}],['source',{framesPerSecond:60}]]);}
test('sender reports interval encoding cost, capture rate, queueing and actual format',()=>{
  const base={id:'v1',type:'outbound-rtp',kind:'video',codecId:'codec',transportId:'transport',mediaSourceId:'source',timestamp:1000,frameWidth:1920,frameHeight:1080,bytesSent:1000000,framesEncoded:100,totalEncodeTime:0.2,packetsSent:1000,totalPacketSendDelay:1,encoderImplementation:'MediaFoundationVideoEncoder',powerEfficientEncoder:true,qualityLimitationReason:'none'};
  const first=readPerformanceStats(reportStats(base));assert.equal(first.sample.encodeMs,null);assert.equal(first.sample.bitrateMbps,null);
  const next=readPerformanceStats(reportStats({...base,timestamp:2000,bytesSent:3000000,framesEncoded:160,totalEncodeTime:0.32,packetsSent:1200,totalPacketSendDelay:2}),first.reference).sample;
  assert.equal(next.encodeMs,2);assert.equal(next.fps,60);assert.equal(next.bitrateMbps,16);assert.equal(next.captureFps,60);assert.equal(next.sendQueueMs,5);assert.equal(next.rttMs,10);assert.equal(next.powerEfficient,true);assert.equal(next.codec,'video/H264');assert.equal(next.packetLossPct,null);assert.equal('address' in next,false);
});
test('receiver reports interval loss and buffering; unknown and reset counters stay unknown',()=>{
  const base={id:'v1',type:'inbound-rtp',kind:'video',codecId:'codec',transportId:'transport',timestamp:1000,bytesReceived:1000000,framesDecoded:100,totalDecodeTime:0.2,jitterBufferDelay:2,jitterBufferEmittedCount:100,packetsLost:5,packetsReceived:100,framesDropped:10};
  const first=readPerformanceStats(reportStats(base));
  const next=readPerformanceStats(reportStats({...base,timestamp:2000,bytesReceived:2000000,framesDecoded:160,totalDecodeTime:0.32,jitterBufferDelay:3.2,jitterBufferEmittedCount:160,packetsLost:7,packetsReceived:198,framesDropped:12}),first.reference).sample;
  assert.equal(next.bufferMs,20);assert.equal(next.decodeMs,2);assert.equal(next.packetLossPct,2);assert.equal(next.droppedFrames,2);assert.equal(next.powerEfficient,null);assert.equal(next.implementation,null);
  assert.equal(readPerformanceStats(reportStats({...base,id:'new',timestamp:2000}),first.reference).sample.decodeMs,null);
  assert.equal(readPerformanceStats(reportStats({...base,timestamp:2000,framesDecoded:0,totalDecodeTime:0}),first.reference).sample.decodeMs,null);
  assert.equal(readPerformanceStats(new Map()).sample,null);
  assert.equal(normalizePerformanceSample({direction:'receive',decodeMs:Infinity,width:-1,powerEfficient:'true',implementation:'<script>\n'}).decodeMs,null);
});
test('report export strips credentials, locations, arbitrary paths and unknown fields',()=>{
  const sample={direction:'receive',width:1920,decodeMs:2,password:'private',address:'private-ip',sdp:'private-sdp',codec:'video/VP8'};
  const report=buildPerformanceReport({role:'controller',codecPreference:'h264',profile:'balanced',serverUrl:'wss://private',secret:'private-secret',filePath:'C:/wrong',samples:[{at:100,profile:'smooth',local:sample,remote:{direction:'send',powerEfficient:false,implementation:'libvpx'}}]},{version:'0.1.5',now:1000});
  assert.equal(report.appVersion,'0.1.5');assert.equal(report.samples[0].local.decodeMs,2);assert.equal(report.samples[0].remote.powerEfficient,false);
  const text=JSON.stringify(report);for(const privateValue of ['private','wrong','password','address','sdp','serverUrl','secret'])assert.equal(text.includes(privateValue),false);
  assert.throws(()=>buildPerformanceReport({...report,samples:Array(61).fill(report.samples[0])}),/格式/);
  assert.throws(()=>buildPerformanceReport({...report,samples:[{at:100,local:{direction:'send'}}]}),/方向/);
  assert.throws(()=>buildPerformanceReport({...report,extra:'x'.repeat(140000)}),/过大/);
});
test('two-ended performance expires old peer data and preserves a bounded report after disconnect',async()=>{
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{textContent:'',disabled:false,events:{},classList:{toggle(){}},addEventListener(type,fn){this.events[type]=fn;}});return elements.get(id);};
  let now=100,exported;const view=new PerformanceView({getElementById:get},async value=>{exported=value;return {name:'test.json'};},()=>{},()=>now);
  view.start('controller','balanced','auto');view.update({direction:'receive',codec:'video/VP8',decodeMs:2},'balanced',60);
  assert.equal(view.acceptRemote({direction:'send',encodeMs:3},1),true);assert.equal(get('perf-encode').textContent,'3.0 ms / 帧');assert.equal(view.acceptRemote({direction:'send',encodeMs:5},1),false);assert.equal(view.acceptRemote({direction:'receive'},2),false);
  now+=6001;view.update({direction:'receive'},'balanced',60);assert.equal(get('perf-encode').textContent,'未提供');
  for(let i=0;i<100;i++){now++;view.update({direction:'receive',decodeMs:2},'balanced',60);}assert.equal(view.history.length,60);
  view.end();const count=view.history.length;view.update({direction:'receive'},'balanced',60);assert.equal(view.history.length,count);await view.save();assert.equal(exported.samples.length,60);assert.equal(exported.role,'controller');
  assert.match(performanceAdvice({limitation:'cpu'},null),/编码性能/);assert.match(performanceAdvice(null,{decodeMs:40},60),/解码/);assert.match(performanceAdvice(null,{packetLossPct:4},60),/丢包/);
});
