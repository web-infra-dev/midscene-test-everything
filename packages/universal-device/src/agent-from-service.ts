import type { AgentOpt } from '@midscene/core/agent';
import { UniversalDeviceAgent } from './agent.js';
import { UniversalDevice, listUniversalDevices } from './client/service-client.js';

export interface AgentFromUniversalDeviceOptions {
  host: string;
  token?: string;
  deviceId?: string;
  agentOptions?: AgentOpt;
}

class ServiceAgent extends UniversalDeviceAgent {
  private closing?: Promise<void>;

  constructor(
    private device: UniversalDevice,
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
export async function agentFromUniversalDevice({
  host,
  token = process.env.MIDSCENE_UNIVERSAL_DEVICE_SERVICE_TOKEN,
  deviceId,
  agentOptions,
}: AgentFromUniversalDeviceOptions): Promise<UniversalDeviceAgent> {
  if (!token?.trim())
    throw new Error('Set MIDSCENE_UNIVERSAL_DEVICE_SERVICE_TOKEN or pass a token.');
  const connection = { host, token };
  const profiles = await listUniversalDevices(connection);
  if (!profiles.length)
    throw new Error('Add a device in its service manager first.');
  if (!deviceId && profiles.length > 1)
    throw new Error('Specify deviceId when the service has multiple devices.');
  const profile = deviceId
    ? profiles.find(({ id }) => id === deviceId)
    : profiles[0];
  if (!profile) throw new Error(`Device not found: ${deviceId}`);
  const device = await UniversalDevice.connect({
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
