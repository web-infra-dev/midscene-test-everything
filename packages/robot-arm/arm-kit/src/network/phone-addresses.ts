import { execFile } from 'node:child_process';
import { isIPv4 } from 'node:net';
import { type NetworkInterfaceInfo, networkInterfaces } from 'node:os';
import { promisify } from 'node:util';

const execute = promisify(execFile);
type Interfaces = Record<string, NetworkInterfaceInfo[] | undefined>;
export function wifiHardwarePorts(listing: string): string[] {
  return listing.split(/\n\s*\n/).flatMap((block) => {
    const name = /^Hardware Port: (.+)$/m.exec(block)?.[1];
    const device = /^Device: (\S+)$/m.exec(block)?.[1];
    return name && device && /Wi-Fi|AirPort|Wireless|无线/i.test(name)
      ? [device]
      : [];
  });
}
/** Read OS interface identities, never change addresses, routes or Wi-Fi settings. */
export async function discoverWifiInterfaces(): Promise<string[]> {
  if (process.platform !== 'darwin') return [];
  try {
    const { stdout } = await execute(
      '/usr/sbin/networksetup',
      ['-listallhardwareports'],
      { timeout: 3000 },
    );
    return wifiHardwarePorts(stdout);
  } catch {
    // Named wireless interfaces remain discoverable on systems without this command.
    return [];
  }
}
const wirelessName = /^(wlan\d*|wl[a-z0-9]+|wi-?fi|airport|wireless|无线.*)$/i;
const virtualName =
  /^(lo\d*|utun\d*|tun\d*|tap\d*|veth.*|docker.*|vmnet.*|vboxnet.*|bridge\d*|awdl\d*|llw\d*|tailscale.*|wg\d*)$/i;
function sameSubnet(address: string, host: string, mask: string) {
  if (!isIPv4(host) || !isIPv4(mask)) return false;
  const bytes = (value: string) => value.split('.').map(Number);
  const a = bytes(address);
  const b = bytes(host);
  const m = bytes(mask);
  return a.every((part, i) => (part & m[i]) === (b[i] & m[i]));
}
/** The phone LAN is distinct from the controller LAN. Wi-Fi wins even under a VPN. */
export function phoneAddresses({
  interfaces = networkInterfaces(),
  wifiInterfaces = [],
  controllerHost,
}: {
  interfaces?: Interfaces;
  wifiInterfaces?: readonly string[];
  controllerHost?: string;
} = {}): { address: string; name: string }[] {
  const wireless = new Set(wifiInterfaces);
  const candidates = Object.entries(interfaces).flatMap(([name, addresses]) => {
    if (virtualName.test(name)) return [];
    return (addresses ?? []).flatMap((info) => {
      if (
        info.family !== 'IPv4' ||
        info.internal ||
        !isIPv4(info.address) ||
        /^(0\.|127\.|169\.254\.)/.test(info.address)
      )
        return [];
      const wifi = wireless.has(name) || wirelessName.test(name);
      if (
        !wifi &&
        controllerHost &&
        (sameSubnet(info.address, controllerHost, info.netmask) ||
          info.address.split('.').slice(0, 3).join('.') ===
            controllerHost.split('.').slice(0, 3).join('.'))
      )
        return [];
      return [{ address: info.address, name, wifi }];
    });
  });
  const selected = candidates.some((candidate) => candidate.wifi)
    ? candidates.filter((candidate) => candidate.wifi)
    : candidates;
  return selected
    .filter(
      (candidate, index) =>
        selected.findIndex((other) => other.address === candidate.address) ===
        index,
    )
    .map(({ address, name, wifi }) => ({
      address,
      name: wifi ? 'Wi-Fi' : name,
    }));
}
