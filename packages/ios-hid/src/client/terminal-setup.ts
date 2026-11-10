import { createInterface } from 'node:readline/promises';
import { setTimeout as pause } from 'node:timers/promises';
import type { ConnectionState } from '../types.js';
import { openBrowser } from './ensure-local-host.js';

interface Choice {
  id: string;
  name: string;
}
interface SetupState {
  source: string;
  computerName: string;
  devices: Choice[];
  selectedUSB?: string;
  bluetooth: { state: string; hosts: Array<Choice & { reports: number[] }> };
  airplay?: { name: string; pin: string };
}

/** Scripts use terminal guidance; only camera geometry needs a browser. */
export async function presentTerminalSetup(
  state: ConnectionState,
  signal: AbortSignal,
) {
  if (!state.setupUrl) throw new Error('Missing device setup address');
  if (state.setupKind === 'camera') {
    await openBrowser(state.setupUrl);
    return;
  }
  if (!process.stdin.isTTY)
    throw new Error(
      'Device setup needs an interactive terminal. Configure the device in Playground first, or supply connect({ onState }) to handle setup.',
    );
  const url = new URL(state.setupUrl);
  const id = url.pathname.split('/').filter(Boolean).at(-1)!;
  async function request(path: string, body?: unknown) {
    signal.throwIfAborted();
    const response = await fetch(new URL(path, url), {
      method: body === undefined ? 'GET' : 'POST',
      headers:
        body === undefined
          ? undefined
          : { 'Content-Type': 'application/json', 'X-Midscene-Setup': id },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error ?? 'Device setup request failed');
    return result;
  }
  async function question(prompt: string) {
    const terminal = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    try {
      return (await terminal.question(prompt, { signal })).trim();
    } finally {
      terminal.close();
    }
  }
  async function choose(items: Choice[], label: string): Promise<string> {
    if (items.length === 0) throw new Error(`No ${label} is available`);
    if (items.length === 1) {
      console.error(`${label}: ${items[0].name}`);
      return items[0].id;
    }
    console.error(
      items
        .map(
          (item, index) =>
            `${index + 1}. ${item.name} (${item.id.slice(0, 8)})`,
        )
        .join('\n'),
    );
    while (true) {
      const answer = await question(`Select ${label} [1-${items.length}]: `);
      if (/^\d+$/.test(answer) && items[Number(answer) - 1])
        return items[Number(answer) - 1].id;
      console.error('Enter a number from the list.');
    }
  }
  if (state.setupKind === 'selection') {
    const selected = await choose(await request('devices'), 'saved device');
    await request('select', { id: selected });
    return;
  }
  let setup: SetupState = await request('state');
  const usbDeviceId =
    setup.source === 'usb'
      ? await choose(setup.devices, 'USB iPhone')
      : undefined;
  await request('select', { usbDeviceId });
  setup = await request('state');
  if (setup.airplay)
    console.error(
      `On iPhone, open Screen Mirroring and select "${setup.airplay.name}". Pairing code: ${setup.airplay.pin}`,
    );
  console.error(
    `In iPhone Bluetooth settings, connect to "${setup.computerName}", and enable AssistiveTouch. Keep the phone unlocked on a static, bright screen.`,
  );
  let peers = setup.bluetooth.hosts.filter((peer) =>
    [1, 2, 3].every((report) => peer.reports.includes(report)),
  );
  while (peers.length === 0) {
    signal.throwIfAborted();
    if (/bluetooth off|not allowed|failed/i.test(setup.bluetooth.state))
      throw new Error(setup.bluetooth.state);
    await pause(1000, undefined, { signal });
    setup = await request('state');
    peers = setup.bluetooth.hosts.filter((peer) =>
      [1, 2, 3].every((report) => peer.reports.includes(report)),
    );
  }
  const bluetoothPeerId = await choose(peers, 'Bluetooth iPhone');
  const confirmed = await question(
    'Confirm this Bluetooth connection belongs to the phone providing the screen image [y/N]: ',
  );
  if (!/^y(es)?$/i.test(confirmed)) throw new Error('Device binding cancelled');
  await request('confirm', { bluetoothPeerId, confirmed: true });
  console.error('Verifying pointer alignment…');
}
