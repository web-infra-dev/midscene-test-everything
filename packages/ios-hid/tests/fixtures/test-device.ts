import { IOSHIDInterface } from '../../dist/interface.js';
import type { InputAction, ScreenFrame } from '../../dist/types.js';

export class TestDevice extends IOSHIDInterface {
  describe() {
    return 'Simulated iPhone';
  }
  async execute(_action: InputAction, _options?: { signal?: AbortSignal }) {}
  protected async getFrame(): Promise<ScreenFrame> {
    throw new Error('No simulated frame');
  }
  async destroy() {}
}
