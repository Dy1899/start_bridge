export class ShareCancelledError extends Error { constructor(){super('连接已结束，未继续共享');this.name='AbortError';} }
export async function startSharing({prepare,capture,started,connect,cleanup,isCurrent=()=>true}) {
  let media;
  const check=()=>{if(!isCurrent())throw new ShareCancelledError();};
  try {
    check();await prepare();check();
    media=await capture();check();
    if(!media?.getVideoTracks().length)throw new Error('没有获得屏幕视频轨道');
    await started(media);check();
    await connect(media);check();
    return media;
  } catch(error) {
    if(media)for(const track of media.getTracks())track.stop();
    await Promise.resolve().then(()=>cleanup(error)).catch(()=>{});
    throw error;
  }
}
export function describeShareError(error) {
  const name=error?.name||'Error',message=String(error?.message||error||'未知错误');
  let hint='';
  if(name==='InvalidStateError')hint='请将被控端窗口切到前台，再重新点击开始共享。';
  else if(name==='NotAllowedError')hint='屏幕采集被拒绝，请查看 data/logs 中的权限检查记录。';
  else if(name==='NotReadableError')hint='Windows 未能读取屏幕，请确认桌面未锁定。';
  else if(name==='NotFoundError')hint='所选屏幕已不可用，请重新选择屏幕。';
  return '无法开始共享：'+name+' — '+message+(hint?' '+hint:'');
}
