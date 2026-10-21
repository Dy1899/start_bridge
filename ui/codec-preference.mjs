export const CODEC_PREFERENCES=Object.freeze({auto:'自动（系统默认）',h264:'H.264 优先',vp8:'VP8 兼容模式'});
export function isCodecPreference(value){return Object.hasOwn(CODEC_PREFERENCES,value);}
export function orderVideoCodecs(codecs,preference){
  if(!isCodecPreference(preference))throw new Error('未知编码偏好');
  if(!Array.isArray(codecs))return [];
  if(preference==='auto')return [...codecs];
  const mime=preference==='h264'?'video/h264':'video/vp8';
  const preferred=codecs.filter(c=>c.mimeType?.toLowerCase()===mime);
  // Keep all other formats and repair codecs so an older peer can fall back.
  if(preference==='h264')preferred.sort((a,b)=>Number(/packetization-mode=1(?:;|$)/.test(b.sdpFmtpLine||''))-Number(/packetization-mode=1(?:;|$)/.test(a.sdpFmtpLine||'')));
  return [...preferred,...codecs.filter(c=>c.mimeType?.toLowerCase()!==mime)];
}
export function applyCodecPreference(peer,sender,preference,capabilities){
  if(!isCodecPreference(preference))throw new Error('未知编码偏好');
  if(preference==='auto')return {applied:false,reason:'automatic'};
  if(capabilities===undefined){try{capabilities=globalThis.RTCRtpSender?.getCapabilities?.('video');}catch(error){return {applied:false,reason:'rejected',message:String(error.message).slice(0,150)};}}
  const codecs=capabilities?.codecs||[],mime=preference==='h264'?'video/h264':'video/vp8';
  const transceiver=(peer.getTransceivers?.()||[]).find(t=>t.sender===sender);
  if(!transceiver?.setCodecPreferences||!codecs.some(c=>c.mimeType?.toLowerCase()===mime))return {applied:false,reason:'unsupported'};
  try{transceiver.setCodecPreferences(orderVideoCodecs(codecs,preference));return {applied:true,reason:'preferred'};}
  catch(error){return {applied:false,reason:'rejected',message:String(error.message).slice(0,150)};}
}
