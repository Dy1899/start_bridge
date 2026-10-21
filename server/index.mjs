import http from 'node:http';
import { randomInt, randomUUID, timingSafeEqual, createHmac } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { pathToFileURL } from 'node:url';

export function turnConfiguration(env = process.env) {
  const urls = (env.TURN_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
  const iceServers = [];
  if (env.STUN_URL) iceServers.push({ urls: env.STUN_URL });
  if (urls.length && env.TURN_SECRET) {
    const username = `${Math.floor(Date.now() / 1000) + 3600}:${randomUUID()}`;
    iceServers.push({ urls, username, credential: createHmac('sha1', env.TURN_SECRET).update(username).digest('base64') });
  }
  return iceServers;
}

export function createSignalingServer(options = {}) {
  const env = options.env || process.env;
  const peers = new Map(), sessions = new Map(), attempts = new Map();
  const requestTimeout = options.requestTimeout || 45000;
  const maxPeers = options.maxPeers || 200;
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, version: '0.1.5', turnConfigured: !!env.TURN_SECRET && !!env.TURN_URLS }));
    } else { res.writeHead(404); res.end('Not found'); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024, perMessageDeflate: false });
  const send = (peer, message) => { if (peer?.ws.readyState === WebSocket.OPEN) peer.ws.send(JSON.stringify(message)); };
  function clearRequest(request, reason = '请求已结束') {
    if (!request) return;
    clearTimeout(request.timer);
    for (const p of [request.host, request.controller]) {
      if (p.pending === request) p.pending = null;
      send(p, { type: 'request.ended', requestId: request.id, reason });
    }
  }
  function endSession(peer, reason = '连接已结束') {
    const s = sessions.get(peer.sessionId);
    if (!s) return;
    sessions.delete(s.id);
    for (const member of [s.host, s.controller]) {
      member.sessionId = null;
      send(member, { type: 'session.ended', sessionId: s.id, reason });
    }
  }
  function credentials(peer) {
    peer.secret = String(randomInt(10000000, 100000000));
    send(peer, { type: 'registered', peerId: peer.id, secret: peer.secret, turnConfigured: !!env.TURN_SECRET && !!env.TURN_URLS });
  }
  function rateAllowed(ip) {
    const now = Date.now();
    let bucket = attempts.get(ip);
    if (!bucket || now - bucket.start > 60000) { bucket = { start: now, count: 0 }; attempts.set(ip, bucket); }
    return ++bucket.count <= 10;
  }
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/signal' || peers.size >= maxPeers) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const ip = req.socket.remoteAddress || 'unknown';
    if ([...peers.values()].filter(p => p.ip === ip).length >= 20) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws, req) => {
    let id;
    do { id = String(randomInt(100000000, 1000000000)); } while (peers.has(id));
    const peer = { id, ws, ip: req.socket.remoteAddress, name: 'Windows 电脑', pending: null, sessionId: null, alive: true, registered: false, windowStart: Date.now(), messages: 0 };
    peers.set(id, peer);
    const registrationTimer = setTimeout(() => { if (!peer.registered) ws.close(1008, 'Registration required'); }, 10000);
    ws.on('pong', () => { peer.alive = true; });
    ws.on('error', () => {});
    ws.on('message', (bytes, binary) => {
      if (binary) { ws.close(1003); return; }
      if (Date.now() - peer.windowStart > 1000) { peer.windowStart = Date.now(); peer.messages = 0; }
      if (++peer.messages > 100) { ws.close(1008, 'Rate limit'); return; }
      let m;
      try { m = JSON.parse(bytes.toString()); } catch { send(peer, { type: 'error', message: '消息格式不正确' }); return; }
      if (!m || typeof m !== 'object' || Array.isArray(m)) return;
      const fail = message => send(peer, { type: 'error', message });
      switch (m.type) {
        case 'register':
          if (peer.registered) return;
          peer.registered = true; clearTimeout(registrationTimer);
          peer.name = String(m.name || 'Windows 电脑').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 40);
          credentials(peer); break;
        case 'rotate':
          if (peer.registered && !peer.pending && !peer.sessionId) credentials(peer);
          break;
        case 'connect': {
          if (!peer.registered || peer.pending || peer.sessionId) { fail('当前已有连接或待处理请求'); break; }
          if (!rateAllowed(peer.ip)) { fail('尝试次数过多，请一分钟后再试'); break; }
          const target = peers.get(String(m.peerId || ''));
          const supplied = Buffer.from(String(m.secret || '').slice(0, 32));
          const actual = Buffer.from(target?.secret || '00000000');
          const correct = actual.length === supplied.length && timingSafeEqual(actual, supplied);
          if (!target?.registered || !correct || target === peer) { fail('设备识别码或访问码不正确'); break; }
          if (target.pending || target.sessionId) { fail('对方正在连接中'); break; }
          const request = { id: randomUUID(), host: target, controller: peer };
          request.timer = setTimeout(() => clearRequest(request, '对方未响应，连接请求已超时'), requestTimeout);
          peer.pending = target.pending = request;
          send(peer, { type: 'request.pending', requestId: request.id });
          send(target, { type: 'request.incoming', requestId: request.id, controllerName: peer.name });
          break;
        }
        case 'respond': {
          const request = peer.pending;
          if (!request || request.host !== peer || m.requestId !== request.id) { fail('请求已失效'); break; }
          if (m.accepted !== true) { clearRequest(request, '对方拒绝了本次连接'); break; }
          clearTimeout(request.timer); request.host.pending = request.controller.pending = null;
          const s = { id: randomUUID(), host: peer, controller: request.controller, viewOnly: m.viewOnly === true };
          sessions.set(s.id, s);
          const iceServers = turnConfiguration(env);
          for (const [member, role, other] of [[s.host, 'host', s.controller], [s.controller, 'controller', s.host]]) {
            member.sessionId = s.id;
            send(member, { type: 'session.ready', sessionId: s.id, requestId: request.id, role, peerName: other.name, viewOnly: s.viewOnly, iceServers });
          }
          credentials(peer);
          break;
        }
        case 'signal': {
          const s = sessions.get(peer.sessionId);
          if (!s || m.sessionId !== s.id) { fail('尚未建立授权会话'); break; }
          const payload = m.payload;
          if (!payload || typeof payload !== 'object' || !['offer','answer','candidate'].includes(payload.kind)) return;
          if (payload.kind === 'offer' && peer !== s.host) return;
          if (payload.kind === 'answer' && peer !== s.controller) return;
          send(peer === s.host ? s.controller : s.host, { type: 'signal', sessionId: s.id, payload });
          break;
        }
        case 'disconnect': {
          const reasons={'share-start-failed':'对方开始共享时失败，请查看被控端的错误提示','session-failed':'对方建立画面连接时失败','capture-ended':'对方停止了屏幕共享','input-failed':'对方的 Windows 输入组件启动失败，请查看被控端提示'};
          endSession(peer,reasons[m.reasonCode]||'对方结束了连接');
          clearRequest(peer.pending,'连接请求已取消');
          break;
        }
        case 'cancel': clearRequest(peer.pending, '连接请求已取消'); break;
        default: fail('不支持的消息');
      }
    });
    ws.on('close', () => { clearTimeout(registrationTimer); clearRequest(peer.pending, '对方已离线'); endSession(peer, '对方已离线'); peers.delete(peer.id); });
  });
  const heartbeat = setInterval(() => {
    for (const peer of peers.values()) {
      if (!peer.alive) { peer.ws.terminate(); continue; }
      peer.alive = false; peer.ws.ping();
    }
    for (const [ip, bucket] of attempts) if (Date.now() - bucket.start > 120000) attempts.delete(ip);
  }, 15000);
  heartbeat.unref();
  return {
    server, peers, sessions,
    listen: (port = 8787, host = '127.0.0.1') => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => resolve(server.address())); }),
    close: async () => { clearInterval(heartbeat); for (const p of peers.values()) p.ws.terminate(); await new Promise(r => wss.close(r)); await new Promise(r => server.close(r)); }
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const service = createSignalingServer();
  const address = await service.listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1');
  console.log(`StarBridge signaling: ${address.address}:${address.port}`);
  console.log(`TURN relay: ${process.env.TURN_URLS && process.env.TURN_SECRET ? 'configured' : 'not configured (local/direct only)'}`);
  for (const sig of ['SIGINT','SIGTERM']) process.on(sig, () => { service.close().finally(() => process.exit()); });
}
