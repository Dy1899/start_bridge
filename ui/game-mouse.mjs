export class GameMouse{
  constructor({document,video,canStart,send,release,onState=()=>{},onError=()=>{},schedule=(fn,ms)=>setTimeout(fn,ms),cancel=id=>clearTimeout(id)}){
    Object.assign(this,{document,video,canStart,send,release,onState,onError,schedule,cancel});this.active=false;this.pending=false;this.generation=0;this.dx=0;this.dy=0;this.sensitivity=1;
    document.addEventListener('pointerlockchange',()=>this.lockChanged());
    document.addEventListener('pointerlockerror',()=>{if(this.pending&&!this.awaitingPromise)this.fail('鼠标锁定未获允许，请点击“游戏鼠标”重试。');});
  }
  async start(){
    if(this.active||this.pending||!this.canStart())return false;
    if(typeof this.video.requestPointerLock!=='function'){this.onError('当前环境不支持游戏鼠标锁定。');return false;}
    this.pending=true;this.rawRequested=true;this.awaitingPromise=true;const generation=++this.generation;this.onState();
    try{
      try{await this.video.requestPointerLock({unadjustedMovement:true});}
      catch(error){if(error.name!=='NotSupportedError')throw error;if(generation!==this.generation||!this.pending)return false;this.rawRequested=false;await this.video.requestPointerLock();}
      if(generation!==this.generation||!this.canStart()){if(this.document.pointerLockElement===this.video)this.document.exitPointerLock();return false;}
      // Older implementations return void and signal success only by event.
      if(this.document.pointerLockElement===this.video)this.lockChanged();
      return true;
    }catch(error){if(generation===this.generation)this.fail('无法开启游戏鼠标：'+error.message);return false;}
    finally{if(generation===this.generation)this.awaitingPromise=false;}
  }
  lockChanged(){
    if(this.document.pointerLockElement!==this.video){if(this.active||this.pending)this.stop();return;}
    if(this.active)return;
    if(!this.pending||!this.canStart()){this.document.exitPointerLock();return;}
    this.release();
    if(!this.send({type:'input-mode',mode:'relative'})){this.fail('连接未就绪，未开启游戏鼠标。');return;}
    this.pending=false;this.active=true;this.video.focus({preventScroll:true});this.onState();
  }
  move(dx,dy){
    if(!this.active||!this.canStart())return;
    if(!Number.isFinite(dx)||!Number.isFinite(dy)||Math.abs(dx)>8192||Math.abs(dy)>8192)return;
    this.dx+=dx*this.sensitivity;this.dy+=dy*this.sensitivity;
    if(Math.abs(this.dx)>8192||Math.abs(this.dy)>8192){this.fail('鼠标输入积压，已退出游戏鼠标。');return;}
    if(!this.timer)this.timer=this.schedule(()=>{this.timer=null;this.flush();},8);
  }
  flush(){
    if(this.timer){this.cancel(this.timer);this.timer=null;}
    if(!this.active)return;
    if(!this.canStart()){this.stop();return;}
    let dx=Math.trunc(this.dx),dy=Math.trunc(this.dy);this.dx-=dx;this.dy-=dy;
    while(dx||dy){const x=Math.max(-2048,Math.min(2048,dx)),y=Math.max(-2048,Math.min(2048,dy));
      if(!this.send({type:'relative',dx:x,dy:y})){this.fail('输入通道拥塞，已退出游戏鼠标。');return;}dx-=x;dy-=y;
    }
  }
  stop(){
    const wasActive=this.active;this.active=false;this.pending=false;this.awaitingPromise=false;this.generation++;
    if(this.timer)this.cancel(this.timer);this.timer=null;this.dx=0;this.dy=0;
    if(wasActive){this.release();this.send({type:'input-mode',mode:'absolute'});}
    if(this.document.pointerLockElement===this.video)this.document.exitPointerLock();this.onState();
  }
  fail(message){this.stop();this.onError(message);}
}
