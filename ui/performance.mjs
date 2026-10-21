export const SAMPLE_LIMITS=Object.freeze({width:16384,height:16384,fps:500,captureFps:500,bitrateMbps:10000,rttMs:60000,encodeMs:60000,decodeMs:60000,bufferMs:60000,sendQueueMs:60000,packetLossPct:100,droppedFrames:1000000,availableMbps:10000});
const number=(value,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=max?Math.round(value*1000)/1000:null;
const implementation=value=>typeof value==='string'&&/^[\x20-\x7e]{1,100}$/.test(value)?value:null;
export function normalizePerformanceSample(value){
  if(!value||!['send','receive'].includes(value.direction))return null;
  const result={direction:value.direction};
  for(const [key,max] of Object.entries(SAMPLE_LIMITS))result[key]=number(value[key],max);
  result.codec=typeof value.codec==='string'&&/^video\/[A-Za-z0-9.-]{1,20}$/.test(value.codec)?value.codec:null;
  result.implementation=implementation(value.implementation);
  result.powerEfficient=typeof value.powerEfficient==='boolean'?value.powerEfficient:null;
  result.path=['direct','relay','unknown'].includes(value.path)?value.path:'unknown';
  result.transport=['udp','tcp'].includes(value.transport)?value.transport:null;
  result.limitation=['none','cpu','bandwidth','other'].includes(value.limitation)?value.limitation:null;
  return result;
}
export function readPerformanceStats(stats,previous){
  const all=[...stats.values()],video=all.find(s=>s.type==='inbound-rtp'&&(s.kind||s.mediaType)==='video')||all.find(s=>s.type==='outbound-rtp'&&(s.kind||s.mediaType)==='video');
  if(!video)return {sample:null,reference:null};
  const receiving=video.type==='inbound-rtp',old=previous?.video;
  const elapsed=old?.id===video.id?video.timestamp-old.timestamp:0;
  const delta=key=>elapsed>0&&Number.isFinite(video[key])&&Number.isFinite(old?.[key])&&video[key]>=old[key]?video[key]-old[key]:null;
  const perUnit=(total,count)=>{const t=delta(total),n=delta(count);return t!==null&&n>0?t/n*1000:null;};
  const bytes=delta(receiving?'bytesReceived':'bytesSent'),frames=delta(receiving?'framesDecoded':'framesEncoded');
  const lost=delta('packetsLost'),packets=delta('packetsReceived');
  const transport=stats.get(video.transportId)||all.find(s=>s.type==='transport'&&s.selectedCandidatePairId),pair=stats.get(transport?.selectedCandidatePairId);
  const local=stats.get(pair?.localCandidateId),remote=stats.get(pair?.remoteCandidateId),source=stats.get(video.mediaSourceId),codec=stats.get(video.codecId);
  const sample=normalizePerformanceSample({
    direction:receiving?'receive':'send',width:video.frameWidth,height:video.frameHeight,
    fps:Number.isFinite(video.framesPerSecond)?video.framesPerSecond:elapsed>0&&frames!==null?frames*1000/elapsed:null,
    captureFps:source?.framesPerSecond,bitrateMbps:elapsed>0&&bytes!==null?bytes*8/elapsed/1000:null,
    rttMs:Number.isFinite(pair?.currentRoundTripTime)?pair.currentRoundTripTime*1000:null,
    encodeMs:receiving?null:perUnit('totalEncodeTime','framesEncoded'),decodeMs:receiving?perUnit('totalDecodeTime','framesDecoded'):null,
    bufferMs:receiving?perUnit('jitterBufferDelay','jitterBufferEmittedCount'):null,
    sendQueueMs:receiving?null:perUnit('totalPacketSendDelay','packetsSent'),
    packetLossPct:receiving&&lost!==null&&packets!==null&&lost+packets>0?lost/(lost+packets)*100:null,
    droppedFrames:receiving?delta('framesDropped'):null,
    availableMbps:Number.isFinite(pair?.availableOutgoingBitrate)?pair.availableOutgoingBitrate/1000000:null,
    codec:codec?.mimeType,implementation:receiving?video.decoderImplementation:video.encoderImplementation,
    powerEfficient:receiving?video.powerEfficientDecoder:video.powerEfficientEncoder,
    path:local?.candidateType==='relay'||remote?.candidateType==='relay'?'relay':pair?'direct':'unknown',
    transport:local?.protocol,limitation:receiving?null:video.qualityLimitationReason
  });
  return {sample,reference:{video}};
}
export function performanceAdvice(sender,receiver,targetFps=60){
  const budget=1000/targetFps;
  if(sender?.limitation==='cpu')return '被控端编码性能受限。可在下次共享前对比另一种编码格式，或切到“流畅优先”。';
  if(sender?.limitation==='bandwidth')return '发送端报告带宽受限。可切到“流畅优先”，并检查上传网络或中继出口带宽。';
  if(receiver?.decodeMs>budget)return '控制端解码耗时较高。可降低画质或对比另一种编码格式。';
  if(receiver?.packetLossPct>3)return '当前接收样本丢包较多。可尝试有线网络或更稳定的 Wi-Fi。';
  if(receiver?.bufferMs>80)return '接收画面缓冲较多。可切到“流畅优先”，观察缓冲是否回落。';
  if((receiver?.rttMs??sender?.rttMs)>100)return '网络往返时间较高。直连路径、两端线路或中继位置会影响操作响应。';
  return '当前样本未显示明显瓶颈。分项耗时与网络往返时间均不是操作到画面的总延迟。';
}
