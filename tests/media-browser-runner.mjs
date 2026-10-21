const requestedCodec=new URL(location.href).searchParams.get('codec')||'auto';
const screen1080=new URL(location.href).searchParams.get('screen')==='1080';
const result={ok:false,version:'0.1.7',requestedCodec,sourceWidth:screen1080?1920:2560,realDesktopCaptured:false,nativeInputInjected:false};
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
  await until(()=>c('remote-video').currentTime>0&&!c('remote-video').paused,'visible video playback');
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
  for(const [profile,bitrate,width] of [['smooth',8000000,1280],['detail',24000000,result.sourceWidth]]){
    c('session-quality').value=profile;c('session-quality').dispatchEvent(new controller.Event('change'));
    await until(()=>h('session-quality').value===profile&&!h('session-quality').disabled&&!c('session-quality').disabled,'profile '+profile);
    await until(()=>c('remote-video').videoWidth===width,'resolution '+profile);await pause(1500);
    result[profile]={host:snapshot(host),controller:snapshot(controller)};if(result[profile].host.parameters[0].encodings[0].maxBitrate!==bitrate)throw Error('Incorrect profile bitrate');
  }
  if(!controller.document.body.classList.contains('controlling'))throw Error('Viewer workspace did not expand');
  if(c('view-mode').value!=='native')throw Error('Text profile did not select native pixels');
  result.display=[];
  for(const [mode,scale] of [['native',1],['150',1.5],['200',2],['fit',null]]){
    c('view-mode').value=mode;c('view-mode').dispatchEvent(new controller.Event('change'));await pause(150);
    const video=c('remote-video'),stage=c('remote-stage');
    if(scale!==null&&Math.abs(video.getBoundingClientRect().width*controller.devicePixelRatio-video.videoWidth*scale)>1)throw Error('Incorrect physical pixel scale '+mode);
    stage.scrollLeft=Math.min(150,stage.scrollWidth-stage.clientWidth);stage.scrollTop=Math.min(100,stage.scrollHeight-stage.clientHeight);
    const vr=video.getBoundingClientRect(),sr=stage.getBoundingClientRect(),x=sr.left+stage.clientWidth/2,y=sr.top+stage.clientHeight/2;
    const expected={x:(x-vr.left)/vr.width,y:(y-vr.top)/vr.height},before=host.__inputs.length,capture=video.setPointerCapture;
    video.setPointerCapture=()=>{};
    try{video.dispatchEvent(new controller.PointerEvent('pointerdown',{clientX:x,clientY:y,button:0,pointerId:99}));video.dispatchEvent(new controller.PointerEvent('pointerup',{clientX:x,clientY:y,button:0,pointerId:99}));}finally{video.setPointerCapture=capture;}
    await until(()=>host.__inputs.slice(before).some(c=>c.type==='button'&&c.state==='up'),'zoom click '+mode);
    const click=host.__inputs.slice(before).find(c=>c.type==='button'&&c.state==='down');
    if(!click||Math.abs(click.x-expected.x)>1e-6||Math.abs(click.y-expected.y)>1e-6)throw Error('Incorrect scrolled click '+mode);
    result.display.push({mode,status:c('view-status').textContent,videoWidth:vr.width,dpr:controller.devicePixelRatio,scrollLeft:stage.scrollLeft,scrollTop:stage.scrollTop,clickAccurate:true});
  }
  result.displayZoom=true;
  await until(()=>!c('game-mouse').disabled,'native game capability');
  // Pointer-lock activation is simulated only inside this fixture. Network
  // messages and application handlers are real; no Windows input is injected.
  const gameVideo=c('remote-video'),originalLock=gameVideo.requestPointerLock,originalExit=controller.document.exitPointerLock;
  let fakeLock=null;Object.defineProperty(controller.document,'pointerLockElement',{configurable:true,get:()=>fakeLock});
  gameVideo.requestPointerLock=async()=>{fakeLock=gameVideo;controller.document.dispatchEvent(new controller.Event('pointerlockchange'));};
  controller.document.exitPointerLock=()=>{fakeLock=null;controller.document.dispatchEvent(new controller.Event('pointerlockchange'));};
  const beforeGame=host.__inputs.length;c('game-mouse').click();await until(()=>host.__inputs.slice(beforeGame).some(c=>c.type==='input-mode'&&c.mode==='relative'),'relative mode');
  const movement=(x,y)=>{const e=new controller.MouseEvent('mousemove');Object.defineProperties(e,{movementX:{value:x},movementY:{value:y}});gameVideo.dispatchEvent(e);};
  movement(10,-5);movement(2,3);gameVideo.dispatchEvent(new controller.MouseEvent('mousedown',{button:0}));gameVideo.dispatchEvent(new controller.MouseEvent('mouseup',{button:0}));
  gameVideo.dispatchEvent(new controller.KeyboardEvent('keydown',{code:'KeyW',bubbles:true}));await until(()=>host.__inputs.slice(beforeGame).some(c=>c.type==='key'&&c.code==='KeyW'),'game key');
  const gameRows=host.__inputs.slice(beforeGame),relative=gameRows.find(c=>c.type==='relative'),button=gameRows.findIndex(c=>c.type==='button'&&c.state==='down');
  if(!relative||relative.dx!==12||relative.dy!==-2||gameRows[button-1]?.type!=='relative'||gameRows.some(c=>c.type==='move'))throw Error('Relative movement or click ordering failed');
  gameVideo.dispatchEvent(new controller.KeyboardEvent('keydown',{code:'Escape',key:'Escape',bubbles:true}));await until(()=>host.__inputs.at(-1)?.type==='input-mode'&&host.__inputs.at(-1)?.mode==='absolute','Escape releases game input');
  if(fakeLock||!host.__inputs.slice(beforeGame).some(c=>c.type==='release'))throw Error('Escape did not release input');
  const afterGame=host.__inputs.length;fast.send(JSON.stringify({type:'move',seq:1,x:0.99,y:0.99}));fast.send(JSON.stringify({type:'relative',dx:999,dy:999}));await pause(120);if(host.__inputs.length!==afterGame)throw Error('Old hover or unordered relative input crossed the mode barrier');
  c('game-mouse').click();await until(()=>fakeLock,'reenter game mouse');controller.dispatchEvent(new controller.Event('blur'));await until(()=>!fakeLock,'blur unlocks game mouse');
  c('game-mouse').click();await until(()=>fakeLock,'reenter before disabling input');c('capture-keys').checked=false;c('capture-keys').dispatchEvent(new controller.Event('change'));await until(()=>!fakeLock&&c('game-mouse').disabled,'disabling keyboard releases game input');c('capture-keys').checked=true;c('capture-keys').dispatchEvent(new controller.Event('change'));await until(()=>!c('game-mouse').disabled,'reenabling desktop input');
  host.__bridgeEvent({type:'input-ready',relativeMouse:false});await until(()=>c('game-mouse').disabled,'old helper disables game mouse');host.__bridgeEvent({type:'input-ready',relativeMouse:true});await until(()=>!c('game-mouse').disabled,'new helper restores game mouse');
  result.gameMouseMessaging=true;result.pointerLockSimulated=true;result.escapeAndBlurRelease=true;result.disableInputRelease=true;result.oldHelperFallback=true;result.codecPaths={encoder:c('perf-encode-path').textContent,decoder:c('perf-decode-path').textContent};
  if(host.__uiErrors.length||controller.__uiErrors.length)throw Error('Renderer errors after zoom: '+[...host.__uiErrors,...controller.__uiErrors].join('; '));
  c('performance-panel').open=true;c('save-performance').click();await until(()=>controller.__reports.length===1,'save live performance report');
  const exported=controller.__reports[0];if(!exported.samples.some(row=>row.local&&row.remote))throw Error('Export is missing one end of the connection');if(exported.samples.length>60||JSON.stringify(exported).includes('serverUrl'))throw Error('Unexpected report contents');result.performanceExport=true;
  result.frameTimingAvailable=exported.samples.some(row=>row.local?.frameIntervalMs!==null&&row.local?.frameJitterMs!==null);
  if(new URL(location.href).searchParams.get('hold')==='1'){
    c('performance-panel').open=false;c('view-mode').value='150';c('view-mode').dispatchEvent(new controller.Event('change'));frames[0].style.display='none';Object.assign(frames[1].style,{position:'fixed',inset:'0',width:'100vw',height:'100dvh',border:'0'});await pause(400);result.heldForVisualReview=true;
  }else{
    c('game-mouse').click();await until(()=>fakeLock,'game mode before disconnect');
    c('disconnect').click();await until(()=>h('session-panel').classList.contains('hidden'),'disconnect');result.disconnect=true;
    if(fakeLock)throw Error('Disconnect left pointer lock active');result.disconnectReleasesGame=true;
    if(controller.document.body.classList.contains('controlling'))throw Error('Viewer layout not reset');
    if(c('save-last-performance').classList.contains('hidden'))throw Error('Previous-session report not available');c('save-last-performance').click();await until(()=>controller.__reports.length===2,'save previous report');result.previousSessionExport=true;
  }
  gameVideo.requestPointerLock=originalLock;controller.document.exitPointerLock=originalExit;delete controller.document.pointerLockElement;
  if(c('remote-video').readyState>=2){const video=c('remote-video'),stage=c('remote-stage'),canvas=controller.document.createElement('canvas');canvas.width=canvas.height=2;const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0,2,2);result.visual={readyState:video.readyState,currentTime:video.currentTime,pixel:[...ctx.getImageData(0,0,1,1).data],elements:['remote-stage','remote-surface','remote-video'].map(id=>{const e=c(id),r=e.getBoundingClientRect();return{id,rect:{x:r.x,y:r.y,width:r.width,height:r.height},client:[e.clientWidth,e.clientHeight],scroll:[e.scrollLeft,e.scrollTop],style:e.getAttribute('style')};})};}
  result.ok=true;
}catch(error){result.error=error.stack;result.snapshots=[host,controller].filter(Boolean).map(snapshot);}
finally{document.getElementById('result').textContent=JSON.stringify(result,null,2);await fetch('/result?codec='+encodeURIComponent(requestedCodec)+'&screen='+(screen1080?'1080':'1440'),{method:'POST',body:JSON.stringify(result,null,2)});}
