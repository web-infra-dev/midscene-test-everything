import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from '@rstest/core';
import {
  configurationScript,
  parseHardwarePorts,
  validateNetworkInput,
} from '../../src/cli/network.ts';

test('lists wired USB adapters and excludes Wi-Fi and bridges', () => {
  const ports = parseHardwarePorts(`Hardware Port: USB 10/100/1000 LAN
Device: en5
Ethernet Address: aa:bb:cc:dd:ee:ff

Hardware Port: Wi-Fi
Device: en0
Ethernet Address: 11:22:33:44:55:66

Hardware Port: USB Ethernet
Device: en7
Ethernet Address: aa:bb:cc:dd:ee:00

Hardware Port: Thunderbolt Bridge
Device: bridge0
`);
  assert.deepEqual(
    ports.map((p) => p.id),
    ['en5', 'en7'],
  );
  assert.equal(ports[0].mac, 'aa:bb:cc:dd:ee:ff');
});

test('rejects public addresses, invalid ports and command injection before elevation', () => {
  const good = { host: '192.168.1.6', device: 'en5', port: 29999 };
  assert.deepEqual(validateNetworkInput(good), good);
  for (const patch of [
    { host: '8.8.8.8' },
    { host: '192.168.1.6; touch /tmp/bad' },
    { device: 'en5; id' },
    { port: '29999' },
    { port: 0 },
    { host: '192.168.1.255' },
    { host: '127.0.0.1' },
  ])
    assert.throws(() => validateNetworkInput({ ...good, ...patch }));
  assert.throws(() => configurationScript(good, '192.168.1.2; id'));
});

test('configuration scopes route and rollback to the chosen controller and adapter', () => {
  const script = configurationScript(
    { host: '192.168.1.6', device: 'en5', port: 29999 },
    '192.168.1.2',
  );
  assert.ok(script.includes('trap cleanup EXIT'));
  assert.ok(script.includes('netmask 255.255.255.255 alias'));
  assert.ok(
    script.includes(
      'add -net 192.168.1.6/32 -interface en5 -ifa 192.168.1.2 -cloning',
    ),
  );
  assert.ok(script.includes('delete -net 192.168.1.6/32 -interface en5'));
  assert.ok(script.includes('inet 192.168.1.2 -alias'));
  assert.ok(script.includes('nc -z -G 3 -s 192.168.1.2 192.168.1.6 29999'));
  assert.ok(!script.includes('delete default'));
  assert.ok(!script.includes('setmanual'));
});

test('route guard accepts scoped kernel clones and preserves explicit host routes', () => {
  const script = configurationScript(
    { host: '192.168.2.6', device: 'en13' },
    '192.168.2.2',
  );
  // Execute just the route check with captured macOS route output.
  const start = script.indexOf('if printf');
  const end = script.indexOf('\nfi', start);
  assert.ok(start >= 0 && end > start);
  const guard = script.slice(start, end + 3);
  for (const [flags, expected] of [
    ['UP,HOST,LLINFO,WASCLONED,IFSCOPE,IFREF', 0],
    ['UP,GATEWAY,HOST,DONE,WASCLONED,IFSCOPE,IFREF', 0],
    ['UP,HOST,STATIC,IFSCOPE', 1],
    ['UP,HOST,DONE', 1],
  ]) {
    const result = spawnSync('/bin/sh', ['-c', guard], {
      env: { current: `destination: 192.168.2.6\n flags: <${flags}>` },
    });
    assert.equal(result.status, expected, flags);
  }
});

test('saved adapter identity survives interface renumbering and missing adapters are rejected', async () => {
  const { resolveNetworkPort } = await import('../../src/cli/network.ts');
  const port = { id: 'en9', mac: 'aa:bb:cc:dd:ee:ff' };
  assert.equal(resolveNetworkPort([port], 'AA:BB:CC:DD:EE:FF').id, 'en9');
  assert.throws(() => resolveNetworkPort([], port.mac), {
    code: 'NETWORK_PORT_MISSING',
  });
  assert.throws(() => resolveNetworkPort([port, port], port.mac), {
    code: 'NETWORK_PORT_MISSING',
  });
});

test('reachable saved port skips authorization; check-only never changes the network', async () => {
  const { prepareNetwork } = await import('../../src/cli/network.ts');
  const mac = 'aa:bb:cc:dd:ee:ff';
  let elevated = 0;
  let reachable = true;
  const port = {
    id: 'en9',
    name: 'USB Ethernet',
    mac,
    active: true,
    addresses: ['192.168.1.2'],
  };
  const dependencies = {
    listPorts: async () => ({ supported: true, ports: [port] }),
    read: async (file) => (file === '/sbin/route' ? 'interface: en9\n' : ''),
    interfaces: () => ({}),
    probeConnection: async () => reachable,
    elevate: async () => {
      elevated++;
    },
  };
  const input = { host: '192.168.1.6', device: 'en5', mac };
  assert.equal(
    (await prepareNetwork(input, dependencies)).needsAuthorization,
    false,
  );
  assert.equal(elevated, 0);
  reachable = false;
  port.addresses = ['169.254.1.2'];
  assert.equal(
    (await prepareNetwork(input, { ...dependencies, checkOnly: true }))
      .needsAuthorization,
    true,
  );
  assert.equal(elevated, 0);
  assert.equal((await prepareNetwork(input, dependencies)).configured, true);
  assert.equal(elevated, 1);
});
