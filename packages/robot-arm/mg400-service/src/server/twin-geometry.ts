import type { ToolProfile, Vector3 } from '@midscene/robotics-shared/contracts';

type TwinToolGeometry = Pick<ToolProfile, 'contactFrame' | 'offsetMm'>;

// Display convention for a vertical pen whose installed length is unknown.
export function visualTipOffsetMm(tool?: TwinToolGeometry): Vector3 {
  return !tool || tool.contactFrame === 'flange'
    ? { x: 0, y: 0, z: -115 }
    : tool.offsetMm;
}

export function visualScreenOriginMm(origin: Vector3, tool?: TwinToolGeometry) {
  // Flange-contact calibration supports a vertical tool with fixed tilt, so
  // the offset is along base Z even for a tilted screen or a rotated wrist.
  return tool?.contactFrame === 'flange'
    ? { ...origin, z: origin.z + visualTipOffsetMm(tool).z }
    : { ...origin };
}
