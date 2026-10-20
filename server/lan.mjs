import { networkInterfaces } from 'node:os';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import { createSignalingServer } from './index.mjs';

export function localAddresses(interfaces = networkInterfaces(), port = 8787) {
  const addresses = [], seen = new Set();
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (entry.internal || entry.family !== 'IPv4' || isIP(entry.address) !== 4) continue;
      const [a,b] = entry.address.split('.').map(Number);
      if (!(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))) continue;
      if (seen.has(entry.address)) continue;
      seen.add(entry.address);
      addresses.push({ name, url:`ws://${entry.address}:${port}` });
    }
  }
  return addresses;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const service = createSignalingServer();
  try {
    const address = await service.listen(Number(process.env.PORT || 8787), '0.0.0.0');
    console.log('\n星桥远控 · 局域网连接服务已启动\n');
    console.log('请保持此窗口打开，只需在一台电脑启动这个服务。');
    console.log('两台电脑的“连接设置”都填写下面同一个地址：\n');
    for (const entry of localAddresses(undefined, address.port)) console.log(`  ${entry.name}:  ${entry.url}`);
    console.log('\n有多个地址时，选择当前连接路由器的 Wi-Fi 或以太网地址。');
    console.log('同机测试仍可使用 ws://127.0.0.1:' + address.port);
    console.log('此入口用于你信任的局域网；异地连接请使用部署文件中的 HTTPS 入口。');
    console.log('按 Ctrl+C 关闭服务。\n');
    for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>service.close().finally(()=>process.exit()));
  } catch (error) {
    if (error.code === 'EADDRINUSE') console.error('8787 端口正在使用。请先关闭之前的本机服务或局域网服务窗口，再启动。');
    else console.error('服务启动失败：' + error.message);
    process.exitCode = 1;
    await service.close().catch(()=>{});
  }
}
