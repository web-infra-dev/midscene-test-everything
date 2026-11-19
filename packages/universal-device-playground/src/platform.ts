import {
  type PlaygroundSessionManager,
  createMjpegPreviewDescriptor,
  createScreenshotPreviewDescriptor,
  definePlaygroundPlatform,
} from '@midscene/playground';
import {
  UniversalDevice,
  UniversalDeviceAgent,
  type UniversalDeviceOptions,
  listUniversalDevices,
} from '@midscene/universal-device';

export function serviceOptions(input: unknown): UniversalDeviceOptions {
  const value = input as Partial<UniversalDeviceOptions> | undefined;
  if (typeof value?.host !== 'string' || typeof value?.token !== 'string')
    throw new Error('Enter the device service URL and access token.');
  return { host: value.host.trim(), token: value.token };
}

export class RemoteSessionManager implements PlaygroundSessionManager {
  private device?: UniversalDevice;
  private opening = false;
  private generation = 0;

  constructor(private readonly scope = '') {}

  get sessionEnded() {
    return this.device?.sessionEnded ?? false;
  }

  openPreview(signal: AbortSignal) {
    return this.device?.openPreview(signal);
  }

  async getSetupSchema() {
    return {
      title: 'Connect Device',
      description: 'Select a device to connect.',
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
      const profile = (await listUniversalDevices(options)).find(
        (item) => item.id === deviceId,
      );
      if (!profile)
        throw new Error('Selected device not found. Refresh the device list.');
      const device = await UniversalDevice.connect({
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
          options?: ConstructorParameters<typeof UniversalDeviceAgent>[1],
        ) => new UniversalDeviceAgent(device, options),
        displayName: profile.name,
        preview:
          profile.preview === 'mjpeg'
            ? createMjpegPreviewDescriptor({ mjpegPath: `${this.scope}/mjpeg` })
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

export function prepareUniversalDevicePlatform(scope = '') {
  return {
    platformId: 'open-device',
    title: 'Midscene Universal Device',
    sessionManager: new RemoteSessionManager(scope),
    preview: createScreenshotPreviewDescriptor(),
  };
}

export const universalDevicePlatform = definePlaygroundPlatform({
  id: 'open-device',
  title: 'Midscene Universal Device',
  async prepare() {
    return prepareUniversalDevicePlatform();
  },
});
