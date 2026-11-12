import { isIPv4 } from 'node:net';
import * as cli from '@clack/prompts';
import {
  DOBOT_MG400_DEFAULTS,
  Mg400Adapter,
  discoverMg400Hosts,
} from '@midscene/arm-adapter-mg400';
import type { PlaygroundOptions } from '../server/index.js';
import { listNetworkPorts, prepareNetwork } from './network.js';

/** `--mock` or ARM_PLAYGROUND_MOCK=1 replaces the controller with a simulator. */
export function mockArmRequested(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
) {
  return (
    argv.includes('--mock') ||
    ['1', 'true'].includes((env.ARM_PLAYGROUND_MOCK ?? '').toLowerCase())
  );
}

function answer<T>(value: T | symbol): T {
  if (typeof value === 'symbol') {
    cli.cancel('已取消启动。');
    process.exit(0);
  }
  return value;
}

async function port(label: string, initial: number, min = 1) {
  const value = answer(
    await cli.text({
      message: label,
      initialValue: String(initial),
      validate: (s) =>
        /^\d+$/.test(s) && Number(s) >= min && Number(s) <= 65535
          ? undefined
          : `请输入 ${min} 至 65535 之间的端口。`,
    }),
  );
  return Number(value);
}

export async function setupMg400(): Promise<PlaygroundOptions | undefined> {
  if (mockArmRequested()) {
    // Load the simulator only in mock mode; a real connection never imports it.
    const { MockMg400Adapter } = await import('./mock-arm.js');
    cli.log.warn(
      '模拟机械臂：不会连接或移动真实控制器，仅用于相机和界面调试。',
    );
    return {
      installationId: 'mg400-mock',
      connectionDiagram: 'ethernet',
      autoConnect: true,
      createAdapter: () => new MockMg400Adapter(),
    };
  }
  if (!process.argv.includes('--manual')) {
    const options = {
      dashboardPort: Number(DOBOT_MG400_DEFAULTS.dashboardPort),
      motionPort: Number(DOBOT_MG400_DEFAULTS.motionPort),
      feedbackPort: Number(DOBOT_MG400_DEFAULTS.feedbackPort),
    };
    return {
      connection: { adapter: 'mg400', options },
      connectionDiagram: 'ethernet',
      async discoverHost() {
        const hosts = await discoverMg400Hosts();
        if (!hosts.length)
          throw new Error('未在 192.168.1.6 或 192.168.2.6 找到可用的 MG400。');
        if (hosts.length > 1)
          throw new Error(
            '两个地址均有 MG400 响应。请用 pnpm dev --manual 指定控制器地址。',
          );
        return hosts[0];
      },
      createAdapter: (host) => {
        if (!host) throw new Error('MG400 discovery did not return a host');
        return new Mg400Adapter({ ...options, host, commandTimeoutMs: 5000 });
      },
    };
  }
  if (!process.stdin.isTTY)
    throw new Error('请在交互式终端中运行 pnpm dev 以选择连接设备。');
  cli.intro('Midscene Playground · Dobot MG400');
  let ports: Awaited<ReturnType<typeof listNetworkPorts>>['ports'] = [];
  try {
    ({ ports } = await listNetworkPorts());
  } catch (error) {
    cli.log.warn(error instanceof Error ? error.message : String(error));
  }
  const device = answer(
    await cli.select({
      message: '控制器通过哪个网口连接？',
      options: [
        ...ports.map((p) => ({
          value: p.id,
          label: `${p.name} · ${p.id}`,
          hint: p.active === false ? '未接网线' : p.addresses.join(', '),
        })),
        {
          value: 'manual',
          label: '使用已配置的网络',
          hint: '保留电脑当前的网络设置',
        },
      ],
      initialValue: ports.find((p) => p.active)?.id ?? 'manual',
    }),
  );
  const host = answer(
    await cli.text({
      message: '控制器 IP 地址',
      initialValue: '192.168.1.6',
      validate: (s) => (isIPv4(s) ? undefined : '请输入有效的 IPv4 地址。'),
    }),
  );
  const connection = {
    host,
    dashboardPort: Number(DOBOT_MG400_DEFAULTS.dashboardPort),
    motionPort: Number(DOBOT_MG400_DEFAULTS.motionPort),
    feedbackPort: Number(DOBOT_MG400_DEFAULTS.feedbackPort),
  };
  if (
    answer(
      await cli.confirm({
        message: '修改控制器端口？',
        initialValue: false,
        active: '修改',
        inactive: '使用默认值',
      }),
    )
  ) {
    connection.dashboardPort = await port(
      'Dashboard 端口',
      connection.dashboardPort,
    );
    connection.motionPort = await port('Motion 端口', connection.motionPort);
    connection.feedbackPort = await port(
      'Feedback 端口（0 表示关闭）',
      connection.feedbackPort,
      0,
    );
  }
  const selected = ports.find((p) => p.id === device);
  if (selected) {
    const input = {
      host,
      device,
      mac: selected.mac,
      port: connection.dashboardPort,
    };
    const check = await prepareNetwork(input, { checkOnly: true });
    if (check.needsAuthorization) {
      if (
        !answer(
          await cli.confirm({
            message: `向 ${device} 添加 IP ${check.address} 和到 ${host} 的路由？`,
            initialValue: false,
          }),
        )
      ) {
        cli.cancel('已取消启动。');
        return;
      }
      await prepareNetwork(input);
    }
  }
  return {
    connection: { adapter: 'mg400', options: connection },
    connectionDiagram: 'ethernet',
    createAdapter: () =>
      new Mg400Adapter({ ...connection, commandTimeoutMs: 5000 }),
  };
}
