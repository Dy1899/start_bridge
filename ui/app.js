import {normalizedPoint} from './geometry.mjs';
import {startSharing,describeShareError} from './share-start.mjs';
import {VIDEO_PROFILES,DEFAULT_PROFILE,isVideoProfile,videoConstraints,applyVideoProfile,preferLowDelay,withLanStartupBitrate} from './media-quality.mjs';
import {PointerOrder,clickPosition} from './pointer-order.mjs';
import {CODEC_PREFERENCES,isCodecPreference,applyCodecPreference} from './codec-preference.mjs';
import {readPerformanceStats} from './performance.mjs';
import {PerformanceView} from './performance-view.mjs';
import {RemoteView} from './remote-view.mjs';
import {GameMouse} from './game-mouse.mjs';
const $=id=>document.getElementById(id),show=(id,on=true)=>$(id).classList.toggle('hidden',!on);
window.__uiErrors=[];
window.addEventListener('error',e=>window.__uiErrors.push(e.message));
window.addEventListener('unhandledrejection',e=>{window.__uiErrors.push(String(e.reason));toast(String(e.reason?.message||e.reason),true);});
let settings,ws,registered=false,reconnectTimer,peer,channel,stream,sessionInfo,incoming,grantId,statsTimer,startedAt,connectionTimer,inbox=Promise.resolve(),stopping=false;
let lastMove=0,dragging=false,localFailure=null,pointerChannel,moveSequence=0,pointerOrder=new PointerOrder();
let activeProfile=DEFAULT_PROFILE,qualityBusy=false,remoteMediaSupport=false,lastDiagnostic=0,qualityRequestTimer;
let performanceReference=null,performanceSequence=0,performancePeer=false;
let nativeGameMouse=false,remoteGameMouse=false,hostGameMode=false;
const performanceView=new PerformanceView(document,value=>window.bridge.savePerformance(value),toast);
const remoteView=new RemoteView(document);
const gameMouse=new GameMouse({document,video:$('remote-video'),canStart:()=>sessionInfo?.role==='controller'&&!sessionInfo.viewOnly&&$('capture-keys').checked&&remoteGameMouse&&channel?.readyState==='open'&&$('remote-video').videoWidth>0,
  send:command=>{if(sessionInfo?.role!=='controller'||sessionInfo.viewOnly||channel?.readyState!=='open')return false;if(command.type==='relative'&&channel.bufferedAmount>8192)return false;sendControl(command.type==='input-mode'?{...command,seq:++moveSequence}:command);return true;},release:releaseInputs,
  onState:()=>{updateGameUI();if(gameMouse.active){remoteView.setMode('fit');if(activeProfile!=='balanced'&&!$('session-quality').disabled){$('session-quality').value='balanced';$('session-quality').dispatchEvent(new Event('change'));}}},onError:message=>{toast(message,true);window.bridge.diagnostic?.({phase:'game-mouse',message}).catch(()=>{});}});
function updateGameUI(){
  const visible=sessionInfo?.role==='controller'&&!sessionInfo.viewOnly;show('game-toolbar',visible);
  $('game-mouse').disabled=gameMouse.pending||(!gameMouse.active&&!(visible&&remoteGameMouse&&channel?.readyState==='open'&&$('capture-keys').checked&&$('remote-video').videoWidth>0));
  $('game-mouse').textContent=gameMouse.active?'退出游戏鼠标（Esc）':gameMouse.pending?'正在锁定鼠标…':'游戏鼠标';
  $('game-status').textContent=gameMouse.active?'已锁定光标，Esc 退出；失焦自动释放按键'+(gameMouse.rawRequested?'（已请求无加速移动）':'（系统默认相对移动）'):remoteGameMouse?'点击开启相对移动；进入游戏后再操作，Esc 退出':'等待对方新版输入组件就绪';
}
$('game-mouse').addEventListener('click',()=>gameMouse.active?gameMouse.stop():gameMouse.start());
$('game-sensitivity').addEventListener('change',()=>{gameMouse.flush();const value=Number($('game-sensitivity').value);if([0.5,1,1.5,2].includes(value))gameMouse.sensitivity=value;});
document.addEventListener('keydown',event=>{if((gameMouse.active||gameMouse.pending)&&event.code==='Escape'){event.preventDefault();event.stopPropagation();gameMouse.stop();}},true);
for(const id of ['share-quality','session-quality'])for(const [value,p] of Object.entries(VIDEO_PROFILES)){const option=document.createElement('option');option.value=value;option.textContent=p.label;$(id).append(option);$(id).value=DEFAULT_PROFILE;}
for(const [value,label] of Object.entries(CODEC_PREFERENCES)){const option=document.createElement('option');option.value=value;option.textContent=label;$('share-codec').append(option);}
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
    localFailure=null;show('error-panel',false);sessionInfo=m;startedAt=Date.now();tab('home');show('idle-grid',false);show('session-panel');show('cancel-request',false);document.body.classList.toggle('controlling',m.role==='controller');remoteView.reset();
    $('peer-name').textContent=m.peerName;$('connection-mode').textContent=m.viewOnly?'仅观看':'可控制';$('connect-button').disabled=true;
    show('remote-stage',m.role==='controller');show('host-message',m.role==='host');show('start-share',m.role==='host');$('host-message').querySelector('h3').textContent='你正在提供远程协助';show('keyboard-option',m.role==='controller'&&!m.viewOnly);
    activeProfile=$('share-quality').value;remoteMediaSupport=false;lastDiagnostic=0;pointerOrder=new PointerOrder();moveSequence=0;lastMove=0;
    nativeGameMouse=false;remoteGameMouse=false;hostGameMode=false;updateGameUI();
    performanceReference=null;performanceSequence=0;performancePeer=false;performanceView.start(m.role,activeProfile,$('share-codec').value);
    $('session-quality').value=activeProfile;$('session-quality').disabled=m.role==='controller';show('fullscreen',m.role==='controller');
    $('quality-status').textContent=m.role==='host'?'目标不超过屏幕原始尺寸；实际分辨率见状态栏':'画质切换需要对方使用新版；连接后自动检测';show('display-toolbar',m.role==='controller');
    if(m.role==='controller'){await createPeer();}else if(!grantId){throw new Error('本机授权已失效，请重新连接');}
    statsTimer=setInterval(updateStats,1000);return;
  }
  if(m.type==='signal'&&sessionInfo?.sessionId===m.sessionId){
    const p=m.payload;
    if(!peer)return;
    if(p.kind==='candidate'){if(peer.remoteDescription)await peer.addIceCandidate(p.candidate);else peer.pendingCandidates.push(p.candidate);}
    if(p.kind==='offer'&&sessionInfo.role==='controller'){
      await peer.setRemoteDescription({type:'offer',sdp:p.sdp});await flushCandidates();const answer=await peer.createAnswer();if(settings.serverUrl.startsWith('ws:'))answer.sdp=withLanStartupBitrate(answer.sdp);await peer.setLocalDescription(answer);signal({kind:'answer',sdp:peer.localDescription.sdp});
    }
    if(p.kind==='answer'&&sessionInfo.role==='host'){await peer.setRemoteDescription({type:'answer',sdp:p.sdp});await flushCandidates();await changeHostQuality(activeProfile);}
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
  peer.ontrack=event=>{preferLowDelay(event.receiver);$('remote-video').srcObject=event.streams[0];show('stage-placeholder',false);$('remote-video').play().catch(()=>{});};
  peer.ondatachannel=event=>attachChannel(event.channel);
  peer.onconnectionstatechange=()=>{
    if(!peer)return;
    if(peer.connectionState==='connected'){clearTimeout(connectionTimer);$('stats').textContent='已连接';}
    if(peer.connectionState==='failed'){toast('画面连接失败，请检查 TURN 中继和网络配置',true);endSession(true);}
    if(peer.connectionState==='disconnected'){clearTimeout(connectionTimer);connectionTimer=setTimeout(()=>{toast('网络连接已中断',true);endSession(true);},10000);}
  };
}
function attachChannel(dc){
  if(dc.label==='pointer'){
    if(sessionInfo?.role!=='host'||pointerChannel){dc.close();return;}
    pointerChannel=dc;
    dc.onmessage=event=>{if(sessionInfo?.role!=='host'||typeof event.data!=='string'||event.data.length>2048)return;try{const command=JSON.parse(event.data);if(!hostGameMode&&pointerOrder.accept(command,true))window.bridge.input(sessionInfo.sessionId,command);}catch{}};
    dc.onclose=()=>{if(pointerChannel===dc)pointerChannel=null;};return;
  }
  if(dc.label!=='control'||channel){dc.close();return;}
  channel=dc;
  dc.onopen=()=>{if(sessionInfo?.role==='host')sendMediaState();else sendControl({type:'media-hello',performance:1});};
  dc.onmessage=event=>{
    if(typeof event.data!=='string'||event.data.length>2048)return;
    try{
      const command=JSON.parse(event.data);
      if(command?.type==='performance'&&command.version===1){performanceView.acceptRemote(command.sample,command.sequence);return;}
      if(sessionInfo?.role==='host'){
        if(command.type==='media-hello'){performancePeer=command.performance===1;sendMediaState();return;}
        if(command.type==='media-quality'){if(isVideoProfile(command.profile))changeHostQuality(command.profile);return;}
        if(command.type==='input-mode'){if(!nativeGameMouse||!['relative','absolute'].includes(command.mode)||!pointerOrder.barrier(command.seq))return;hostGameMode=command.mode==='relative';window.bridge.input(sessionInfo.sessionId,command);return;}
        if(command.type==='relative'){if(nativeGameMouse&&hostGameMode)window.bridge.input(sessionInfo.sessionId,command);return;}
        if(command.type==='release')hostGameMode=false;
        if(command.type==='move'&&hostGameMode)return;
        if(command.type==='move'&&!pointerOrder.accept(command))return;
        const position=hostGameMode?null:clickPosition(command);if(position)window.bridge.input(sessionInfo.sessionId,position);
        window.bridge.input(sessionInfo.sessionId,command);
      }else if(sessionInfo?.role==='controller'&&command.type==='media-state'&&command.protocol===1&&isVideoProfile(command.profile)){
        performancePeer=command.performance===1;
        remoteGameMouse=command.gameMouse===1;if(!remoteGameMouse)gameMouse.stop();updateGameUI();
        activeProfile=command.profile;
        clearTimeout(qualityRequestTimer);remoteMediaSupport=true;$('session-quality').disabled=false;$('session-quality').value=command.profile;
        $('quality-status').textContent=command.error||(activeProfile==='detail'?'保留细字，最高 4K / 30 帧；不超过对方屏幕原始尺寸':'可随时切换画质；显示的分辨率和帧率为实际接收值');
        if(command.pointer===true&&!pointerChannel){pointerChannel=peer.createDataChannel('pointer',{ordered:false,maxRetransmits:0});pointerChannel.onclose=()=>{pointerChannel=null;};}
      }
    }catch{}
  };
  dc.onclose=()=>{releaseInputs();if(sessionInfo)endSession(true);};
}
function sendControl(command){if(channel?.readyState==='open')channel.send(JSON.stringify(command));}
function sendMediaState(error=''){sendControl({type:'media-state',protocol:1,profile:activeProfile,pointer:true,performance:1,gameMouse:nativeGameMouse?1:0,error});}
async function changeHostQuality(id){
  if(!isVideoProfile(id)||sessionInfo?.role!=='host')return;
  if(qualityBusy===peer){sendMediaState('正在切换画质，请稍后再试');return;}
  const current=peer,sender=current?.getSenders().find(s=>s.track?.kind==='video');
  if(!sender||!current.remoteDescription){activeProfile=id;$('share-quality').value=id;return;}
  qualityBusy=current;$('session-quality').disabled=true;
  try{
    const applied=await applyVideoProfile(sender,id);
    if(peer!==current||sessionInfo?.role!=='host')return;
    activeProfile=id;$('share-quality').value=id;$('session-quality').value=id;
    $('quality-status').textContent='当前采集 '+applied.width+' × '+applied.height+'；目标不超过屏幕原始尺寸';
    window.bridge.diagnostic?.({phase:'video-profile',message:JSON.stringify({profile:id,width:applied.width,height:applied.height,frameRate:applied.frameRate,maxBitrate:VIDEO_PROFILES[id].bitrate})}).catch(()=>{});
    sendMediaState();
  }catch(error){if(peer===current){toast('画质设置未完成：'+error.message,true);sendMediaState('画质设置未完成，请在被控端查看提示');window.bridge.diagnostic?.({phase:'video-profile-failed',name:error.name,message:error.message}).catch(()=>{});}}
  finally{if(qualityBusy===current)qualityBusy=false;if(peer===current&&sessionInfo?.role==='host')$('session-quality').disabled=false;}
}
$('session-quality').addEventListener('change',()=>{
  const id=$('session-quality').value;
  if(sessionInfo?.role==='controller'&&id==='detail')remoteView.setMode('native');
  if(sessionInfo?.role==='host'){changeHostQuality(id);return;}
  if(!remoteMediaSupport||channel?.readyState!=='open')return;
  $('session-quality').disabled=true;sendControl({type:'media-quality',profile:id});
  qualityRequestTimer=setTimeout(()=>{if(sessionInfo?.role==='controller'){$('session-quality').disabled=false;$('quality-status').textContent='未收到画质切换确认，请重试';}},5000);
});
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('session-panel').requestFullscreen();}catch(e){toast('无法全屏：'+e.message,true);}});
document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'退出全屏':'全屏';});
$('start-share').addEventListener('click',async()=>{
  const button=$('start-share'),starting=sessionInfo;
  if(!starting||starting.role!=='host')return;
  button.disabled=true;localFailure=null;show('error-panel',false);
  try {
    await startSharing({
      isCurrent:()=>sessionInfo===starting,
      prepare:()=>window.bridge.beginHost({requestId:starting.requestId,sessionId:starting.sessionId,grantId}),
      capture:()=>navigator.mediaDevices.getDisplayMedia({video:videoConstraints(activeProfile),audio:$('share-audio').checked}),
      started:media=>{stream=media;return window.bridge.hostStarted({sessionId:starting.sessionId});},
      connect:async media=>{
        await createPeer();
        for(const track of media.getTracks()){
          const sender=peer.addTrack(track,media);
          if(track.kind==='video'){
            track.contentHint=VIDEO_PROFILES[activeProfile].hint;
            const preference=$('share-codec').value,result=applyCodecPreference(peer,sender,preference);
            window.bridge.diagnostic?.({phase:'codec-preference',message:JSON.stringify({preference,...result})}).catch(()=>{});
            if(preference!=='auto'&&!result.applied)toast('所选编码偏好不可用，已沿用系统默认；可在性能详情查看实际编码。');
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
  if(gameMouse.active&&channel.bufferedAmount>8192){gameMouse.fail('输入通道拥塞，已退出游戏鼠标。');return;}
  if(command.type==='move'){
    command={...command,seq:++moveSequence};
    if(!dragging&&pointerChannel?.readyState==='open'){
      if(pointerChannel.bufferedAmount<4096)pointerChannel.send(JSON.stringify(command));
      return;
    }
    if(!dragging&&channel.bufferedAmount>8192)return;
  }
  if(channel.bufferedAmount>1000000){endSession(true);return;}
  channel.send(JSON.stringify(command));
}
function releaseInputs(){heldKeys.clear();dragging=false;if(channel?.readyState==='open'&&sessionInfo?.role==='controller')channel.send(JSON.stringify({type:'release'}));}
async function endSession(notify,reasonCode='user-stop'){
  if(stopping)return;stopping=true;
  try{if(notify)send({type:'disconnect',reasonCode});gameMouse.stop();releaseInputs();await window.bridge.stopHost();sessionInfo=null;document.body.classList.remove('controlling');remoteView.reset();grantId=null;incoming=null;clearInterval(statsTimer);clearTimeout(connectionTimer);clearTimeout(qualityRequestTimer);performanceView.end();if(channel){channel.onclose=null;}if(pointerChannel){pointerChannel.onclose=null;pointerChannel.close();}pointerChannel=null;if(peer){peer.onconnectionstatechange=null;peer.close();}peer=null;if(channel)channel.close();channel=null;if(stream){for(const t of stream.getTracks()){t.onended=null;t.stop();}}stream=null;$('remote-video').srcObject=null;show('stage-placeholder');show('session-panel',false);show('idle-grid');$('connect-button').disabled=!registered;$('rotate').disabled=!registered;$('start-share').disabled=false;if($('incoming-dialog').open)$('incoming-dialog').close();performanceReference=null;if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});}
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
$('settings-form').addEventListener('submit',async event=>{event.preventDefault();if(sessionInfo){toast('请先结束远程会话',true);return;}try{settings=await window.bridge.saveSettings({serverUrl:$('server-url').value.trim(),deviceName:$('device-name').value.trim(),relayOnly:$('relay-only').checked,codecPreference:$('share-codec').value});connectService();toast('设置已保存');tab('home');}catch(e){toast(e.message,true);}});
$('share-codec').addEventListener('change',async()=>{if(sessionInfo)return;try{settings=await window.bridge.saveSettings({...settings,codecPreference:$('share-codec').value});toast('编码偏好已保存，下次共享时生效');}catch(e){$('share-codec').value=settings.codecPreference||'auto';toast(e.message,true);}});
const video=$('remote-video');
function point(event,clamp=false){return normalizedPoint(video.getBoundingClientRect(),video.videoWidth,video.videoHeight,event.clientX,event.clientY,clamp);}
video.addEventListener('mousemove',event=>{if(gameMouse.active)gameMouse.move(event.movementX,event.movementY);});
video.addEventListener('mousedown',event=>{if(!gameMouse.active)return;event.preventDefault();gameMouse.flush();if(!gameMouse.active)return;const button=['left','middle','right'][event.button];if(button)transmit({type:'button',button,state:'down'});});
video.addEventListener('mouseup',event=>{if(!gameMouse.active)return;event.preventDefault();gameMouse.flush();if(!gameMouse.active)return;const button=['left','middle','right'][event.button];if(button)transmit({type:'button',button,state:'up'});});
video.addEventListener('pointermove',event=>{if(gameMouse.active)return;const now=performance.now();if(now-lastMove<8)return;const p=point(event,dragging);if(p){transmit({type:'move',...p});lastMove=now;}});
video.addEventListener('pointerdown',event=>{if(gameMouse.active)return;const p=point(event);if(!p)return;event.preventDefault();video.focus({preventScroll:true});video.setPointerCapture(event.pointerId);dragging=true;transmit({type:'move',...p});const button=['left','middle','right'][event.button];if(button)transmit({type:'button',button,state:'down',...p});});
video.addEventListener('pointerup',event=>{if(gameMouse.active)return;const p=point(event,true);if(p)transmit({type:'move',...p});const button=['left','middle','right'][event.button];if(button)transmit({type:'button',button,state:'up',...(p||{})});dragging=false;});
video.addEventListener('pointercancel',()=>{gameMouse.stop();releaseInputs();});video.addEventListener('contextmenu',event=>event.preventDefault());
video.addEventListener('wheel',event=>{if(gameMouse.active){event.preventDefault();gameMouse.flush();if(gameMouse.active)transmit({type:'wheel',delta:event.deltaY<0?120:-120});return;}if(!point(event))return;event.preventDefault();transmit({type:'wheel',delta:event.deltaY<0?120:-120});},{passive:false});
video.addEventListener('keydown',event=>{if(!$('capture-keys').checked)return;event.preventDefault();if(gameMouse.active){gameMouse.flush();if(!gameMouse.active)return;}if(!event.repeat&&!heldKeys.has(event.code)){heldKeys.add(event.code);transmit({type:'key',code:event.code,state:'down'});}});
video.addEventListener('keyup',event=>{event.preventDefault();if(gameMouse.active)gameMouse.flush();heldKeys.delete(event.code);transmit({type:'key',code:event.code,state:'up'});});
video.addEventListener('blur',()=>{gameMouse.stop();releaseInputs();});window.addEventListener('blur',()=>{gameMouse.stop();releaseInputs();});$('capture-keys').addEventListener('change',()=>{gameMouse.stop();releaseInputs();updateGameUI();});$('view-mode').addEventListener('change',()=>{gameMouse.stop();releaseInputs();});video.addEventListener('resize',updateGameUI);document.addEventListener('visibilitychange',()=>{if(document.hidden){gameMouse.stop();releaseInputs();}});
async function updateStats(){
  if(!sessionInfo)return;const seconds=Math.floor((Date.now()-startedAt)/1000);$('duration').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
  if(!peer||peer.connectionState!=='connected')return;
  const current=peer;
  try{
    const stats=await current.getStats();if(peer!==current||!sessionInfo)return;
    const measured=readPerformanceStats(stats,performanceReference);performanceReference=measured.reference;const sample=measured.sample;if(!sample)return;
    performanceView.update(sample,activeProfile,VIDEO_PROFILES[activeProfile].fps);
    if(performancePeer&&channel?.readyState==='open'&&channel.bufferedAmount<8192)sendControl({type:'performance',version:1,sequence:++performanceSequence,sample});
    const path=(sample.path==='relay'?'TURN 中继':sample.path==='direct'?'直接连接':'已连接')+(sample.transport?' · '+sample.transport.toUpperCase():'');
    $('stats').textContent=`${sample.direction==='send'?'发送 ':''}${sample.width||'—'} × ${sample.height||'—'} · ${Math.round(sample.fps||0)} fps${sample.bitrateMbps!==null?' · '+sample.bitrateMbps.toFixed(1)+' Mbps':''}${sample.rttMs!==null?' · 往返 '+Math.round(sample.rttMs)+' ms':''}`;
    const details=[path];if(sample.codec)details.push(sample.codec.replace('video/','').replace('H264','H.264'));if(sample.bufferMs!==null)details.push('视频缓冲 '+Math.round(sample.bufferMs)+' ms');if(sample.encodeMs!==null)details.push('编码 '+sample.encodeMs.toFixed(1)+' ms');if(sample.decodeMs!==null)details.push('解码 '+sample.decodeMs.toFixed(1)+' ms');
    if(sample.limitation==='cpu')details.push('发送端编码性能受限');if(sample.limitation==='bandwidth')details.push('发送端带宽受限');
    $('session-description').textContent=details.join(' · ');$('stats').title='往返时间是网络 RTT，不是键鼠到画面的总延迟；静止画面可能减少发送帧数。';
    if(Date.now()-lastDiagnostic>10000){lastDiagnostic=Date.now();window.bridge.diagnostic?.({phase:'media-stats',message:JSON.stringify(sample)}).catch(()=>{});}
  }catch{}
}
window.bridge.onEvent(event=>{
  if(event.type==='input-ready'&&sessionInfo?.role==='host'){nativeGameMouse=event.relativeMouse===true;sendMediaState();}
  if(event.type==='force-stop'){
    if(event.reasonCode==='input-failed')failure('Windows 输入组件启动失败：'+event.message,{name:'InputAgentError',message:event.message},'input-component');
    endSession(true,event.reasonCode||'user-stop');
  }
  if(event.type==='input-error')toast('Windows 输入：'+event.message,true);
});
settings=await window.bridge.info();$('server-url').value=settings.serverUrl;$('device-name').value=settings.deviceName;$('relay-only').checked=settings.relayOnly;
$('share-codec').value=isCodecPreference(settings.codecPreference)?settings.codecPreference:'auto';
try{const screens=await window.bridge.screens();$('screen-source').replaceChildren(...screens.map(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.name;return o;}));if(!screens.length){const o=document.createElement('option');o.textContent='未找到可共享屏幕';$('screen-source').append(o);}}catch{$('screen-source').textContent='无法读取屏幕';}
connectService();
