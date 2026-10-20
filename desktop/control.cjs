const { randomUUID } = require('node:crypto');
const { isIP } = require('node:net');
const codes = new Set(['Escape','Tab','CapsLock','Backspace','Enter','Space','ShiftLeft','ShiftRight','ControlLeft','ControlRight','AltLeft','AltRight','MetaLeft','MetaRight','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown','Insert','Delete','Backquote','Minus','Equal','BracketLeft','BracketRight','Backslash','Semicolon','Quote','Comma','Period','Slash','NumLock','NumpadAdd','NumpadSubtract','NumpadMultiply','NumpadDivide','NumpadDecimal','NumpadEnter']);
function validCommand(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
  if (c.type === 'move') return Number.isFinite(c.x) && c.x >= 0 && c.x <= 1 && Number.isFinite(c.y) && c.y >= 0 && c.y <= 1;
  if (c.type === 'button') return ['left','right','middle'].includes(c.button) && ['down','up'].includes(c.state);
  if (c.type === 'wheel') return Number.isInteger(c.delta) && c.delta >= -1200 && c.delta <= 1200 && c.delta !== 0;
  if (c.type === 'key') return typeof c.code === 'string' && (codes.has(c.code) || /^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-2])|Numpad[0-9])$/.test(c.code)) && ['down','up'].includes(c.state);
  return c.type === 'release';
}
function validateServerUrl(value) {
  const url = new URL(value);
  const local = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  const [a,b] = url.hostname.split('.').map(Number);
  const lan = isIP(url.hostname) === 4 && (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
  if (url.username || url.password || url.hash || url.search || (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && (local || lan)))) throw new Error('公网连接请使用 wss://；本机或局域网测试可填写 ws://内网地址:8787');
  url.pathname = '/signal';
  return url.toString();
}
class ControlGate {
  constructor(now = Date.now) { this.now = now; this.pending = null; this.active = null; }
  approve(requestId, sourceId, bounds, viewOnly) {
    if (this.active) throw new Error('本机已有远程会话');
    this.pending = { requestId, sourceId, bounds, viewOnly, grantId: randomUUID(), expires: this.now() + 60000 };
    return this.pending.grantId;
  }
  activate(requestId, sessionId, grantId) {
    const p = this.pending;
    if (!p || this.active || p.requestId !== requestId || p.grantId !== grantId || p.expires < this.now() || typeof sessionId !== 'string' || sessionId.length > 80) throw new Error('本机授权已失效');
    this.pending = null; this.active = { ...p, sessionId }; return this.active;
  }
  permits(sessionId, c) { return !!this.active && !this.active.viewOnly && sessionId === this.active.sessionId && validCommand(c); }
  clear() { this.pending = null; this.active = null; }
}
module.exports = { validCommand, validateServerUrl, ControlGate };
