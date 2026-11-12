import { createHash, randomUUID } from 'node:crypto';
import { Client } from '@awo00/smb2';
import {
  type ControllerMotionSettings,
  type ControllerMotionSettingsUpdate,
  RobotArmError,
} from '@midscene/arm-kit/adapter-development';
import { type Mg400HttpOptions, exchangeMg400Http } from './mg400-http.js';

const paths = {
  common: 'settings/common.json',
  coordinate: 'settings/playback/coordinate.json',
  defaults: 'properties/default.json',
} as const;
export interface MotionSettingsFiles {
  read(path: string): Promise<unknown>;
  replace(path: string, value: unknown): Promise<void>;
}
export interface MotionSettingsPort {
  files<T>(
    signal: AbortSignal,
    work: (files: MotionSettingsFiles) => Promise<T>,
  ): Promise<T>;
  apply(path: string, body: unknown, signal: AbortSignal): Promise<unknown>;
  assertStopped(): Promise<void>;
}

/** Studio reads controller files over SMB, then applies saved values over HTTP. */
export function mg400MotionSettingsPort(
  host: string,
  options: Omit<Mg400HttpOptions, 'signal'>,
  assertStopped: () => Promise<void>,
): MotionSettingsPort {
  return {
    assertStopped,
    apply: (path, body, signal) =>
      exchangeMg400Http(host, {
        ...options,
        path,
        method: 'POST',
        body,
        signal,
      }),
    async files(signal, work) {
      const client = new Client(host, {
        connectTimeout: 3000,
        requestTimeout: 3000,
      });
      // The request rejects separately; always handle the socket's error event.
      client.on('error', () => {});
      const abort = () => client.socket?.destroy();
      signal.addEventListener('abort', abort, { once: true });
      const check = () => {
        if (signal.aborted)
          throw new RobotArmError(
            'ACTION_STOPPED',
            'Controller motion settings interrupted',
            409,
          );
      };
      try {
        check();
        const session = await client.authenticate({
          domain: '',
          username: 'guest',
          password: '',
        });
        check();
        const tree = await session.connectTree('project');
        check();
        return await work({
          async read(path) {
            check();
            const buffer = await tree.readFile(path);
            check();
            if (buffer.length > 1024 * 1024)
              throw new RobotArmError(
                'PROTOCOL_ERROR',
                'Controller settings file exceeds 1 MiB',
                502,
              );
            try {
              return JSON.parse(buffer.toString('utf8'));
            } catch {
              throw new RobotArmError(
                'PROTOCOL_ERROR',
                `Invalid controller settings JSON: ${path}`,
                502,
              );
            }
          },
          async replace(path, value) {
            check();
            const temporary = `${path}.midscene-${randomUUID()}.tmp`;
            await tree.createFile(
              temporary,
              `${JSON.stringify(value, null, 2)}\n`,
            );
            check();
            // SMB rename replaces the original atomically; a failed request is never retried.
            await tree.renameFile(temporary, path);
            check();
          },
        });
      } finally {
        signal.removeEventListener('abort', abort);
        // close() logs sessions off; a broken connection must not delay Stop.
        if (signal.aborted) client.socket?.destroy();
        else await client.close();
      }
    },
  };
}
function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RobotArmError(
      'PROTOCOL_ERROR',
      `Invalid controller ${name}`,
      502,
    );
  return value as Record<string, unknown>;
}
function number(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1)
    throw new RobotArmError(
      'PROTOCOL_ERROR',
      `Invalid controller ${name}`,
      502,
    );
  return value;
}
const fields = {
  linearSpeed: 'velocity',
  linearAcceleration: 'acceleration',
  linearJerk: 'jerk',
} as const;
function decode(
  commonValue: unknown,
  coordinateValue: unknown,
  defaultValue: unknown,
) {
  const common = object(commonValue, 'common settings');
  const coordinate = object(coordinateValue, 'playback coordinate settings');
  const defaults = object(defaultValue, 'motion limits');
  const limits = object(
    object(defaults.playback, 'playback limits').coordinate,
    'coordinate limits',
  );
  const globalRange = object(
    object(defaults.common, 'common limits').ratio,
    'global ratio limits',
  );
  const ratio = number(common.ratio, 'global ratio');
  if (!Number.isInteger(ratio) || ratio > 100)
    throw new RobotArmError(
      'PROTOCOL_ERROR',
      'Invalid global speed ratio',
      502,
    );
  const range = (value: unknown) => {
    const r = object(value, 'parameter range');
    const min = number(r.min, 'minimum');
    const max = number(r.max, 'maximum');
    const defaultValue = number(r.def, 'default');
    if (max < min || defaultValue < min || defaultValue > max)
      throw new RobotArmError(
        'PROTOCOL_ERROR',
        'Invalid controller parameter range',
        502,
      );
    return { min, max, default: defaultValue };
  };
  const values = {
    globalSpeedPercent: ratio,
    linearSpeed: 0,
    linearAcceleration: 0,
    linearJerk: 0,
  };
  const ranges: ControllerMotionSettings['ranges'] = {
    globalSpeedPercent: range(globalRange),
    linearSpeed: range(globalRange),
    linearAcceleration: range(globalRange),
    linearJerk: range(globalRange),
  };
  for (const [name, key] of Object.entries(fields) as Array<
    [keyof typeof fields, string]
  >) {
    const pair = coordinate[key];
    const bounds = limits[key];
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      !Array.isArray(bounds) ||
      bounds.length < 4
    )
      throw new RobotArmError(
        'PROTOCOL_ERROR',
        `Invalid controller ${key} layout`,
        502,
      );
    values[name] = number(pair[0], key);
    number(pair[1], `${key} rotation`);
    // Studio exposes XYZ and R; its six-axis limit table maps them to 0 and 3.
    ranges[name] = range(bounds[0]);
  }
  ranges.globalSpeedPercent.min = Math.max(1, ranges.globalSpeedPercent.min);
  ranges.globalSpeedPercent.max = Math.min(100, ranges.globalSpeedPercent.max);
  const revision = createHash('sha256')
    .update(JSON.stringify([common, coordinate, defaults]))
    .digest('hex');
  return {
    common,
    coordinate,
    snapshot: {
      revision,
      values,
      ranges,
      receivedAt: new Date().toISOString(),
    } satisfies ControllerMotionSettings,
  };
}
export class Mg400MotionSettingsClient {
  private generation = 0;
  private active = new Set<AbortController>();
  constructor(
    private readonly port: MotionSettingsPort,
    private readonly identity = '',
  ) {}
  interrupt() {
    this.generation++;
    for (const controller of this.active) controller.abort();
  }
  private async transaction<T>(
    work: (
      files: MotionSettingsFiles,
      signal: AbortSignal,
      check: () => void,
    ) => Promise<T>,
  ): Promise<T> {
    const generation = this.generation;
    const controller = new AbortController();
    this.active.add(controller);
    const check = () => {
      if (generation !== this.generation || controller.signal.aborted)
        throw new RobotArmError(
          'ACTION_STOPPED',
          'Controller motion settings interrupted',
          409,
        );
    };
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      return await this.port.files(controller.signal, async (files) => {
        check();
        const result = await work(files, controller.signal, check);
        check();
        return result;
      });
    } finally {
      clearTimeout(timer);
      this.active.delete(controller);
    }
  }
  private async readFiles(files: MotionSettingsFiles) {
    const decoded = decode(
      await files.read(paths.common),
      await files.read(paths.coordinate),
      await files.read(paths.defaults),
    );
    decoded.snapshot.revision = createHash('sha256')
      .update(`${this.identity}:${decoded.snapshot.revision}`)
      .digest('hex');
    return decoded;
  }
  read(): Promise<ControllerMotionSettings> {
    return this.transaction(
      async (files) => (await this.readFiles(files)).snapshot,
    );
  }
  update(
    request: ControllerMotionSettingsUpdate,
  ): Promise<ControllerMotionSettings> {
    return this.transaction(async (files, signal, check) => {
      const before = await this.readFiles(files);
      if (!request || request.revision !== before.snapshot.revision)
        throw new RobotArmError(
          'STALE_CONTROLLER_SETTINGS',
          'Reload controller motion settings before saving',
          409,
        );
      const values = object(request.values, 'requested motion settings');
      if (
        Object.keys(values).length !==
          Object.keys(before.snapshot.values).length ||
        Object.keys(values).some(
          (key) => !Object.hasOwn(before.snapshot.values, key),
        )
      )
        throw new RobotArmError(
          'INVALID_CONFIG',
          'Provide all four controller motion settings',
          400,
        );
      for (const [key, value] of Object.entries(values)) {
        const bounds =
          before.snapshot.ranges[key as keyof typeof before.snapshot.values];
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < bounds.min ||
          value > bounds.max ||
          (key === 'globalSpeedPercent' && !Number.isInteger(value))
        )
          throw new RobotArmError(
            'INVALID_CONFIG',
            `${key} is outside the controller range`,
            400,
            { bounds },
          );
      }
      const common = { ...before.common, ratio: values.globalSpeedPercent };
      const coordinate = structuredClone(before.coordinate);
      for (const [name, key] of Object.entries(fields))
        (coordinate[key] as number[])[0] = values[name] as number;
      const applied: string[] = [];
      const attempted: string[] = [];
      try {
        for (const [path, endpoint, next, previous] of [
          [
            paths.coordinate,
            '/settings/playback/coordinate',
            coordinate,
            before.coordinate,
          ],
          [paths.common, '/settings/common', common, before.common],
        ] as const) {
          if (JSON.stringify(next) === JSON.stringify(previous)) continue;
          await this.port.assertStopped();
          check();
          attempted.push(path);
          await files.replace(path, next);
          applied.push(path);
          check();
          await this.port.assertStopped();
          check();
          // Same payload and persistence-before-application order as Studio's native callback.
          const response = await this.port.apply(endpoint, next, signal);
          check();
          if (
            !response ||
            typeof response !== 'object' ||
            Array.isArray(response)
          )
            throw new RobotArmError(
              'PROTOCOL_ERROR',
              'Invalid controller settings application response',
              502,
            );
          const result = response as Record<string, unknown>;
          if (
            result.error ||
            result.status === false ||
            (typeof result.status === 'number' && result.status !== 0) ||
            (typeof result.code === 'number' && result.code !== 0)
          )
            throw new RobotArmError(
              'VENDOR_ERROR',
              'Controller rejected motion settings application',
              502,
              { response },
            );
        }
        const after = await this.readFiles(files);
        check();
        if (
          Object.entries(values).some(
            ([key, value]) =>
              after.snapshot.values[
                key as keyof typeof after.snapshot.values
              ] !== value,
          )
        )
          throw new RobotArmError(
            'STATE_UNCONFIRMED',
            'Controller settings readback does not match requested values',
            502,
          );
        return after.snapshot;
      } catch (error) {
        if (!attempted.length) throw error;
        throw new RobotArmError(
          'CONTROLLER_SETTINGS_UNCONFIRMED',
          error instanceof Error ? error.message : String(error),
          502,
          {
            attemptedPaths: attempted,
            persistedPaths: applied,
            cause:
              error instanceof RobotArmError
                ? { code: error.code, details: error.details }
                : undefined,
            before: before.snapshot,
            requested: request.values,
            applicationUnconfirmed: true,
          },
        );
      }
    });
  }
}
