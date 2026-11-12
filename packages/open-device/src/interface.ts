import { AsyncLocalStorage } from 'node:async_hooks';
import type { DeviceAction, Size } from '@midscene/core';
import {
  AbstractInterface,
  type InputPrimitives,
  defineAction,
  defineActionsFromInputPrimitives,
} from '@midscene/core/device';
import type { DeviceProfile, InputAction, ScreenFrame } from './protocol.js';

/** Midscene action interface for an Open Device. */
export abstract class OpenDeviceInterface extends AbstractInterface {
  readonly interfaceType = 'open-device';
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
  constructor(
    readonly capabilities: Pick<DeviceProfile, 'actions' | 'inputGuidance'> = {
      actions: ['tap', 'swipe'],
    },
  ) {
    super();
    const supports = (type: InputAction['type']) =>
      capabilities.actions.includes(type);
    this.inputPrimitives = {
      pointer: supports('tap')
        ? {
            tap: (point) => this.dispatch({ type: 'tap', point }),
            swipe: supports('swipe')
              ? (from, to, opts) =>
                  this.dispatch({
                    type: 'swipe',
                    from,
                    to,
                    durationMs: opts?.duration,
                  })
              : undefined,
            dragAndDrop: supports('dragAndDrop')
              ? (from, to) => this.dispatch({ type: 'dragAndDrop', from, to })
              : undefined,
            longPress: supports('longPress')
              ? (point, opts) =>
                  this.dispatch({
                    type: 'longPress',
                    point,
                    durationMs: opts?.duration,
                  })
              : undefined,
          }
        : undefined,
      keyboard:
        supports('typeText') && supports('key') && supports('clearInput')
          ? {
              typeText: (text, opts) =>
                this.dispatch({
                  type: 'typeText',
                  text,
                  replace: opts?.replace,
                }),
              keyboardPress: (key) => this.dispatch({ type: 'key', key }),
              clearInput: () => this.dispatch({ type: 'clearInput' }),
            }
          : undefined,
    };
    this.actions = [
      ...defineActionsFromInputPrimitives(this.inputPrimitives, {
        size: () => this.size(),
      }),
      ...(supports('home')
        ? [
            defineAction({
              name: 'Home',
              description: 'Go to the device home screen.',
              call: () => this.home(),
            }),
          ]
        : []),
      ...(supports('back')
        ? [
            defineAction({
              name: 'Back',
              description:
                'Navigate back on screens that support this gesture.',
              call: () => this.back(),
            }),
          ]
        : []),
    ].map((action) => ({
      ...action,
      ...(action.name === 'Input' && capabilities.inputGuidance
        ? { description: capabilities.inputGuidance }
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
