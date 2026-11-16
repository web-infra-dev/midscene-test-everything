import { Agent, type AgentOpt } from '@midscene/core/agent';
import { UniversalDeviceInterface } from './interface.js';
import type { InputAction } from './protocol.js';

function withInputContext(
  inputContext: string | undefined,
  options: AgentOpt = {},
): AgentOpt {
  if (!inputContext) return options;
  const userContext =
    options.aiContexts?.aiAct ??
    options.aiActContext ??
    options.aiActionContext ??
    options.aiContexts?.default;
  return {
    ...options,
    aiContexts: {
      ...options.aiContexts,
      aiAct: userContext ? `${inputContext}\n\n${userContext}` : inputContext,
    },
  };
}

/** Core Agent destroys its interface; a borrowed facade preserves caller ownership. */
class BorrowedDevice extends UniversalDeviceInterface {
  constructor(private device: UniversalDeviceInterface) {
    super(device.capabilities);
  }
  describe() {
    return this.device.describe?.() ?? 'Universal Device';
  }
  execute(action: InputAction, options?: { signal?: AbortSignal }) {
    return this.device.execute(action, options);
  }
  protected getFrame() {
    return this.device.screenshot();
  }
  async destroy() {}
}
export class UniversalDeviceAgent extends Agent<UniversalDeviceInterface> {
  constructor(device: UniversalDeviceInterface, options?: AgentOpt) {
    super(
      new BorrowedDevice(device),
      withInputContext(device.capabilities.inputGuidance, options),
    );
  }
}
