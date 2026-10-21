const requestedCodec=new URL(location.href).searchParams.get('codec')||'auto';
const result={ok:false,version:'0.1.5',requestedCodec,realDesktopCaptured:false,nativeInputInjected:false};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(condition,description,ms=25000){const start=Date.now();while(Date.now()-start<ms){if(condition())return;await pause(100);}throw Error('Timed out: '+description);}
const frames=['host','controller'].map(id=>document.getElementById(id));
const snapshot=w=>({errors:w.__uiErrors,diagnostics:w.__diagnostics,stats:w.document.getElementById('stats').textContent,quality:w.document.getElementById('session-quality').value,qualityStatus:w.document.getElementById('quality-status').textContent,inputs:w.__inputs,performance:Object.fromEntries(['perf-codec','perf-capture','perf-encode','perf-decode','perf-buffer','perf-efficient','perf-encoder','perf-decoder','performance-advice','performance-peer-status'].map(id=>[id,w.document.getElementById(id).textContent])),reports:w.__reports,video:{width:w.document.getElementById('remote-video').videoWidth,height:w.document.getElementById('remote-video').videoHeight},channels:w.__channels.map(c=>({label:c.label,ordered:c.ordered,maxRetransmits:c.maxRetransmits,ready:c.readyState})),parameters:w.__pcs.flatMap(p=>p.getSenders().filter(s=>s.track?.kind==='video').map(s=>s.getParameters())),receivers:w.__pcs.flatMap(p=>p.getReceivers().map(r=>({kind:r.track.kind,target:r.jitterBufferTarget})))});
let host,controller;
try{
  await until(()=>frames.every(f=>f.contentWindow.document.getElementById('server-status')?.textContent==='连接服务已就绪'),'register');
  [host,controller]=frames.map(f=>f.contentWindow);const h=id=>host.document.getElementById(id),c=id=>controller.document.getElementById(id);
  c('target-id').value=h('own-id').textContent.replace(/\s/g,'');c('target-secret').value=h('own-secret').textContent;c('connect-button').click();
  await until(()=>h('incoming-dialog').open,'approval');h('approve').click();await until(()=>!h('start-share').classList.contains('hidden'),'share button');h('start-share').click();
  await until(()=>c('remote-video').videoWidth>0&&!c('session-quality').disabled,'video and media handshake');await until(()=>c('remote-video').videoWidth===1920,'initial 1080p',25000);await pause(1500);
  await until(()=>c('perf-encode').textContent!=='未提供'&&h('perf-decode').textContent!=='未提供','two-ended performance statistics');
  result.initial={host:snapshot(host),controller:snapshot(controller)};
  if(result.initial.host.errors.length||result.initial.controller.errors.length)throw Error('Renderer errors');
  if(result.initial.host.diagnostics.some(d=>d.phase==='video-profile-failed'))throw Error('Initial sender parameters failed');
  const actualCodec=c('perf-codec').textContent;if(requestedCodec==='h264'&&actualCodec!=='H.264')throw Error('H.264 preference was not negotiated');if(requestedCodec==='vp8'&&actualCodec!=='VP8')throw Error('VP8 preference was not negotiated');result.actualCodec=actualCodec;result.twoEndedPerformance=true;
  if(result.initial.controller.video.width!==1920||result.initial.controller.video.height!==1080)throw Error('Initial resolution incorrect');
  const encoding=result.initial.host.parameters[0]?.encodings?.[0];if(encoding?.maxBitrate!==16000000||encoding?.maxFramerate!==60)throw Error('Sender budget not applied');
  if(!result.initial.controller.channels.some(c=>c.label==='pointer'&&!c.ordered&&c.maxRetransmits===0&&c.ready==='open'))throw Error('Pointer channel missing');
  const fast=controller.__channels.find(c=>c.label==='pointer'),reliable=controller.__channels.find(c=>c.label==='control');
  fast.send(JSON.stringify({type:'move',seq:1,x:0.1,y:0.1}));reliable.send(JSON.stringify({type:'move',seq:3,x:0.7,y:0.7}));reliable.send(JSON.stringify({type:'button',button:'left',state:'down'}));reliable.send(JSON.stringify({type:'button',button:'left',state:'up'}));await pause(80);fast.send(JSON.stringify({type:'move',seq:2,x:0.2,y:0.2}));await pause(300);
  if(host.__inputs.some(c=>c.type==='move'&&c.seq===2)||!host.__inputs.some(c=>c.type==='button'&&c.state==='up'))throw Error('Pointer order failed');result.inputOrder=true;
  fast.send(JSON.stringify({type:'move',seq:5,x:0.9,y:0.9}));await pause(80);reliable.send(JSON.stringify({type:'move',seq:4,x:0.7,y:0.7}));reliable.send(JSON.stringify({type:'button',button:'left',state:'down',x:0.7,y:0.7}));reliable.send(JSON.stringify({type:'button',button:'left',state:'up',x:0.7,y:0.7}));await pause(150);
  const clickIndex=host.__inputs.findLastIndex(c=>c.type==='button'&&c.state==='down');if(host.__inputs[clickIndex-1]?.x!==0.7||host.__inputs[clickIndex-1]?.y!==0.7)throw Error('A later hover changed the reliable click position');result.clickPosition=true;
  for(const [profile,bitrate,width] of [['smooth',8000000,1280],['detail',18000000,2560]]){
    c('session-quality').value=profile;c('session-quality').dispatchEvent(new controller.Event('change'));
    await until(()=>h('session-quality').value===profile&&!h('session-quality').disabled&&!c('session-quality').disabled,'profile '+profile);
    await until(()=>c('remote-video').videoWidth===width,'resolution '+profile);await pause(1500);
    result[profile]={host:snapshot(host),controller:snapshot(controller)};if(result[profile].host.parameters[0].encodings[0].maxBitrate!==bitrate)throw Error('Incorrect profile bitrate');
  }
  c('performance-panel').open=true;c('save-performance').click();await until(()=>controller.__reports.length===1,'save live performance report');
  const exported=controller.__reports[0];if(!exported.samples.some(row=>row.local&&row.remote))throw Error('Export is missing one end of the connection');if(exported.samples.length>60||JSON.stringify(exported).includes('serverUrl'))throw Error('Unexpected report contents');result.performanceExport=true;
  c('disconnect').click();await until(()=>h('session-panel').classList.contains('hidden'),'disconnect');result.disconnect=true;
  if(c('save-last-performance').classList.contains('hidden'))throw Error('Previous-session report not available');c('save-last-performance').click();await until(()=>controller.__reports.length===2,'save previous report');result.previousSessionExport=true;result.ok=true;
}catch(error){result.error=error.stack;result.snapshots=[host,controller].filter(Boolean).map(snapshot);}
finally{document.getElementById('result').textContent=JSON.stringify(result,null,2);await fetch('/result?codec='+encodeURIComponent(requestedCodec),{method:'POST',body:JSON.stringify(result,null,2)});}
