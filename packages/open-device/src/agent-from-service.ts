import type { AgentOpt } from '@midscene/core/agent';
import { OpenDeviceAgent } from './agent.js';
import { OpenDevice, listOpenDevices } from './client/service-client.js';

export interface AgentFromOpenDeviceOptions {
  host: string;
  token?: string;
  deviceId?: string;
  agentOptions?: AgentOpt;
}

class ServiceAgent extends OpenDeviceAgent {
  private closing?: Promise<void>;

  constructor(
    private device: OpenDevice,
    options?: AgentOpt,
  ) {
    super(device, options);
  }

  override destroy() {
    this.closing ??= (async () => {
      try {
        await super.destroy();
      } finally {
        await this.device.destroy();
      }
    })();
    return this.closing;
  }
}

/** Connect to a configured device and release its control session with the Agent. */
export async function agentFromOpenDevice({
  host,
  token = process.env.OPEN_DEVICE_SERVICE_TOKEN,
  deviceId,
  agentOptions,
}: AgentFromOpenDeviceOptions): Promise<OpenDeviceAgent> {
  if (!token?.trim())
    throw new Error('Set OPEN_DEVICE_SERVICE_TOKEN or pass a token.');
  const connection = { host, token };
  const profiles = await listOpenDevices(connection);
  if (!profiles.length)
    throw new Error('Add a device in its service manager first.');
  if (!deviceId && profiles.length > 1)
    throw new Error('Specify deviceId when the service has multiple devices.');
  const profile = deviceId
    ? profiles.find(({ id }) => id === deviceId)
    : profiles[0];
  if (!profile) throw new Error(`Device not found: ${deviceId}`);
  const device = await OpenDevice.connect({
    ...connection,
    deviceId: profile.id,
    name: profile.name,
    actions: profile.actions,
    inputGuidance: profile.inputGuidance,
  });
  try {
    return new ServiceAgent(device, agentOptions);
  } catch (error) {
    await device.destroy().catch(() => {});
    throw error;
  }
}
