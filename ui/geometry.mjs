export function normalizedPoint(rect,videoWidth,videoHeight,clientX,clientY,clamp=false){
  if(!videoWidth||!videoHeight||!rect.width||!rect.height)return null;
  const scale=Math.min(rect.width/videoWidth,rect.height/videoHeight),width=videoWidth*scale,height=videoHeight*scale;
  const x=(clientX-rect.left-(rect.width-width)/2)/width,y=(clientY-rect.top-(rect.height-height)/2)/height;
  if(!clamp&&(x<0||x>1||y<0||y>1))return null;
  return{x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y))};
}
