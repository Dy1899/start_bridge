const LIMITS={width:16384,height:16384,fps:500,captureFps:500,bitrateMbps:10000,rttMs:60000,encodeMs:60000,decodeMs:60000,bufferMs:60000,sendQueueMs:60000,frameIntervalMs:60000,frameJitterMs:60000,packetLossPct:100,droppedFrames:1000000,availableMbps:10000};
const profiles=['smooth','balanced','detail'];
function sanitizeSample(value){
  if(!value||!['send','receive'].includes(value.direction))return null;
  const out={direction:value.direction};
  for(const [key,max]of Object.entries(LIMITS))out[key]=typeof value[key]==='number'&&Number.isFinite(value[key])&&value[key]>=0&&value[key]<=max?Math.round(value[key]*1000)/1000:null;
  out.codec=typeof value.codec==='string'&&/^video\/[A-Za-z0-9.-]{1,20}$/.test(value.codec)?value.codec:null;
  out.implementation=typeof value.implementation==='string'&&/^[\x20-\x7e]{1,100}$/.test(value.implementation)?value.implementation:null;
  out.powerEfficient=typeof value.powerEfficient==='boolean'?value.powerEfficient:null;
  out.path=['direct','relay','unknown'].includes(value.path)?value.path:'unknown';out.transport=['udp','tcp'].includes(value.transport)?value.transport:null;
  out.limitation=['none','cpu','bandwidth','other'].includes(value.limitation)?value.limitation:null;
  return out;
}
function buildPerformanceReport(value,{version,now=Date.now()}={}){
  if(!value||!['host','controller'].includes(value.role)||!Array.isArray(value.samples)||!value.samples.length||value.samples.length>60)throw new Error('性能报告格式无效');
  if(JSON.stringify(value).length>131072)throw new Error('性能报告过大');
  const samples=value.samples.map(row=>{
    if(!row||typeof row.at!=='number'||!Number.isFinite(row.at)||row.at<0||row.at>1e15)throw new Error('性能采样时间无效');
    const local=sanitizeSample(row.local),remote=sanitizeSample(row.remote);
    if(!local||local.direction!==(value.role==='host'?'send':'receive')||(remote&&remote.direction===local.direction))throw new Error('性能采样方向无效');
    return {at:row.at,profile:profiles.includes(row.profile)?row.profile:'balanced',local,remote};
  });
  return {format:'starbridge-performance-v1',appVersion:version,createdAt:new Date(now).toISOString(),role:value.role,profile:profiles.includes(value.profile)?value.profile:'balanced',codecPreference:['auto','h264','vp8'].includes(value.codecPreference)?value.codecPreference:'auto',notice:'分项统计不是操作到画面的总延迟；未知字段保留为空。',samples};
}
module.exports={buildPerformanceReport,sanitizeSample};
