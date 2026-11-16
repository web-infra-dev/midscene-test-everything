export { UniversalDeviceAgent } from './agent.js';
export type {
  DeviceProfile,
  InputAction,
  Point,
  PreviewReader,
  ScreenFrame,
} from './protocol.js';

export {
  UniversalDevice,
  listUniversalDevices,
  type UniversalDeviceOptions,
  type UniversalDeviceProfile,
} from './client/service-client.js';

export {
  agentFromUniversalDevice,
  type AgentFromUniversalDeviceOptions,
} from './agent-from-service.js';
