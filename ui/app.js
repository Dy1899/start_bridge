import {normalizedPoint} from './geometry.mjs';
import {startSharing,describeShareError} from './share-start.mjs';
const $=id=>document.getElementById(id),show=(id,on=true)=>$(id).classList.toggle('hidden',!on);
window.__uiErrors=[];
window.addEventListener('error',e=>window.__uiErrors.push(e.message));
window.addEventListener('unhandledrejection',e=>{window.__uiErrors.push(String(e.reason));toast(String(e.reason?.message||e.reason),true);});
let settings,ws,registered=false,reconnectTimer,peer,channel,stream,sessionInfo,incoming,grantId,statsTimer,startedAt,connectionTimer,inbox=Promise.resolve(),stopping=false;
let lastMove=0,dragging=false,lastBytes=0,lastStatTime=0,localFailure=null;
const heldKeys=new Set();
function toast(message,error=false){$('toast').textContent=message;$('toast').classList.toggle('error',error);show('toast');clearTimeout(toast.timer);toast.timer=setTimeout(()=>show('toast',false),6000);}
function failure(message,error,phase='share-start'){
  localFailure=message;
  $('error-panel').textContent=message+' 日志保存在程序目录 data/logs。';
  show('error-panel');
  window.bridge.diagnostic?.({phase,name:error?.name||'Error',message:error?.message||message}).catch(()=>{});
  toast(message,true);
}
function send(message){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(message));}
function tab(name){for(const el of document.querySelectorAll('.tab'))el.classList.toggle('hidden',el.id!=='tab-'+name);for(const el of document.querySelectorAll('.nav'))el.classList.toggle('active',el.dataset.tab===name);$('page-title').textContent={home:'远程协助',settings:'连接设置',help:'使用说明'}[name];}
for(const button of document.querySelectorAll('.nav'))button.addEventListener('click',()=>tab(button.dataset.tab));
function online(value){registered=value;$('status-dot').classList.toggle('online',value);$('server-status').textContent=value?'连接服务已就绪':'连接服务未就绪';$('connect-button').disabled=!value||!!sessionInfo;$('rotate').disabled=!value||!!sessionInfo;}
function connectService(){
  clearTimeout(reconnectTimer);if(ws){ws.onclose=null;ws.close();}online(false);
  try{ws=new WebSocket(settings.serverUrl);}catch(e){toast(e.message,true);return;}
  ws.onopen=()=>send({type:'register',name:settings.deviceName});
  ws.onmessage=event=>{let m;try{m=JSON.parse(event.data);}catch{return;}inbox=inbox.then(()=>handle(m)).catch(e=>{failure(e.message,e,'session-message');endSession(true,'session-failed');});};
  ws.onerror=()=>{$('server-status').textContent='无法连接服务，请检查地址';};
  ws.onclose=()=>{online(false);endSession(false);$('own-id').textContent='— — —';$('own-secret').textContent='— — — —';$('connect-tip').textContent='服务未连接，请启动连接服务或检查服务地址';reconnectTimer=setTimeout(connectService,4000);};
}
async function handle(m){
  if(m.type==='registered'){online(true);$('own-id').textContent=m.peerId.replace(/(\d{3})(?=\d)/g,'$1 ');$('own-secret').textContent=m.secret;show('relay-warning',!m.turnConfigured);$('connect-tip').textContent='两台电脑需使用同一个连接服务';return;}
  if(m.type==='error'){toast(m.message,true);if(!sessionInfo){$('connect-button').disabled=!registered;show('cancel-request',false);}return;}
  if(m.type==='request.pending'){$('connect-tip').textContent='等待对方在本机确认…';$('connect-button').disabled=true;show('cancel-request');return;}
  if(m.type==='request.incoming'){
    incoming=m;$('controller-name').textContent=m.controllerName;$('incoming-dialog').showModal();return;
  }
  if(m.type==='request.ended'){
    incoming=null;grantId=null;if($('incoming-dialog').open)$('incoming-dialog').close();await window.bridge.stopHost();$('connect-button').disabled=!registered;show('cancel-request',false);$('connect-tip').textContent=m.reason;return;
  }
  if(m.type==='session.ready'){
    localFailure=null;show('error-panel',false);sessionInfo=m;startedAt=Date.now();tab('home');show('idle-grid',false);show('session-panel');show('cancel-request',false);
    $('peer-name').textContent=m.peerName;$('connection-mode').textContent=m.viewOnly?'仅观看':'可控制';$('connect-button').disabled=true;
    show('remote-stage',m.role==='controller');show('host-message',m.role==='host');show('start-share',m.role==='host');$('host-message').querySelector('h3').textContent='你正在提供远程协助';show('keyboard-option',m.role==='controller'&&!m.viewOnly);
    if(m.role==='controller'){await createPeer();}else if(!grantId){throw new Error('本机授权已失效，请重新连接');}
    statsTimer=setInterval(updateStats,1000);return;
  }
  if(m.type==='signal'&&sessionInfo?.sessionId===m.sessionId){
    const p=m.payload;
    if(!peer)return;
    if(p.kind==='candidate'){if(peer.remoteDescription)await peer.addIceCandidate(p.candidate);else peer.pendingCandidates.push(p.candidate);}
    if(p.kind==='offer'&&sessionInfo.role==='controller'){
      await peer.setRemoteDescription({type:'offer',sdp:p.sdp});await flushCandidates();const answer=await peer.createAnswer();await peer.setLocalDescription(answer);signal({kind:'answer',sdp:answer.sdp});
    }
    if(p.kind==='answer'&&sessionInfo.role==='host'){await peer.setRemoteDescription({type:'answer',sdp:p.sdp});await flushCandidates();}
    return;
  }
  if(m.type==='session.ended'&&sessionInfo?.sessionId===m.sessionId){if(!localFailure)toast(m.reason);await endSession(false);}
}
function signal(payload){send({type:'signal',sessionId:sessionInfo.sessionId,payload});}
async function flushCandidates(){for(const c of peer.pendingCandidates.splice(0))await peer.addIceCandidate(c);}
async function createPeer(){
  if(settings.relayOnly&&!sessionInfo.iceServers.some(s=>[].concat(s.urls).some(u=>u.startsWith('turn'))))throw new Error('已启用强制中继，但服务器未配置 TURN');
  peer=new RTCPeerConnection({iceServers:sessionInfo.iceServers,iceTransportPolicy:settings.relayOnly?'relay':'all'});peer.pendingCandidates=[];
  peer.onicecandidate=event=>{if(event.candidate&&sessionInfo)signal({kind:'candidate',candidate:event.candidate.toJSON()});};
  peer.ontrack=event=>{$('remote-video').srcObject=event.streams[0];show('stage-placeholder',false);$('remote-video').play().catch(()=>{});};
  peer.ondatachannel=event=>attachChannel(event.channel);
  peer.onconnectionstatechange=()=>{
    if(!peer)return;
    if(peer.connectionState==='connected'){clearTimeout(connectionTimer);$('stats').textContent='已连接';}
    if(peer.connectionState==='failed'){toast('画面连接失败，请检查 TURN 中继和网络配置',true);endSession(true);}
    if(peer.connectionState==='disconnected'){clearTimeout(connectionTimer);connectionTimer=setTimeout(()=>{toast('网络连接已中断',true);endSession(true);},10000);}
  };
}
function attachChannel(dc){
  channel=dc;
  dc.onmessage=event=>{if(sessionInfo?.role!=='host'||typeof event.data!=='string'||event.data.length>2048)return;try{window.bridge.input(sessionInfo.sessionId,JSON.parse(event.data));}catch{}};
  dc.onclose=()=>{releaseInputs();if(sessionInfo)endSession(true);};
}
$('start-share').addEventListener('click',async()=>{
  const button=$('start-share'),starting=sessionInfo;
  if(!starting||starting.role!=='host')return;
  button.disabled=true;localFailure=null;show('error-panel',false);
  try {
    await startSharing({
      isCurrent:()=>sessionInfo===starting,
      prepare:()=>window.bridge.beginHost({requestId:starting.requestId,sessionId:starting.sessionId,grantId}),
      capture:()=>navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:30,max:30},width:{ideal:1920},height:{ideal:1080}},audio:$('share-audio').checked}),
      started:media=>{stream=media;return window.bridge.hostStarted({sessionId:starting.sessionId});},
      connect:async media=>{
        await createPeer();
        for(const track of media.getTracks()){
          const sender=peer.addTrack(track,media);
          if(track.kind==='video'){
            track.contentHint='detail';
            const params=sender.getParameters();if(!params.encodings?.length)params.encodings=[{}];
            params.encodings[0].maxBitrate=4000000;await sender.setParameters(params).catch(()=>{});
          }
          track.onended=()=>endSession(true,'capture-ended');
        }
        attachChannel(peer.createDataChannel('control',{ordered:true}));
        const offer=await peer.createOffer();await peer.setLocalDescription(offer);signal({kind:'offer',sdp:offer.sdp});
      },
      cleanup:()=>sessionInfo===starting?window.bridge.stopHost():Promise.resolve()
    });
    show('start-share',false);$('host-message').querySelector('h3').textContent='屏幕正在共享';
  }catch(error){
    if(sessionInfo===starting){
      failure(describeShareError(error),error);
      await endSession(true,'share-start-failed');
    }
  }finally{button.disabled=false;}
});
function transmit(command){
  if(sessionInfo?.role!=='controller'||sessionInfo.viewOnly||!$('capture-keys').checked||channel?.readyState!=='open')return;
  if(channel.bufferedAmount>1000000){endSession(true);return;}
  if(command.type==='move'&&channel.bufferedAmount>65536)return;
  channel.send(JSON.stringify(command));
}
function releaseInputs(){heldKeys.clear();dragging=false;if(channel?.readyState==='open'&&sessionInfo?.role==='controller')channel.send(JSON.stringify({type:'release'}));}
async function endSession(notify,reasonCode='user-stop'){
  if(stopping)return;stopping=true;
  try{if(notify)send({type:'disconnect',reasonCode});releaseInputs();await window.bridge.stopHost();sessionInfo=null;grantId=null;incoming=null;clearInterval(statsTimer);clearTimeout(connectionTimer);if(peer){peer.onconnectionstatechange=null;peer.close();}peer=null;if(channel){channel.onclose=null;channel.close();}channel=null;if(stream){for(const t of stream.getTracks()){t.onended=null;t.stop();}}stream=null;$('remote-video').srcObject=null;show('stage-placeholder');show('session-panel',false);show('idle-grid');$('connect-button').disabled=!registered;$('rotate').disabled=!registered;$('start-share').disabled=false;if($('incoming-dialog').open)$('incoming-dialog').close();lastBytes=0;lastStatTime=0;}
  finally{stopping=false;}
}
$('connect-form').addEventListener('submit',event=>{event.preventDefault();if(!registered||sessionInfo)return;const peerId=$('target-id').value.replace(/\s/g,''),secret=$('target-secret').value.trim();if(!/^\d{9}$/.test(peerId)||!/^\d{8}$/.test(secret)){toast('请输入 9 位识别码和 8 位访问码',true);return;}send({type:'connect',peerId,secret});$('target-secret').value='';});
$('cancel-request').addEventListener('click',()=>send({type:'cancel'}));
$('disconnect').addEventListener('click',()=>endSession(true));
$('rotate').addEventListener('click',()=>send({type:'rotate'}));
$('copy-id').addEventListener('click',()=>{if(registered)window.bridge.copy($('own-id').textContent.replace(/\s/g,'')).then(()=>toast('识别码已复制'));});
$('deny').addEventListener('click',()=>{if(incoming)send({type:'respond',requestId:incoming.requestId,accepted:false});$('incoming-dialog').close();incoming=null;});
$('incoming-dialog').addEventListener('cancel',event=>{event.preventDefault();$('deny').click();});
$('approve').addEventListener('click',async()=>{
  const request=incoming;if(!request)return;$('approve').disabled=true;
  try{const result=await window.bridge.approve({...request,sourceId:$('screen-source').value,viewOnly:$('view-only').checked});if(incoming?.requestId!==request.requestId){await window.bridge.stopHost();return;}grantId=result.grantId;send({type:'respond',requestId:request.requestId,accepted:result.accepted,viewOnly:result.viewOnly});$('incoming-dialog').close();incoming=null;}catch(e){toast(e.message,true);send({type:'respond',requestId:request.requestId,accepted:false});}finally{$('approve').disabled=false;}
});
$('settings-form').addEventListener('submit',async event=>{event.preventDefault();if(sessionInfo){toast('请先结束远程会话',true);return;}try{settings=await window.bridge.saveSettings({serverUrl:$('server-url').value.trim(),deviceName:$('device-name').value.trim(),relayOnly:$('relay-only').checked});connectService();toast('设置已保存');tab('home');}catch(e){toast(e.message,true);}});
const video=$('remote-video');
function point(event,clamp=false){return normalizedPoint(video.getBoundingClientRect(),video.videoWidth,video.videoHeight,event.clientX,event.clientY,clamp);}
video.addEventListener('pointermove',event=>{const now=performance.now();if(now-lastMove<32)return;const p=point(event,dragging);if(p){transmit({type:'move',...p});lastMove=now;}});
video.addEventListener('pointerdown',event=>{const p=point(event);if(!p)return;event.preventDefault();video.focus();video.setPointerCapture(event.pointerId);dragging=true;transmit({type:'move',...p});const button=['left','middle','right'][event.button];if(button)transmit({type:'button',button,state:'down'});});
video.addEventListener('pointerup',event=>{const p=point(event,true);if(p)transmit({type:'move',...p});const button=['left','middle','right'][event.button];if(button)transmit({type:'button',button,state:'up'});dragging=false;});
video.addEventListener('pointercancel',releaseInputs);video.addEventListener('contextmenu',event=>event.preventDefault());
video.addEventListener('wheel',event=>{if(!point(event))return;event.preventDefault();transmit({type:'wheel',delta:event.deltaY<0?120:-120});},{passive:false});
video.addEventListener('keydown',event=>{if(!$('capture-keys').checked)return;event.preventDefault();if(!event.repeat&&!heldKeys.has(event.code)){heldKeys.add(event.code);transmit({type:'key',code:event.code,state:'down'});}});
video.addEventListener('keyup',event=>{event.preventDefault();heldKeys.delete(event.code);transmit({type:'key',code:event.code,state:'up'});});
video.addEventListener('blur',releaseInputs);window.addEventListener('blur',releaseInputs);$('capture-keys').addEventListener('change',releaseInputs);
async function updateStats(){
  if(!sessionInfo)return;const seconds=Math.floor((Date.now()-startedAt)/1000);$('duration').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
  if(!peer||peer.connectionState!=='connected')return;
  try{const stats=await peer.getStats();for(const stat of stats.values()){
    if(stat.type==='transport'&&stat.selectedCandidatePairId){const pair=stats.get(stat.selectedCandidatePairId),local=stats.get(pair?.localCandidateId),remote=stats.get(pair?.remoteCandidateId);$('session-description').textContent=local?.candidateType==='relay'||remote?.candidateType==='relay'?'当前通过 TURN 中继连接':'当前为直接连接';}
    if(stat.type==='inbound-rtp'&&stat.kind==='video'){const bitrate=lastStatTime?(stat.bytesReceived-lastBytes)*8/(stat.timestamp-lastStatTime)/1000:0;lastBytes=stat.bytesReceived;lastStatTime=stat.timestamp;$('stats').textContent=`${stat.frameWidth||'—'} × ${stat.frameHeight||'—'} · ${Math.round(stat.framesPerSecond||0)} fps${bitrate?' · '+bitrate.toFixed(1)+' Mbps':''}`;}
  }}catch{}
}
window.bridge.onEvent(event=>{
  if(event.type==='force-stop'){
    if(event.reasonCode==='input-failed')failure('Windows 输入组件启动失败：'+event.message,{name:'InputAgentError',message:event.message},'input-component');
    endSession(true,event.reasonCode||'user-stop');
  }
  if(event.type==='input-error')toast('Windows 输入：'+event.message,true);
});
settings=await window.bridge.info();$('server-url').value=settings.serverUrl;$('device-name').value=settings.deviceName;$('relay-only').checked=settings.relayOnly;
try{const screens=await window.bridge.screens();$('screen-source').replaceChildren(...screens.map(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.name;return o;}));if(!screens.length){const o=document.createElement('option');o.textContent='未找到可共享屏幕';$('screen-source').append(o);}}catch{$('screen-source').textContent='无法读取屏幕';}
connectService();
