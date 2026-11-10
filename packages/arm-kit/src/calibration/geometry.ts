import {
  type CalibrationProfile,
  type CartesianPose,
  type RobotArmCapabilities,
  RobotArmError,
  SCREEN_TILT_LIMIT_DEGREES,
  type ScreenProfile,
  type ToolProfile,
  type Vector3,
  assertScreenMapping,
} from '../contracts.js';
import {
  add,
  align,
  cross,
  distance,
  dot,
  flangePose,
  multiply,
  rotate,
  scale,
  sub,
  unit,
} from '../domain.js';
import { invertMapping, project } from '../domain/homography.js';
import {
  SAMPLED_SURFACE_LIMIT_MM,
  surfaceClearanceMm,
  surfaceOffsetMm,
} from './surface.js';

/** Validate each reference point before advancing the sampling task. */
export function assertScreenPoint(
  plane: CalibrationProfile['plane'],
  point: Vector3,
  name: 'P1' | 'P2',
): void {
  const signedDistanceMm = dot(unit(plane.normal), point) - plane.offset;
  const distanceMm = Math.abs(signedDistanceMm);
  // screenGeometry projects the reference onto the plane within the supported Z travel.
  const toleranceMm = SAMPLED_SURFACE_LIMIT_MM;
  if (!Number.isFinite(distanceMm) || distanceMm > toleranceMm)
    throw new RobotArmError(
      'POINT_OFF_PLANE',
      `${name} is ${distanceMm.toFixed(3)} mm from the fitted screen (maximum ${toleranceMm.toFixed(3)} mm). Recapture ${name} with the contact tip gently touching the screen.`,
      400,
      {
        point: name,
        measuredPoint: point,
        signedDistanceMm,
        distanceMm,
        toleranceMm,
      },
    );
}
export function screenGeometry(
  plane: CalibrationProfile['plane'],
  p1: Vector3,
  p2: Vector3,
  reference: CartesianPose['orientation'],
  tool: ToolProfile,
  caps: RobotArmCapabilities,
): Pick<
  CalibrationProfile,
  'kind' | 'origin' | 'xAxis' | 'yAxis' | 'inward' | 'orientation' | 'plane'
> {
  const n = unit(plane.normal);
  assertScreenPoint(plane, p1, 'P1');
  assertScreenPoint(plane, p2, 'P2');
  const projected = sub(sub(p2, p1), scale(n, dot(n, sub(p2, p1))));
  if (distance(projected, { x: 0, y: 0, z: 0 }) < 1)
    throw new RobotArmError(
      'CALIBRATION_POINTS_TOO_CLOSE',
      'P1/P2 projected distance must be at least 1mm',
    );
  if (caps.orientation !== 'full') {
    const inward = unit(rotate(reference, tool.contactDirection));
    const tilt =
      (Math.acos(Math.min(1, Math.max(-1, dot(inward, n)))) * 180) / Math.PI;
    if (tilt > (caps.screenNormalToleranceDegrees ?? SCREEN_TILT_LIMIT_DEGREES))
      throw new RobotArmError(
        'SCREEN_TILT_UNSUPPORTED',
        'Plane normal exceeds the supported contact direction tolerance',
        422,
        { tilt },
      );
    const xAxis = unit(projected);
    return {
      kind: 'restrictedPlane',
      origin: add(
        p1,
        scale(inward, (plane.offset - dot(n, p1)) / dot(n, inward)),
      ),
      xAxis,
      yAxis: unit(cross(n, xAxis)),
      inward,
      orientation: reference,
      plane,
    };
  }
  const xAxis = unit(projected);
  const orientation = multiply(
    align(rotate(reference, tool.contactDirection), n),
    reference,
  );
  return {
    kind: 'spatialPlane',
    origin: sub(p1, scale(n, dot(n, p1) - plane.offset)),
    xAxis,
    yAxis: unit(cross(n, xAxis)),
    inward: n,
    orientation,
    plane,
  };
}
export function screenContact(
  c: CalibrationProfile,
  s: ScreenProfile,
  point: { x: number; y: number },
): Vector3 {
  assertScreenMapping(s);
  if (
    !point ||
    ![point.x, point.y].every(Number.isFinite) ||
    point.x < 0 ||
    point.y < 0 ||
    point.x >= s.pixelWidth ||
    point.y >= s.pixelHeight
  )
    throw new RobotArmError(
      'INVALID_SCREEN_POINT',
      'Pixel coordinates are outside [0,width) × [0,height)',
    );
  if (c.geometryFrame === 'screen')
    return screenContactMm(c, {
      x:
        (Math.min(point.x, s.pixelWidth - 1) / (s.pixelWidth - 1)) *
        s.physicalWidthMm,
      y:
        (Math.min(point.y, s.pixelHeight - 1) / (s.pixelHeight - 1)) *
        s.physicalHeightMm,
    });
  const mapping = s.phoneMapping;
  if (
    !mapping ||
    mapping.width !== c.phoneFrame.width ||
    mapping.height !== c.phoneFrame.height
  )
    throw new RobotArmError(
      'MAPPING_REQUIRED',
      'Confirm the camera-to-phone mapping for this calibration',
    );
  // The corrected image corners are pixel centres at W-1/H-1. Preserve
  // subpixels inside that rectangle, but do not extrapolate its last pixel.
  const phone = project(mapping.imageToPhone, {
    x: Math.min(point.x, s.pixelWidth - 1),
    y: Math.min(point.y, s.pixelHeight - 1),
  });
  // Image bounds were checked above. Browser chrome may lie outside the
  // viewport: extrapolate the measured phone frame, never clamp it to an edge.
  return screenContactMm(c, {
    x: (phone.x / c.phoneFrame.width) * s.physicalWidthMm,
    y: (phone.y / c.phoneFrame.height) * s.physicalHeightMm,
  });
}
/** Convert a phone feedback/verification point into the fitted metric frame. */
export function phonePointMm(
  c: Pick<CalibrationProfile, 'geometryFrame' | 'phoneFrame'>,
  s: ScreenProfile,
  point: { x: number; y: number },
) {
  if (c.geometryFrame !== 'screen')
    return {
      x: (point.x / c.phoneFrame.width) * s.physicalWidthMm,
      y: (point.y / c.phoneFrame.height) * s.physicalHeightMm,
    };
  assertScreenMapping(s);
  if (!s.phoneMapping)
    throw new RobotArmError('MAPPING_REQUIRED', 'Phone mapping is required');
  const pixel = project(invertMapping(s.phoneMapping.imageToPhone), point);
  return {
    x: (pixel.x / (s.pixelWidth - 1)) * s.physicalWidthMm,
    y: (pixel.y / (s.pixelHeight - 1)) * s.physicalHeightMm,
  };
}
export function screenContactMm(
  c: CalibrationProfile,
  point: { x: number; y: number },
): Vector3 {
  if (!point || ![point.x, point.y].every(Number.isFinite))
    throw new RobotArmError(
      'INVALID_SCREEN_POINT',
      'Screen millimeters must be finite',
    );
  return add(
    add(c.origin, add(scale(c.xAxis, point.x), scale(c.yAxis, point.y))),
    scale(c.inward, surfaceOffsetMm(c.surface, point)),
  );
}
export function screenPoseMm(
  c: CalibrationProfile,
  t: ToolProfile,
  point: { x: number; y: number },
  depthMm: number,
): CartesianPose {
  if (!Number.isFinite(depthMm))
    throw new RobotArmError(
      'INVALID_SCREEN_POINT',
      'Contact travel must be finite',
    );
  return flangePose(
    add(screenContactMm(c, point), scale(c.inward, depthMm)),
    c.orientation,
    t.offsetMm,
  );
}
export function screenPose(
  c: CalibrationProfile,
  s: ScreenProfile,
  t: ToolProfile,
  point: { x: number; y: number },
  depthMm: number,
): CartesianPose {
  return flangePose(
    add(screenContact(c, s, point), scale(c.inward, depthMm)),
    c.orientation,
    t.offsetMm,
  );
}

/** Hover around the full corrected display, including outside the webpage viewport. */
export function screenHoverBoundary(
  c: CalibrationProfile,
  s: ScreenProfile,
  t: ToolProfile,
): CartesianPose[] {
  assertScreenMapping(s);
  const corners = [
    { x: 0, y: 0 },
    { x: s.pixelWidth - 1, y: 0 },
    { x: s.pixelWidth - 1, y: s.pixelHeight - 1 },
    { x: 0, y: s.pixelHeight - 1 },
  ];
  const h = s.phoneMapping?.imageToPhone;
  if (!h)
    throw new RobotArmError(
      'MAPPING_REQUIRED',
      'Confirm the full-screen camera mapping',
    );
  const denominators = corners.map((p) => h[6] * p.x + h[7] * p.y + h[8]);
  if (
    !denominators.every(
      (d) =>
        Number.isFinite(d) &&
        Math.abs(d) > 1e-9 &&
        Math.sign(d) === Math.sign(denominators[0]),
    )
  )
    throw new RobotArmError(
      'INVALID_MAPPING',
      'Camera mapping cannot be extrapolated across the full display',
    );
  return corners.map((p) =>
    screenPose(
      { ...c, surface: undefined },
      s,
      t,
      p,
      -s.safeHeightMm - surfaceClearanceMm(c.surface),
    ),
  );
}
