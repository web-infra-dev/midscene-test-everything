import { AsyncLocalStorage } from 'node:async_hooks';
import type { DeviceAction, Size } from '@midscene/core';
import {
  AbstractInterface,
  type InputPrimitives,
  defineAction,
  defineActionsFromInputPrimitives,
} from '@midscene/core/device';
import type { InputAction, ScreenFrame } from './types.js';

/** Midscene action interface for an iOS HID device. */
export abstract class IOSHIDInterface extends AbstractInterface {
  readonly interfaceType = 'ios-hid';
  override cacheFeatureForPoint: AbstractInterface['cacheFeatureForPoint'] =
    undefined;
  override rectMatchesCacheFeature: AbstractInterface['rectMatchesCacheFeature'] =
    undefined;
  override beforeInvokeAction: AbstractInterface['beforeInvokeAction'] =
    undefined;
  override afterInvokeAction: AbstractInterface['afterInvokeAction'] =
    undefined;
  override getUITree: AbstractInterface['getUITree'] = undefined;
  override getElementsNodeTree: AbstractInterface['getElementsNodeTree'] =
    undefined;
  override url: AbstractInterface['url'] = undefined;
  override evaluateJavaScript: AbstractInterface['evaluateJavaScript'] =
    undefined;
  readonly inputPrimitives: InputPrimitives;
  private actions: DeviceAction[];
  private actionSignal = new AsyncLocalStorage<AbortSignal | undefined>();
  constructor() {
    super();
    this.inputPrimitives = {
      pointer: {
        tap: (point) => this.dispatch({ type: 'tap', point }),
        swipe: (from, to, opts) =>
          this.dispatch({
            type: 'swipe',
            from,
            to,
            durationMs: opts?.duration,
          }),
      },
      keyboard: {
        typeText: (text, opts) =>
          this.dispatch({ type: 'typeText', text, replace: opts?.replace }),
        keyboardPress: (key) => this.dispatch({ type: 'key', key }),
        clearInput: () => this.dispatch({ type: 'clearInput' }),
      },
    };
    this.actions = [
      ...defineActionsFromInputPrimitives(this.inputPrimitives, {
        size: () => this.size(),
      }),
      defineAction({
        name: 'Home',
        description: 'Go to the iPhone Home Screen.',
        call: () => this.home(),
      }),
      defineAction({
        name: 'Back',
        description:
          'Swipe from the left edge to go back on iOS. Only works on screens that support this gesture.',
        call: () => this.back(),
      }),
    ].map((action) => ({
      ...action,
      ...(action.name === 'Input'
        ? {
            description:
              'Input accepts ASCII only. Never pass Chinese or other non-ASCII text. ' +
              'For Chinese, tap visible suggestions or use the on-screen keyboard; ' +
              'tap keys and candidates slowly, then verify the committed text.',
          }
        : {}),
      call: (param, context) =>
        this.actionSignal.run(context?.signal, () =>
          action.call(param, context),
        ),
    }));
  }
  home(options?: { signal?: AbortSignal }) {
    return this.execute(
      { type: 'home' },
      { signal: options?.signal ?? this.actionSignal.getStore() },
    );
  }
  back(options?: { signal?: AbortSignal }) {
    return this.execute(
      { type: 'back' },
      { signal: options?.signal ?? this.actionSignal.getStore() },
    );
  }
  private dispatch(action: InputAction) {
    return this.execute(action, { signal: this.actionSignal.getStore() });
  }
  abstract execute(
    action: InputAction,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  protected abstract getFrame(): Promise<ScreenFrame>;
  screenshot() {
    return this.getFrame();
  }
  async size(): Promise<Size> {
    const f = await this.getFrame();
    return { width: f.width, height: f.height };
  }
  async screenshotBase64() {
    const f = await this.getFrame();
    return `data:image/jpeg;base64,${f.jpeg.toString('base64')}`;
  }
  actionSpace() {
    return this.actions;
  }
}
