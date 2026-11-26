import { setTimeout as delay } from 'node:timers/promises';
import {
  type ControllerStateSample,
  RobotArmError,
} from '@midscene/arm-kit/adapter-development';

import { type Mg400HttpOptions, exchangeMg400Http } from './mg400-http.js';

/** HTTP exchange state uses native units/selected frames, not a Base pose. */
export interface Mg400ExchangeState extends Record<string, unknown> {
  controlMode: 'enable' | 'disable';
  coordinate: string;
  jogMode: string;
  toolCoordinate: number;
  userCoordinate: number;
  alarms: (number[] | null)[];
  outputs: number[];
  jointCoordinate: number[];
  cartesianCoordinate: number[];
}
export interface Mg400ControllerState extends ControllerStateSample {
  vendor: 'dobot-mg400';
  raw: Mg400ExchangeState;
}
export interface Mg400ClearAlarmRequest {
  controlMode: 'enable' | 'disable';
  coordinate: string;
  jogMode: string;
  toolCoordinate: number;
  userCoordinate: number;
  hardware: true;
  alarms: true;
  outputs: { enable: false; value: number[] };
}

export function parseMg400ExchangeState(value: unknown): Mg400ExchangeState {
  const fail = (field: string): never => {
    throw new RobotArmError(
      'PROTOCOL_ERROR',
      `Invalid MG400 exchange field: ${field}`,
      502,
      { field },
    );
  };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('state');
  const state = value as Record<string, unknown>;
  if (!['enable', 'disable'].includes(state.controlMode as string))
    fail('controlMode');
  for (const field of ['coordinate', 'jogMode'])
    if (typeof state[field] !== 'string' || !state[field].trim()) fail(field);
  for (const field of ['toolCoordinate', 'userCoordinate'])
    if (!Number.isSafeInteger(state[field]) || (state[field] as number) < 0)
      fail(field);
  const numbers = (input: unknown, field: string): number[] => {
    if (
      !Array.isArray(input) ||
      !input.every((n) => typeof n === 'number' && Number.isFinite(n))
    )
      fail(field);
    return input as number[];
  };
  for (const field of ['jointCoordinate', 'cartesianCoordinate']) {
    const values = numbers(state[field], field);
    if (values.length !== 4 && values.length !== 6) fail(field);
  }
  const outputs = numbers(state.outputs, 'outputs');
  if (
    outputs.length !== 8 ||
    outputs.some((n) => !Number.isSafeInteger(n) || n < 0 || n > 255)
  )
    fail('outputs');
  if (!Array.isArray(state.alarms)) fail('alarms');
  for (const group of state.alarms as unknown[]) {
    if (group === null) continue;
    const values = numbers(group, 'alarms');
    if (values.some((n) => !Number.isSafeInteger(n))) fail('alarms');
  }
  // Retain additional firmware fields, null slots and unwrapped angles.
  return structuredClone(state) as Mg400ExchangeState;
}

/** DobotStudio Pro 2.8.5's exchange serializer; no output writes or resume. */
export function buildMg400ClearAlarmRequest(
  input: Mg400ExchangeState,
): Mg400ClearAlarmRequest {
  const state = parseMg400ExchangeState(input);
  return {
    controlMode: state.controlMode,
    coordinate: state.coordinate,
    jogMode: state.jogMode,
    toolCoordinate: state.toolCoordinate,
    userCoordinate: state.userCoordinate,
    hardware: true,
    alarms: true,
    outputs: { enable: false, value: [...state.outputs] },
  };
}

function faulted(state: Mg400ControllerState): boolean {
  return state.raw.alarms.some((group) => group?.some((code) => code !== 0));
}

/** Dedicated management channel. Ordinary TCP state polling remains independent. */
export class Mg400ControllerClient {
  private generation = 0;
  private readonly active = new Set<AbortController>();
  private writes: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly host: string,
    private readonly options: Omit<Mg400HttpOptions, 'signal'> = {},
  ) {}

  /** Invalidate queued writes and interrupt I/O before a safety/session change. */
  interrupt(): void {
    this.generation++;
    for (const controller of this.active)
      controller.abort(
        new RobotArmError(
          'ACTION_STOPPED',
          'MG400 controller operation interrupted',
          409,
        ),
      );
  }

  async readState(
    signal?: AbortSignal,
    timeoutMs = this.options.timeoutMs,
  ): Promise<Mg400ControllerState> {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    this.active.add(controller);
    try {
      const raw = parseMg400ExchangeState(
        await exchangeMg400Http(this.host, {
          ...this.options,
          timeoutMs,
          path: '/protocol/exchange',
          signal: controller.signal,
        }),
      );
      if (controller.signal.aborted)
        throw new RobotArmError(
          'ACTION_STOPPED',
          'MG400 state read interrupted',
          409,
        );
      return {
        vendor: 'dobot-mg400',
        receivedAt: new Date().toISOString(),
        raw,
      };
    } finally {
      signal?.removeEventListener('abort', abort);
      this.active.delete(controller);
    }
  }

  /** Fresh read → one write → measured confirmation; never retries the write. */
  clearAlarms(timeoutMs = 5000): Promise<Mg400ControllerState> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      return Promise.reject(
        new RobotArmError('INVALID_CONFIG', 'Invalid clear-alarm timeout', 400),
      );
    const generation = this.generation;
    const deadline = Date.now() + timeoutMs;
    const work = this.writes.then(async () => {
      const controller = new AbortController();
      const check = () => {
        if (generation !== this.generation || controller.signal.aborted)
          throw new RobotArmError(
            'ACTION_STOPPED',
            'MG400 clear-alarm transaction interrupted',
            409,
          );
      };
      check();
      let lastState: Mg400ControllerState | undefined;
      let beforeState: Mg400ControllerState | undefined;
      let response: unknown;
      let request: Mg400ClearAlarmRequest | undefined;
      const unconfirmed = () =>
        new RobotArmError(
          'STATE_UNCONFIRMED',
          `MG400 did not confirm ClearAlarms${lastState ? `; remaining alarms: ${JSON.stringify(lastState.raw.alarms)}` : ''}`,
          504,
          {
            transport: 'http',
            path: '/protocol/exchange',
            request,
            response,
            beforeState,
            lastState,
          },
        );
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw unconfirmed();
      const timer = setTimeout(
        () => controller.abort(unconfirmed()),
        remaining,
      );
      this.active.add(controller);
      try {
        lastState = await this.readState(controller.signal);
        beforeState = lastState;
        check();
        request = buildMg400ClearAlarmRequest(lastState.raw);
        // A busy event loop can delay the abort timer beyond its deadline.
        // Check the wall clock before dispatching the non-idempotent write.
        if (Date.now() >= deadline) throw unconfirmed();
        response = await exchangeMg400Http(this.host, {
          ...this.options,
          path: '/protocol/exchange',
          method: 'POST',
          body: request,
          signal: controller.signal,
        });
        check();
        if (
          response &&
          typeof response === 'object' &&
          'status' in response &&
          response.status !== true
        )
          throw new RobotArmError(
            'VENDOR_ERROR',
            'MG400 rejected ClearAlarms',
            502,
            { request, response, lastState },
          );
        if (!response || typeof response !== 'object')
          throw new RobotArmError(
            'PROTOCOL_ERROR',
            'Invalid MG400 ClearAlarms acknowledgement',
            502,
            { response },
          );
        if (!('status' in response)) parseMg400ExchangeState(response);
        // Even a full snapshot in the POST response is only an acknowledgement.
        while (Date.now() < deadline) {
          lastState = await this.readState(controller.signal);
          check();
          if (!faulted(lastState)) return lastState;
          await delay(50, undefined, { signal: controller.signal });
        }
        throw unconfirmed();
      } catch (error) {
        if (
          controller.signal.aborted &&
          controller.signal.reason instanceof RobotArmError
        )
          throw controller.signal.reason;
        if (error instanceof RobotArmError)
          throw new RobotArmError(error.code, error.message, error.status, {
            ...error.details,
            operation: 'ClearAlarms',
            request,
            response,
            beforeState,
            lastState,
          });
        throw error;
      } finally {
        clearTimeout(timer);
        this.active.delete(controller);
      }
    });
    this.writes = work.catch(() => undefined);
    return work;
  }
}
