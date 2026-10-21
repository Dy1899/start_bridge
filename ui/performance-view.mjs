import {normalizePerformanceSample,performanceAdvice} from './performance.mjs';
import {codecPath} from './codec-status.mjs';
const metric=(value,unit,digits=1)=>Number.isFinite(value)?value.toFixed(digits)+' '+unit:'未提供';
const codec=value=>value?.replace(/^video\//,'').replace('H264','H.264')||'未提供';
const efficient=value=>value===true?'是':value===false?'否':'未提供';
export class PerformanceView{
  constructor(document,saveReport,toast,now=Date.now){
    this.document=document;this.saveReport=saveReport;this.toast=toast;this.now=now;this.history=[];this.active=false;
    for(const id of ['save-performance','save-last-performance'])document.getElementById(id).addEventListener('click',()=>this.save());
    const panel=document.getElementById('performance-panel');
    document.getElementById('close-performance').addEventListener('click',()=>{
      panel.open=false;panel.scrollTop=0;
      document.getElementById('performance-summary').focus({preventScroll:true});
    });
    panel.addEventListener('toggle',()=>{if(!panel.open)panel.scrollTop=0;});
  }
  text(id,value){this.document.getElementById(id).textContent=value;}
  start(role,profile,codecPreference){this.role=role;this.profile=profile;this.codecPreference=codecPreference;this.targetFps=null;this.local=null;this.remote=null;this.remoteAt=0;this.remoteSequence=0;this.history=[];this.active=true;this.document.getElementById('save-last-performance').classList.toggle('hidden',true);this.render();}
  update(sample,profile,targetFps){
    if(!this.active)return;this.local=normalizePerformanceSample(sample);this.profile=profile;this.targetFps=targetFps;
    this.history.push({at:this.now(),profile,local:this.local,remote:this.freshRemote()});if(this.history.length>60)this.history.shift();
    this.render();
  }
  acceptRemote(value,sequence){
    if(!this.active||!Number.isSafeInteger(sequence)||sequence<=this.remoteSequence)return false;
    const sample=normalizePerformanceSample(value);if(!sample||sample.direction!==(this.role==='host'?'receive':'send'))return false;
    this.remote=sample;this.remoteSequence=sequence;this.remoteAt=this.now();this.render();return true;
  }
  freshRemote(){return this.remote&&this.now()-this.remoteAt<=6000?this.remote:null;}
  render(){
    const remote=this.freshRemote(),sender=this.role==='host'?this.local:remote,receiver=this.role==='controller'?this.local:remote;
    this.text('perf-codec',codec(receiver?.codec||sender?.codec));
    this.text('perf-encode',metric(sender?.encodeMs,'ms / 帧'));
    this.text('perf-decode',metric(receiver?.decodeMs,'ms / 帧'));
    this.text('perf-buffer',metric(receiver?.bufferMs,'ms'));
    this.text('perf-capture',metric(sender?.captureFps,'fps',0));
    this.text('perf-loss',metric(receiver?.packetLossPct,'%',1));
    this.text('perf-queue',metric(sender?.sendQueueMs,'ms / 包',2));
    this.text('perf-encoder',sender?.implementation||'浏览器未提供');
    this.text('perf-decoder',receiver?.implementation||'浏览器未提供');
    this.text('perf-efficient','编码 '+efficient(sender?.powerEfficient)+' / 解码 '+efficient(receiver?.powerEfficient));
    this.text('perf-encode-path',codecPath(sender).label);this.text('perf-decode-path',codecPath(receiver).label);
    this.text('perf-frame-interval',metric(receiver?.frameIntervalMs,'ms / 帧'));
    this.text('perf-frame-jitter',metric(receiver?.frameJitterMs,'ms'));
    this.text('performance-advice',performanceAdvice(sender,receiver,this.targetFps||60));
    this.text('performance-peer-status',remote?'已收到对方性能统计':'尚未收到对方的当前统计；两端升级后可查看完整链路。');
    this.document.getElementById('save-performance').disabled=!this.history.length;
  }
  end(){this.active=false;this.document.getElementById('save-last-performance').classList.toggle('hidden',!this.history.length);}
  report(){return {role:this.role,profile:this.profile,codecPreference:this.codecPreference,samples:this.history.map(row=>({...row,local:normalizePerformanceSample(row.local),remote:normalizePerformanceSample(row.remote)}))};}
  async save(){
    if(!this.history.length){this.toast('连接并收到画面后才能保存性能报告',true);return;}
    try{const result=await this.saveReport(this.report());this.toast('性能报告已保存到程序目录 data/reports：'+result.name);}
    catch(error){this.toast('保存报告失败：'+error.message,true);}
  }
}
