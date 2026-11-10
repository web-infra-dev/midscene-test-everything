import { createRequire } from 'node:module';
// Manual UI verification fixture: no Bluetooth, camera, phone or model access.
import { fileURLToPath } from 'node:url';
import { PlaygroundServer } from '@midscene/playground';
import { DeviceWorkspaces } from '../../dist/workspaces.js';
import { SimulatedManager } from './simulated-workspaces.ts';
const sharp = createRequire(import.meta.resolve('@midscene/ios-hid'))('sharp');
const staticPath = fileURLToPath(new URL('../../dist/ui/', import.meta.url));
const managers = [];
const workspaces = new DeviceWorkspaces(
  staticPath,
  () => {
    const manager = new SimulatedManager();
    managers.push(manager);
    return manager;
  },
  false,
);
const server = new PlaygroundServer(undefined, staticPath, 'ios-hid-ui-test');
const sources = ['a', 'b', 'c'].map((id) => ({
  id: `usb-${id}`,
  name: `模拟 iPhone ${id.toUpperCase()}`,
}));
server.app.get(
  '/ios-hid/workspaces/:id/ios-hid/discover/:source',
  (_req, res) => res.json(sources),
);
server.app.get(
  '/ios-hid/workspaces/:id/ios-hid/bluetooth/events',
  (_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
    });
    res.write(
      `data: ${JSON.stringify({ serviceName: 'Midscene（模拟）', state: 'connected', hosts: sources.map((item, index) => ({ id: `bt-${['a', 'b', 'c'][index]}`, name: item.name, reports: [1, 2, 3] })) })}\n\n`,
    );
  },
);
workspaces.mount(server);
const port = Number(process.env.PREVIEW_PORT ?? 5827);
await server.launch(port);
for (const [index, id] of ['a', 'b'].entries()) {
  const workspace = await workspaces.create();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800"><rect width="400" height="800" fill="#f6f7f9"/><text x="32" y="60" font-family="Arial" font-size="16" fill="#666">9:41</text><text x="32" y="150" font-family="Arial" font-size="30" fill="#222">Simulated iPhone ${id.toUpperCase()}</text><text x="32" y="190" font-family="Arial" font-size="16" fill="#888">UI verification fixture</text>${['Display', 'Bluetooth', 'Accessibility', 'General'].map((text, i) => `<rect x="24" y="${240 + i * 90}" width="352" height="72" rx="10" fill="white"/><text x="44" y="${284 + i * 90}" font-family="Arial" font-size="20" fill="#333">${text}</text>`).join('')}<text x="32" y="750" font-family="Arial" font-size="14" fill="#999">No real device is being controlled.</text></svg>`;
  managers[index].frame = await sharp(Buffer.from(svg)).jpeg().toBuffer();
  await fetch(`http://127.0.0.1:${port}${workspace.apiBase}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `模拟 iPhone ${id.toUpperCase()}`,
      source: 'usb',
      deviceId: `usb-${id}`,
      bluetoothPeerId: `bt-${id}`,
    }),
  });
}
server.app.post('/fixture/fail/:index', (req, res) => {
  const manager = managers[Number(req.params.index)];
  manager.connection.phase = 'failed';
  manager.connection.error = '蓝牙连接已断开，请在手机连接后点击刷新。';
  res.json({});
});
console.log(
  `Simulated workspaces ready at http://127.0.0.1:${port}/#/workspace`,
);
process.on('SIGTERM', () => {
  server.server?.closeAllConnections();
  void workspaces
    .close()
    .then(() => server.close())
    .then(() => process.exit(0));
});
