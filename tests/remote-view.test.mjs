import test from 'node:test';
import assert from 'node:assert/strict';
import {viewLayout} from '../ui/remote-view.mjs';
import {normalizedPoint} from '../ui/geometry.mjs';
test('native video has one screen pixel per decoded pixel at common Windows display scales',()=>{
  for(const dpr of [1,1.25,1.5,2]){
    const v=viewLayout(1920,1080,900,600,'native',dpr);assert.equal(v.videoWidth*dpr,1920);assert.equal(v.videoHeight*dpr,1080);assert.equal(v.percent,100);
    const zoom=viewLayout(1920,1080,900,600,'200',dpr);assert.equal(zoom.videoWidth*dpr,3840);assert.equal(zoom.percent,200);
  }
});
test('fit uses the available area while native mode allows scrolling, without distorting aspect ratio',()=>{
  const fit=viewLayout(1920,1080,1000,500,'fit');assert.equal(fit.videoHeight,500);assert.equal(fit.surfaceWidth,1000);assert.equal(fit.surfaceHeight,500);assert.ok(fit.left>0);assert.equal(fit.top,0);
  const native=viewLayout(1920,1080,1000,500,'native');assert.equal(native.surfaceWidth,1920);assert.equal(native.surfaceHeight,1080);assert.equal(native.left,0);
  assert.equal(viewLayout(0,1080,1000,500),null);assert.equal(viewLayout(1920,1080,0,500),null);assert.deepEqual(viewLayout(1920,1080,1000,500,'invalid'),fit);
});
test('mouse coordinates remain correct after zooming and scrolling to a partly visible video',()=>{
  for(const mode of ['native','150','200'])for(const dpr of [1,1.25,2]){
    const v=viewLayout(1920,1080,800,400,mode,dpr),scrollX=150,scrollY=100;
    const rect={left:20+v.left-scrollX,top:60+v.top-scrollY,width:v.videoWidth,height:v.videoHeight};
    const point=normalizedPoint(rect,1920,1080,rect.left+v.videoWidth*0.25,rect.top+v.videoHeight*0.75);
    assert.ok(Math.abs(point.x-0.25)<1e-10);assert.ok(Math.abs(point.y-0.75)<1e-10);
    assert.equal(normalizedPoint(rect,1920,1080,rect.left-1,rect.top-1),null);
  }
});
