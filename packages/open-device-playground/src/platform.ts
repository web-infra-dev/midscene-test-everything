import {
  OpenDevice,
  OpenDeviceAgent,
  type OpenDeviceOptions,
  listOpenDevices,
} from '@midscene/open-device';
import {
  type PlaygroundSessionManager,
  createMjpegPreviewDescriptor,
  createScreenshotPreviewDescriptor,
  definePlaygroundPlatform,
} from '@midscene/playground';

export function serviceOptions(input: unknown): OpenDeviceOptions {
  const value = input as Partial<OpenDeviceOptions> | undefined;
  if (typeof value?.host !== 'string' || typeof value?.token !== 'string')
    throw new Error('Enter the device service URL and access token.');
  return { host: value.host.trim(), token: value.token };
}

export class RemoteSessionManager implements PlaygroundSessionManager {
  private device?: OpenDevice;
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
      title: 'Connect Device',
      description: 'Select a configured device from the device service.',
      autoSubmitWhenReady: false,
      fields: [],
    };
  }

  async createSession(input: Record<string, unknown> = {}) {
    if (this.device || this.opening)
      throw new Error('Disconnect the current device first.');
    const options = serviceOptions(input);
    const deviceId = input.deviceId;
    if (typeof deviceId !== 'string' || !deviceId)
      throw new Error('Select a device.');

    this.opening = true;
    const generation = this.generation;
    try {
      const profile = (await listOpenDevices(options)).find(
        (item) => item.id === deviceId,
      );
      if (!profile)
        throw new Error('Selected device not found. Refresh the device list.');
      const device = await OpenDevice.connect({
        ...options,
        deviceId,
        name: profile.name,
        actions: profile.actions,
        inputGuidance: profile.inputGuidance,
      });
      if (generation !== this.generation) {
        await device.destroy();
        throw new Error('Connection cancelled.');
      }
      this.device = device;
      return {
        agentFactory: (
          options?: ConstructorParameters<typeof OpenDeviceAgent>[1],
        ) => new OpenDeviceAgent(device, options),
        displayName: profile.name,
        preview:
          profile.preview === 'mjpeg'
            ? createMjpegPreviewDescriptor()
            : createScreenshotPreviewDescriptor(),
        platformId: 'open-device',
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

export const openDevicePlatform = definePlaygroundPlatform({
  id: 'open-device',
  title: 'Midscene Open Device',
  async prepare() {
    return {
      platformId: 'open-device',
      title: 'Midscene Open Device',
      sessionManager: new RemoteSessionManager(),
      preview: createScreenshotPreviewDescriptor(),
    };
  },
});
