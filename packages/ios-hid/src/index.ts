export { IOSHIDDevice } from './device.js';
export { IOSHIDAgent } from './agent.js';
export { HostClient } from './client/host-client.js';
export type {
  IOSHIDDeviceOptions,
  ScreenOptions,
  ScreenFrame,
  InputAction,
  DeviceConfig,
  ConnectionState,
  ConnectOptions,
  AirPlaySetupInfo,
} from './types.js';

export { ensureLocalHost as connectIOSHIDHost } from './client/ensure-local-host.js';
export type { TaskRequest, TaskState } from './types.js';

export {
  IOSHIDServiceDevice,
  listIOSHIDDevices,
  type IOSHIDServiceOptions,
  type IOSHIDServiceProfile,
} from './client/service-client.js';

export {
  agentFromIOSHID,
  type AgentFromIOSHIDOptions,
} from './agent-from-service.js';
