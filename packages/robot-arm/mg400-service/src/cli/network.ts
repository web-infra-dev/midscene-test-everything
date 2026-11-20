import { execFile } from 'node:child_process';
import net from 'node:net';
import { networkInterfaces } from 'node:os';
import { promisify } from 'node:util';

interface EthernetPort {
  id: string;
  name: string;
  mac: string;
  active: boolean | null;
  addresses: string[];
}
interface NetworkInput {
  host: string;
  device: string;
  port?: number;
  mac?: string;
}
const execute = promisify(execFile);
const run = async (file: string, args: string[]) =>
  (await execute(file, args, { timeout: 10000 })).stdout;

export function parseHardwarePorts(text: string) {
  return text.split(/\n\s*\n/).flatMap((block) => {
    const name = /^Hardware Port: (.+)$/m.exec(block)?.[1];
    const id = /^Device: (en\d+)$/m.exec(block)?.[1];
    const mac = /^Ethernet Address: (.+)$/m.exec(block)?.[1];
    return name &&
      id &&
      mac &&
      /Ethernet|LAN/i.test(name) &&
      !/Wi-Fi|AirPort|Bridge|Bluetooth/i.test(name)
      ? [{ id, name, mac }]
      : [];
  });
}
export async function listNetworkPorts() {
  if (process.platform !== 'darwin') return { supported: false, ports: [] };
  const listing = await run('/usr/sbin/networksetup', [
    '-listallhardwareports',
  ]);
  if (/failed|error/i.test(listing))
    throw new Error('无法读取系统网口列表，请检查本地服务的系统权限。');
  const hardware = parseHardwarePorts(listing);
  const present = (await run('/sbin/ifconfig', ['-l'])).trim().split(/\s+/);
  const addresses = networkInterfaces();
  const ports = await Promise.all(
    hardware
      .filter((p) => present.includes(p.id))
      .map(async (p) => {
        const state = await run('/sbin/ifconfig', [p.id]);
        const link = /^\s*status:\s*(active|inactive)\s*$/m.exec(state)?.[1];
        return {
          ...p,
          active: link ? link === 'active' : null,
          addresses: (addresses[p.id] ?? [])
            .filter((a) => a.family === 'IPv4')
            .map((a) => a.address),
        };
      }),
  );
  return { supported: true, ports };
}
export function validateNetworkInput(input: NetworkInput) {
  const { host, device, port = 29999 } = input;
  if (
    typeof host !== 'string' ||
    !net.isIPv4(host) ||
    !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
  )
    throw new Error('请输入有效的私有 IPv4 控制器地址。');
  if (
    !/^en\d+$/.test(device ?? '') ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error('网口或控制器端口无效。');
  const last = Number(host.split('.').at(-1));
  if (last === 0 || last === 255)
    throw new Error('自动配置暂按 /24 网段处理，请勿使用网络或广播地址。');
  return { host, device, port };
}
function probe(host: string, port: number, localAddress: string) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port, localAddress });
    const finish = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1500, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}
// Only validated IPv4 addresses, numeric ports and enumerated enX identifiers
// enter the elevated command. Never execute client-provided shell text.
export function configurationScript(input: NetworkInput, address: string) {
  const { host, device, port } = validateNetworkInput(input);
  if (!net.isIPv4(address) || address === host)
    throw new Error('Invalid computer address');
  const mac = input.mac;
  if (mac !== undefined && !/^[a-f0-9]{2}(:[a-f0-9]{2}){5}$/i.test(mac))
    throw new Error('Invalid adapter identity');
  return `set -eu
added=0
routed=0
cleanup() {
  code=$?
  if [ "$code" -ne 0 ]; then
    if [ "$routed" = 1 ]; then /sbin/route -n delete -net ${host}/32 -interface ${device}; fi
    if [ "$added" = 1 ]; then /sbin/ifconfig ${device} inet ${address} -alias; fi
  fi
}
trap cleanup EXIT
/sbin/ifconfig ${device} | /usr/bin/grep -q 'status: active'
${mac ? `/sbin/ifconfig ${device} | /usr/bin/grep -qi 'ether ${mac}'` : ''}
# Recheck after the authorization dialog: another process may have changed IPs.
if /sbin/ifconfig -a | /usr/bin/awk '$1=="inet" && ($2=="${address}" || $2=="${host}") {found=1} END {exit !found}'; then
  echo '网络地址已变化，请刷新后重试。' >&2; exit 1
fi
# Wi-Fi and VPN probes can leave scoped, kernel-cloned entries for the host.
# Leave it in place. Only the unscoped /32 on the selected port is added here.
current=$(/sbin/route -n get ${host} 2>/dev/null || true)
if printf '%s' "$current" | /usr/bin/awk '
  $1=="destination:" && $2=="${host}" { exact=1 }
  $1=="flags:" {
    scopedClone = $2 ~ /[<,]WASCLONED[,>]/ && $2 ~ /[<,]IFSCOPE[,>]/
    isStatic = $2 ~ /[<,]STATIC[,>]/
  }
  END { exit !(exact && (!scopedClone || isStatic)) }'; then
  echo '控制器已有专用路由，请先检查该路由后重试。' >&2; exit 1
fi
/sbin/ifconfig ${device} inet ${address} netmask 255.255.255.255 alias
added=1
/sbin/route -n add -net ${host}/32 -interface ${device} -ifa ${address} -cloning
routed=1
/sbin/route -n get ${host} | /usr/bin/grep -Eq 'interface: ${device}$'
/usr/bin/nc -z -G 3 -s ${address} ${host} ${port} || { echo '控制器无法访问，已尝试恢复本次网络修改。请检查电源、网线和控制器地址。' >&2; exit 1; }
`;
}
let configuring = false;
export function resolveNetworkPort(
  ports: EthernetPort[],
  mac: string | undefined,
) {
  const matches = ports.filter(
    (p) => p.mac?.toLowerCase() === mac?.toLowerCase(),
  );
  if (matches.length !== 1)
    throw Object.assign(
      new Error(
        '上次使用的网卡未接入或无法唯一识别，请插入后刷新，或选择其他网口。',
      ),
      { code: 'NETWORK_PORT_MISSING' },
    );
  return matches[0];
}
export async function prepareNetwork(
  input: NetworkInput,
  {
    checkOnly = false,
    listPorts = listNetworkPorts,
    read = run,
    interfaces = networkInterfaces,
    probeConnection = probe,
    elevate = execute,
  } = {},
) {
  if (configuring) throw new Error('正在配置网络，请稍候。');
  configuring = true;
  try {
    const { host, port } = validateNetworkInput(input);
    const { supported, ports } = await listPorts();
    if (!supported) throw new Error('自动配置目前支持 macOS。');
    const selected = resolveNetworkPort(ports, input.mac);
    const device = selected.id;
    if (selected.active === false)
      throw new Error('所选网口未连接网线，请检查网线或选择其他网口。');
    const allAddresses = Object.values(interfaces())
      .flat()
      .filter((a) => a !== undefined)
      .map((a) => a.address);
    if (allAddresses.includes(host))
      throw new Error('控制器地址与电脑 IP 相同，请检查地址。');
    const route = await read('/sbin/route', ['-n', 'get', host]).catch(
      () => '',
    );
    if (new RegExp(`interface: ${device}\\s`).test(route)) {
      for (const address of selected.addresses)
        if (await probeConnection(host, port, address))
          return {
            configured: false,
            needsAuthorization: false,
            networkPort: selected,
          };
    }
    // Do not reconfigure a port already used for an unrelated network.
    if (selected.addresses.some((a) => !a.startsWith('169.254.')))
      throw new Error(
        '所选网口已有 IP，但无法访问控制器。为保留原网络，请确认网口和控制器地址，或先手动检查网络设置。',
      );
    const prefix = host.split('.').slice(0, 3).join('.');
    const address = `${prefix}.${host.endsWith('.2') ? 3 : 2}`;
    if (allAddresses.includes(address))
      throw new Error('自动分配的电脑 IP 已被本机占用，请检查网络设置。');
    const routes = await read('/usr/sbin/netstat', ['-rn', '-f', 'inet']);
    if (
      routes
        .split('\n')
        .some((line) => [host, address].includes(line.trim().split(/\s+/)[1]))
    )
      throw new Error('目标地址与现有网关冲突，未修改网络。');
    if (checkOnly)
      return { needsAuthorization: true, address, networkPort: selected };
    const script = configurationScript(
      { host, device, port, mac: selected.mac },
      address,
    );
    try {
      await elevate(
        '/usr/bin/osascript',
        [
          '-e',
          `do shell script ${JSON.stringify(script)} with administrator privileges`,
        ],
        { timeout: 120000, maxBuffer: 65536 },
      );
    } catch (error) {
      if (
        String(
          error instanceof Error && 'stderr' in error ? error.stderr : '',
        ).includes('-128')
      )
        throw new Error('已取消系统授权，未配置网络。');
      throw new Error(
        `网络自动配置失败：${error instanceof Error ? ('stderr' in error && error.stderr) || error.message : String(error)}`,
      );
    }
    return { configured: true, address, networkPort: selected };
  } finally {
    configuring = false;
  }
}
