import { UniversalDeviceInterface } from '../../dist/interface.js';
import type { InputAction, ScreenFrame } from '../../dist/protocol.js';

export class TestDevice extends UniversalDeviceInterface {
  constructor({ doubleTap = false } = {}) {
    super({
      actions: [
        'tap',
        ...(doubleTap ? (['doubleTap'] as const) : []),
        'swipe',
        'home',
        'back',
        'typeText',
        'key',
        'clearInput',
      ],
      inputGuidance:
        'Input supports ASCII only. Never pass Chinese directly. For Chinese, use the on-screen keyboard, tap keys and candidates slowly, and verify the committed text. Avoid starting swipes on the floating AssistiveTouch menu.',
    });
  }
  describe() {
    return 'Simulated iPhone';
  }
  async execute(_action: InputAction, _options?: { signal?: AbortSignal }) {}
  protected async getFrame(): Promise<ScreenFrame> {
    throw new Error('No simulated frame');
  }
  async destroy() {}
}
