export const VIDEO_PROFILES = Object.freeze({
  smooth: Object.freeze({label:'流畅优先 · 720p / 60',width:1280,height:720,fps:60,bitrate:8000000,hint:'motion',degradation:'maintain-framerate'}),
  balanced: Object.freeze({label:'高清流畅 · 1080p / 60',width:1920,height:1080,fps:60,bitrate:16000000,hint:'motion',degradation:'maintain-framerate'}),
  detail: Object.freeze({label:'文字清晰 · 原始分辨率 / 30',width:3840,height:2160,fps:30,bitrate:24000000,hint:'text',degradation:'maintain-resolution'})
});
export const DEFAULT_PROFILE = 'balanced';
export function isVideoProfile(id) { return Object.hasOwn(VIDEO_PROFILES,id); }
export function videoConstraints(id,capabilities={}) {
  if(!isVideoProfile(id))throw new Error('未知画质档位');
  const p=VIDEO_PROFILES[id];
  const limit=(value,range)=>Number.isFinite(range?.max)&&range.max>0?Math.min(value,range.max):value;
  const width=limit(p.width,capabilities.width),height=limit(p.height,capabilities.height);
  return {width:{ideal:width,max:width},height:{ideal:height,max:height},frameRate:{ideal:p.fps,max:p.fps}};
}
// Call after SDP negotiation: before it, browsers may return no sender encodings.
export async function applyVideoProfile(sender,id) {
  if(!sender?.track||sender.track.kind!=='video')throw new Error('没有可用的视频发送轨道');
  const constraints=videoConstraints(id,sender.track.getCapabilities?.()),profile=VIDEO_PROFILES[id];
  await sender.track.applyConstraints(constraints);
  sender.track.contentHint=profile.hint;
  const params=sender.getParameters();
  if(!params.encodings?.length)throw new Error('视频协商尚未完成');
  params.degradationPreference=profile.degradation;
  for(const encoding of params.encodings){encoding.maxBitrate=profile.bitrate;encoding.maxFramerate=profile.fps;encoding.scaleResolutionDownBy=1;}
  await sender.setParameters(params);
  return sender.track.getSettings();
}
export function preferLowDelay(receiver) {
  if(!receiver||!('jitterBufferTarget' in receiver))return false;
  try{receiver.jitterBufferTarget=20;return true;}catch{return false;}
}
// Chromium starts video conservatively even when only the maximum budget was
// raised. This optional LAN hint seeds its estimator; congestion control and
// the sender's maxBitrate remain enabled. Never alter audio/RTX/DTLS lines.
export function withLanStartupBitrate(sdp) {
  const newline=sdp.includes('\r\n')?'\r\n':'\n';
  const sections=sdp.split(/(?=^m=)/m);
  return sections.map(section=>{
    if(!section.startsWith('m=video '))return section;
    const lines=section.split(newline),payloads=new Set();
    for(const line of lines){const match=/^a=rtpmap:(\d+) (VP8|VP9|H264|H265|AV1)\/90000$/i.exec(line);if(match)payloads.add(match[1]);}
    for(const payload of payloads){
      const index=lines.findIndex(line=>line.startsWith('a=fmtp:'+payload+' '));
      if(index>=0){const prefix='a=fmtp:'+payload+' ',values=lines[index].slice(prefix.length).split(';').map(value=>value.trim()).filter(value=>value&&!value.startsWith('x-google-start-bitrate='));values.push('x-google-start-bitrate=6000');lines[index]=prefix+values.join(';');}
      else{const index=lines.findIndex(line=>line.startsWith('a=rtpmap:'+payload+' '));lines.splice(index+1,0,'a=fmtp:'+payload+' x-google-start-bitrate=6000');}
    }
    return lines.join(newline);
  }).join('');
}
export function videoMetrics(current,previous) {
  const elapsed=previous&&current.id===previous.id?current.timestamp-previous.timestamp:0;
  const delta=key=>Math.max(0,(current[key]||0)-(previous?.[key]||0));
  const frames=delta('framesDecoded'),emitted=delta('jitterBufferEmittedCount');
  return {
    bitrate:elapsed>0?delta('bytesReceived')*8/elapsed/1000:null,
    bufferMs:elapsed>0&&emitted>0?delta('jitterBufferDelay')/emitted*1000:null,
    decodeMs:elapsed>0&&frames>0?delta('totalDecodeTime')/frames*1000:null
  };
}
