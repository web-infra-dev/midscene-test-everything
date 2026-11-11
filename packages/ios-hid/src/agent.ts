import { Agent, type AgentOpt } from '@midscene/core/agent';
import { IOSHIDInterface } from './interface.js';
import type { InputAction } from './types.js';

const inputContext =
  'Input supports ASCII only. For Chinese, focus the field, use the on-screen keyboard, switch input methods if needed, and tap keys and candidates slowly. Check screenshots between short sequences and verify the committed text. Report if the keyboard or input method is unavailable. Avoid starting swipes on the floating AssistiveTouch menu.';

function withInputContext(options: AgentOpt = {}): AgentOpt {
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
class BorrowedDevice extends IOSHIDInterface {
  constructor(private device: IOSHIDInterface) {
    super();
  }
  describe() {
    return this.device.describe?.() ?? 'iOS HID device';
  }
  execute(action: InputAction, options?: { signal?: AbortSignal }) {
    return this.device.execute(action, options);
  }
  protected getFrame() {
    return this.device.screenshot();
  }
  async destroy() {}
}
export class IOSHIDAgent extends Agent<IOSHIDInterface> {
  constructor(device: IOSHIDInterface, options?: AgentOpt) {
    super(new BorrowedDevice(device), withInputContext(options));
  }
}
