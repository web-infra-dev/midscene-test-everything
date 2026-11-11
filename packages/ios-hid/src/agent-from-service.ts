import type { AgentOpt } from '@midscene/core/agent';
import { IOSHIDAgent } from './agent.js';
import {
  IOSHIDServiceDevice,
  listIOSHIDDevices,
} from './client/service-client.js';

export interface AgentFromIOSHIDOptions {
  host: string;
  token?: string;
  deviceId?: string;
  agentOptions?: AgentOpt;
}

class ServiceAgent extends IOSHIDAgent {
  private closing?: Promise<void>;

  constructor(
    private device: IOSHIDServiceDevice,
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

/** Connect to a configured phone and release its control session with the Agent. */
export async function agentFromIOSHID({
  host,
  token = process.env.IOS_HID_SERVICE_TOKEN,
  deviceId,
  agentOptions,
}: AgentFromIOSHIDOptions): Promise<IOSHIDAgent> {
  if (!token?.trim())
    throw new Error('Set IOS_HID_SERVICE_TOKEN or pass a token.');
  const connection = { host, token };
  const profiles = await listIOSHIDDevices(connection);
  if (!profiles.length)
    throw new Error('Add a phone in the device manager first.');
  if (!deviceId && profiles.length > 1)
    throw new Error('Specify deviceId when the service has multiple phones.');
  const profile = deviceId
    ? profiles.find(({ id }) => id === deviceId)
    : profiles[0];
  if (!profile) throw new Error(`Device not found: ${deviceId}`);
  const device = await IOSHIDServiceDevice.connect({
    ...connection,
    deviceId: profile.id,
    name: profile.name,
  });
  try {
    return new ServiceAgent(device, agentOptions);
  } catch (error) {
    await device.destroy().catch(() => {});
    throw error;
  }
}
