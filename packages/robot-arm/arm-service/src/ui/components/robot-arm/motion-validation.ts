import { SCREEN_PRESS_DEPTH_RANGE_MM } from '@midscene/robotics-shared/contracts';
import { t } from '../../i18n';
import type { EffectiveCapabilities } from '../../robot-arm-api';
type SetupProfile = Record<string, any>;
type ProfileKind = 'robot' | 'tool' | 'screen';
export class SetupFieldError extends Error {
  constructor(
    readonly kind: ProfileKind,
    readonly path: string,
    message: string,
  ) {
    super(message);
  }
}
export function readSetupPath(profile: SetupProfile, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value !== null && typeof value === 'object'
          ? (value as Record<string, unknown>)[key]
          : undefined,
      profile,
    );
}
function finite(
  value: unknown,
  label: string,
  min: number,
  max = Number.POSITIVE_INFINITY,
): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(t('Enter a valid number for {0}.', [label]));
  if (min === Number.MIN_VALUE && value <= 0)
    throw new Error(t('Enter {0} greater than zero.', [label]));
  if (value < min || value > max)
    throw new Error(
      t('Enter {0} in the range {1}–{2}.', [
        label,
        min,
        max === Number.POSITIVE_INFINITY ? 'unbounded' : max,
      ]),
    );
}
function measuredNumber(
  profile: SetupProfile,
  kind: ProfileKind,
  path: string,
  label: string,
  min: number,
  max = Number.POSITIVE_INFINITY,
) {
  try {
    finite(readSetupPath(profile, path), label, min, max);
  } catch (error) {
    throw new SetupFieldError(
      kind,
      path,
      error instanceof Error ? error.message : String(error),
    );
  }
}
export function contactRateRange(
  capabilities: EffectiveCapabilities | undefined,
  key: 'speed' | 'acceleration',
  mode: 'ratio' | 'linear',
) {
  const descriptors =
    capabilities?.descriptors.filter(
      (item) => item.id === 'motion.linear' || item.id === 'motion.ptp',
    ) ?? [];
  if (!screenRateModes(capabilities, key).includes(mode)) return undefined;
  // Each contact stage scales both values by 1, .2, .4, .4 or .15.
  // Intersect the base ranges that satisfy every stage and motion descriptor.
  const ranges = descriptors.map((item) => item.constraints![key][mode]!);
  return {
    min: Math.max(...ranges.map((range) => range.min / 0.15)),
    max: Math.min(...ranges.map((range) => range.max)),
  };
}
export function validateMotionSettings(
  screen: SetupProfile,
  capabilities: EffectiveCapabilities | undefined,
) {
  for (const key of ['speed', 'acceleration'] as const) {
    const path = key === 'speed' ? 'actionSpeed' : 'actionAcceleration';
    const rate = screen[path];
    const range = rate && contactRateRange(capabilities, key, rate.kind);
    if (!range || range.min > range.max)
      throw new SetupFieldError(
        'screen',
        `${path}.kind`,
        t('No supported {0} range satisfies every contact stage.', [key]),
      );
    const value =
      rate.kind === 'ratio'
        ? rate.value
        : rate[key === 'speed' ? 'mmPerSecond' : 'mmPerSecondSquared'];
    const valuePath = `${path}.${rate.kind === 'ratio' ? 'value' : key === 'speed' ? 'mmPerSecond' : 'mmPerSecondSquared'}`;
    measuredNumber(
      screen,
      'screen',
      valuePath,
      t('base {0} for all contact stages', [key]),
      Math.max(range.min, Number.MIN_VALUE),
      range.max,
    );
    const releasePath =
      key === 'speed' ? 'releaseSpeedFactor' : 'releaseAccelerationFactor';
    measuredNumber(
      screen,
      'screen',
      releasePath,
      t('release {0} factor', [key]),
      0.15,
      1,
    );
    for (const descriptor of capabilities?.descriptors ?? []) {
      if (descriptor.id !== 'motion.linear' && descriptor.id !== 'motion.ptp')
        continue;
      const stageRange =
        descriptor.constraints![key][rate.kind as 'ratio' | 'linear']!;
      for (const factor of [1, 0.2, 0.4, 0.4, 0.15])
        finite(
          value * factor,
          t('{0} at contact stage ratio {1}', [key, factor]),
          Math.max(stageRange.min, Number.MIN_VALUE),
          stageRange.max,
        );
      // The exit segment scales by the Profile's release factors instead of the
      // table's exit ratio, so those products must satisfy the same constraints.
      finite(
        value * screen[releasePath],
        t('{0} at release factor {1}', [key, screen[releasePath]]),
        Math.max(stageRange.min, Number.MIN_VALUE),
        stageRange.max,
      );
    }
  }
  measuredNumber(
    screen,
    'screen',
    'pressDepthMm',
    t('press depth (mm)'),
    SCREEN_PRESS_DEPTH_RANGE_MM.min,
    SCREEN_PRESS_DEPTH_RANGE_MM.max,
  );
  measuredNumber(
    screen,
    'screen',
    'safeHeightMm',
    t('safe height (mm)'),
    Number.MIN_VALUE,
    100,
  );
  if (screen.pressDepthMm <= -screen.safeHeightMm)
    throw new SetupFieldError(
      'screen',
      'pressDepthMm',
      t('Safe height must exceed the magnitude of a negative press depth.'),
    );
  measuredNumber(
    screen,
    'screen',
    'contactMs',
    t('contact time (ms)'),
    30,
    1000,
  );
  measuredNumber(
    screen,
    'screen',
    'swipeEndpointHoldMs',
    t('swipe endpoint hold (ms)'),
    0,
    1000,
  );
  if (screen.swipeEndpointHoldMs !== 0 && screen.swipeEndpointHoldMs < 30)
    throw new SetupFieldError(
      'screen',
      'swipeEndpointHoldMs',
      t('Swipe endpoint hold must be zero or between 30 and 1000 ms.'),
    );
  measuredNumber(
    screen,
    'screen',
    'longPressMs',
    t('long press (ms)'),
    300,
    10000,
  );
  measuredNumber(
    screen,
    'screen',
    'dragHoldMs',
    t('drag endpoint hold (ms)'),
    30,
    1000,
  );
  measuredNumber(
    screen,
    'screen',
    'successorStartLeadMs',
    t('successor start lead (ms)'),
    0,
    200,
  );
  measuredNumber(
    screen,
    'screen',
    'motionTimeoutMs',
    t('motion timeout (ms)'),
    Number.MIN_VALUE,
    120000,
  );
  for (const [path, label] of [
    ['contactMs', t('Contact time')],
    ['swipeEndpointHoldMs', t('Swipe endpoint hold')],
    ['longPressMs', t('Long press')],
    ['dragHoldMs', t('Drag endpoint hold')],
    ['successorStartLeadMs', t('Successor start lead')],
  ] as const)
    if (!Number.isInteger(screen[path]))
      throw new SetupFieldError(
        'screen',
        path,
        t('{0} must be an integer number of milliseconds.', [label]),
      );
  // The store refuses a lead that would consume the whole press; refusing here
  // too means the operator is told before saving rather than at save time.
  const shortestTarget = Math.min(
    screen.contactMs,
    screen.dragHoldMs,
    screen.swipeEndpointHoldMs || Number.POSITIVE_INFINITY,
  );
  if (screen.successorStartLeadMs >= shortestTarget)
    throw new SetupFieldError(
      'screen',
      'successorStartLeadMs',
      t(
        'Successor start lead must be smaller than the shortest contact target ({0} ms).',
        [shortestTarget],
      ),
    );
}
export function screenRateModes(
  capabilities: EffectiveCapabilities | undefined,
  key: 'speed' | 'acceleration',
) {
  const motions =
    capabilities?.descriptors?.filter(
      (item) => item.id === 'motion.linear' || item.id === 'motion.ptp',
    ) ?? [];
  return (['ratio', 'linear'] as const).filter(
    (kind) =>
      motions.some((item) => item.id === 'motion.linear') &&
      motions.every((item) => Boolean(item.constraints?.[key]?.[kind])),
  );
}
