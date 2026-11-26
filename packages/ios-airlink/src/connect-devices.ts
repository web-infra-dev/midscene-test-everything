import { createConnectRegistry } from '@midscene/robotics-shared/connect-registry';
import {
  type InputActionType,
  connectPrimitives,
} from '@midscene/robotics-shared/device-protocol';
import type { ControlledDevice } from './device-connection.js';
import type { DeviceConfig } from './hardware/types.js';

export const phoneActions: InputActionType[] = [
  'home',
  'back',
  'clearInput',
  'tap',
  'doubleTap',
  'longPress',
  'swipe',
  'scroll',
  'dragAndDrop',
  'typeText',
  'key',
];
export const phoneGuidance =
  'Input supports ASCII only. For other text, tap the on-screen keyboard and verify the committed text. Avoid starting swipes on the floating AssistiveTouch menu.';

/** Serve every saved phone at `/devices/<id>/api` over Midscene Connect. */
export function createPhoneConnect({
  token,
  readyDevice,
  listDevices,
}: {
  token: string;
  readyDevice(id: string): ControlledDevice | undefined;
  listDevices(): Promise<DeviceConfig[]>;
}) {
  const inFlight = new Map<string, number>();
  const control = (id: string) => {
    const device = readyDevice(id);
    if (!device || device.signal.aborted)
      throw new Error(
        'The phone is offline. Reconnect it in the device manager.',
      );
    return device;
  };
  const track = async <T>(id: string, task: () => Promise<T>) => {
    inFlight.set(id, (inFlight.get(id) ?? 0) + 1);
    try {
      return await task();
    } finally {
      const left = (inFlight.get(id) ?? 1) - 1;
      if (left) inFlight.set(id, left);
      else inFlight.delete(id);
    }
  };
  const registry = createConnectRegistry({
    token,
    list: async () =>
      (await listDevices()).map(({ id, name, screen }) => ({
        id,
        name,
        screenSource: screen.source,
        status: readyDevice(id) ? 'available' : 'offline',
      })),
    device: ({ id, name }) => ({
      name,
      description: phoneGuidance,
      pointerType: 'touch',
      screenshot: async () => (await control(id).screenshot()).jpeg,
      actions: connectPrimitives(
        (action) =>
          track(id, () => {
            const device = control(id);
            return device.execute(action, device.signal);
          }),
        phoneActions,
      ),
    }),
  });
  return {
    handle: registry.handle,
    /** True while a remote action is running on the phone. */
    busy: (id: string) => inFlight.has(id),
  };
}
