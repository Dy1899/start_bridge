import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { allowCapturePermission } = createRequire(import.meta.url)('../desktop/capture-permissions.cjs');
const wc = {}, uiUrl = 'file:///C:/StarBridge/ui/index.html';
const base = { phase:'request', permission:'media', details:{ requestingUrl:uiUrl, isMainFrame:true, mediaTypes:[] }, webContents:wc, expectedWebContents:wc, uiUrl, armed:true, electronMajor:44 };

test('Electron 44 display capture uses media with an empty device list', () => {
  assert.equal(allowCapturePermission(base), true);
});
test('camera, microphone and combined device requests stay denied', () => {
  for (const mediaTypes of [['video'], ['audio'], ['audio','video'], ['unknown']]) {
    assert.equal(allowCapturePermission({ ...base, details:{ ...base.details, mediaTypes } }), false);
  }
});
test('newer Electron accepts display-capture but never legacy media', () => {
  assert.equal(allowCapturePermission({ ...base, electronMajor:45 }), false);
  assert.equal(allowCapturePermission({ ...base, electronMajor:45, permission:'display-capture', details:{ ...base.details, mediaTypes:['video','audio'] } }), true);
});
test('capture requires an armed local approval and the exact main window document', () => {
  assert.equal(allowCapturePermission({ ...base, armed:false }), false);
  assert.equal(allowCapturePermission({ ...base, webContents:{} }), false);
  assert.equal(allowCapturePermission({ ...base, expectedWebContents:null }), false);
  assert.equal(allowCapturePermission({ ...base, details:{ ...base.details, isMainFrame:false } }), false);
  assert.equal(allowCapturePermission({ ...base, details:{ ...base.details, requestingUrl:'https://other.example' } }), false);
});
test('missing device metadata and unrelated permissions are denied', () => {
  for (const details of [null, {}, { requestingUrl:uiUrl, isMainFrame:true }]) {
    assert.equal(allowCapturePermission({ ...base, details }), false);
  }
  for (const permission of ['clipboard-read','geolocation','notifications']) {
    assert.equal(allowCapturePermission({ ...base, permission }), false);
  }
});
test('media checks never pre-grant camera or microphone access', () => {
  for (const mediaType of ['video','audio','unknown',undefined]) {
    assert.equal(allowCapturePermission({ ...base, phase:'check', details:{ ...base.details, mediaType } }), false);
  }
  assert.equal(allowCapturePermission({ ...base, phase:'check', permission:'display-capture' }), true);
});
