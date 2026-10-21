export const VIEW_MODES=Object.freeze({fit:'适应窗口',native:'原始大小（1:1）','150':'放大 150%','200':'放大 200%'});
// CSS dimensions. Native mode maps one decoded pixel to one screen pixel,
// including on Windows displays with 125%, 150% or 200% scaling.
export function viewLayout(width,height,viewportWidth,viewportHeight,mode='fit',dpr=1){
  if(![width,height,viewportWidth,viewportHeight].every(n=>Number.isFinite(n)&&n>0))return null;
  if(!Object.hasOwn(VIEW_MODES,mode))mode='fit';
  if(!Number.isFinite(dpr)||dpr<=0)dpr=1;
  const scale=mode==='fit'?Math.min(viewportWidth/width,viewportHeight/height):(mode==='native'?1:Number(mode)/100)/dpr;
  const videoWidth=width*scale,videoHeight=height*scale;
  return {videoWidth,videoHeight,surfaceWidth:Math.max(viewportWidth,videoWidth),surfaceHeight:Math.max(viewportHeight,videoHeight),left:Math.max(0,(viewportWidth-videoWidth)/2),top:Math.max(0,(viewportHeight-videoHeight)/2),percent:scale*dpr*100};
}
export class RemoteView{
  constructor(document){
    this.document=document;this.stage=document.getElementById('remote-stage');this.video=document.getElementById('remote-video');this.surface=document.getElementById('remote-surface');this.select=document.getElementById('view-mode');this.status=document.getElementById('view-status');this.mode='fit';
    for(const value of ['fit','native','150','200']){const option=document.createElement('option');option.value=value;option.textContent=VIEW_MODES[value];this.select.append(option);}
    this.select.value='fit';this.select.addEventListener('change',()=>this.setMode(this.select.value));
    this.video.addEventListener('resize',()=>this.render());this.video.addEventListener('loadedmetadata',()=>this.render());
    this.observer=new ResizeObserver(()=>{if(this.frame)return;this.frame=document.defaultView.requestAnimationFrame(()=>{this.frame=null;this.render();});});this.observer.observe(this.stage);document.defaultView.addEventListener('resize',()=>this.render());
  }
  setMode(mode){if(!Object.hasOwn(VIEW_MODES,mode))return;this.mode=mode;this.select.value=mode;this.render(true);}
  reset(){this.mode='fit';this.select.value='fit';this.layout=null;this.stage.scrollLeft=0;this.stage.scrollTop=0;this.status.textContent='等待画面';}
  render(preserveCenter=false){
    const stage=this.stage,video=this.video,previous=this.layout;
    const center=previous?{x:(stage.scrollLeft+stage.clientWidth/2-previous.left)/previous.videoWidth,y:(stage.scrollTop+stage.clientHeight/2-previous.top)/previous.videoHeight}:{x:0.5,y:0.5};
    const layout=viewLayout(video.videoWidth,video.videoHeight,stage.clientWidth,stage.clientHeight,this.mode,this.document.defaultView.devicePixelRatio);
    if(!layout)return;
    this.layout=layout;
    Object.assign(this.surface.style,{width:layout.surfaceWidth+'px',height:layout.surfaceHeight+'px'});
    Object.assign(video.style,{width:layout.videoWidth+'px',height:layout.videoHeight+'px',left:layout.left+'px',top:layout.top+'px'});
    if(this.mode==='fit'){stage.scrollLeft=0;stage.scrollTop=0;}
    else if(preserveCenter){stage.scrollLeft=layout.left+center.x*layout.videoWidth-stage.clientWidth/2;stage.scrollTop=layout.top+center.y*layout.videoHeight-stage.clientHeight/2;}
    const enlarged=layout.surfaceWidth>stage.clientWidth+1||layout.surfaceHeight>stage.clientHeight+1;
    this.status.textContent=`实际 ${video.videoWidth} × ${video.videoHeight} · 显示 ${Math.round(layout.percent)}%`+(enlarged?' · 可拖动滚动条查看边缘':this.mode==='fit'&&layout.percent<95?' · 小字可选“原始大小”':'');
  }
}
