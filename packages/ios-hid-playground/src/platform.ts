import {
  IOSHIDAgent,
  IOSHIDServiceDevice,
  type IOSHIDServiceOptions,
  listIOSHIDDevices,
} from '@midscene/ios-hid';
import {
  type PlaygroundSessionManager,
  createMjpegPreviewDescriptor,
  definePlaygroundPlatform,
} from '@midscene/playground';

export function serviceOptions(input: unknown): IOSHIDServiceOptions {
  const value = input as Partial<IOSHIDServiceOptions> | undefined;
  if (typeof value?.host !== 'string' || typeof value?.token !== 'string')
    throw new Error('请输入设备服务地址和访问凭证。');
  return { host: value.host.trim(), token: value.token };
}

export class RemoteSessionManager implements PlaygroundSessionManager {
  private device?: IOSHIDServiceDevice;
  private opening = false;
  private generation = 0;

  get sessionEnded() {
    return this.device?.sessionEnded ?? false;
  }

  openPreview(signal: AbortSignal) {
    return this.device?.openPreview(signal);
  }

  async getSetupSchema() {
    return {
      title: '连接 iPhone 或 iPad',
      description: '选择设备管理台中已连接的手机。',
      autoSubmitWhenReady: false,
      fields: [],
    };
  }

  async createSession(input: Record<string, unknown> = {}) {
    if (this.device || this.opening) throw new Error('请先断开当前设备。');
    const options = serviceOptions(input);
    const deviceId = input.deviceId;
    if (typeof deviceId !== 'string' || !deviceId)
      throw new Error('请选择一台手机。');

    this.opening = true;
    const generation = this.generation;
    try {
      const profile = (await listIOSHIDDevices(options)).find(
        (item) => item.id === deviceId,
      );
      if (!profile) throw new Error('找不到所选手机，请刷新设备列表。');
      const device = await IOSHIDServiceDevice.connect({
        ...options,
        deviceId,
        name: profile.name,
      });
      if (generation !== this.generation) {
        await device.destroy();
        throw new Error('连接已取消。');
      }
      this.device = device;
      return {
        agentFactory: (
          options?: ConstructorParameters<typeof IOSHIDAgent>[1],
        ) => new IOSHIDAgent(device, options),
        displayName: profile.name,
        preview: createMjpegPreviewDescriptor(),
        platformId: 'ios-hid',
      };
    } finally {
      this.opening = false;
    }
  }

  async destroySession() {
    this.generation++;
    const device = this.device;
    this.device = undefined;
    await device?.destroy().catch(() => {
      // A disconnected service reclaims the lease after the last heartbeat.
    });
  }
}

export const iosHIDPlatform = definePlaygroundPlatform({
  id: 'ios-hid',
  title: 'Midscene iOS HID',
  async prepare() {
    return {
      platformId: 'ios-hid',
      title: 'Midscene iOS HID',
      sessionManager: new RemoteSessionManager(),
      preview: createMjpegPreviewDescriptor(),
    };
  },
});
