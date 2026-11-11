export { IOSHIDAgent } from './agent.js';
export type { InputAction, Point, ScreenFrame } from './types.js';

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
