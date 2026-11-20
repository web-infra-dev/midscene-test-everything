// Measured tool geometry helpers migrated from robot-vision.
import { supportsFlangeContact } from '@midscene/robotics-shared/setup-contracts';
import { t } from '../../i18n';
import type { EffectiveCapabilities } from '../../robot-arm-api';
export type SetupProfile = Record<string, any>;
export const TOOL_AXES = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'] as const;
export type ToolAxis = (typeof TOOL_AXES)[number];
export class SetupFieldError extends Error {
  constructor(
    readonly kind: 'robot' | 'tool' | 'screen',
    readonly path: string,
    message: string,
  ) {
    super(message);
  }
}
export function axisVector(axis: ToolAxis) {
  const vector = { x: 0, y: 0, z: 0 };
  vector[axis[1].toLowerCase() as keyof typeof vector] =
    axis[0] === '+' ? 1 : -1;
  return vector;
}
export function axialTool(
  axis: ToolAxis,
  length: number | null,
  capabilities?: EffectiveCapabilities,
) {
  const direction = axisVector(axis);
  if (length === null && axis === '-Z' && supportsFlangeContact(capabilities))
    return {
      contactFrame: 'flange' as const,
      contactDirection: direction,
      offsetMm: { x: 0, y: 0, z: 0 },
    };
  if (length === null || !Number.isFinite(length) || length < 0)
    throw new Error(t('Enter a nonnegative measured length.'));
  return {
    contactDirection: direction,
    offsetMm: {
      x: direction.x * length,
      y: direction.y * length,
      z: direction.z * length,
    },
  };
}
export function inferAxialTool(
  tool: SetupProfile,
): { axis: ToolAxis; length: number } | undefined {
  for (const axis of TOOL_AXES) {
    const direction = axisVector(axis);
    const keys = ['x', 'y', 'z'] as const;
    if (!keys.every((key) => tool.contactDirection?.[key] === direction[key]))
      continue;
    if (
      !keys.every(
        (key) =>
          typeof tool.offsetMm?.[key] === 'number' &&
          Number.isFinite(tool.offsetMm[key]),
      )
    )
      continue;
    const length = keys.reduce(
      (sum, key) => sum + tool.offsetMm[key] * direction[key],
      0,
    );
    if (
      length >= 0 &&
      keys.every((key) => tool.offsetMm[key] === direction[key] * length)
    )
      return { axis, length };
  }
  return undefined;
}
export function recommendedToolAxis(capabilities?: EffectiveCapabilities): {
  axis: ToolAxis;
  locked: boolean;
} {
  return {
    axis: '-Z',
    locked: Boolean(capabilities && capabilities.orientation !== 'full'),
  };
}
