import { RobotArmError } from '../contracts.js';
type WebPoint = { x: number; y: number };
export function project(matrix: readonly number[], p: WebPoint): WebPoint {
  if (matrix.length !== 9 || !matrix.every(Number.isFinite))
    throw new RobotArmError(
      'INVALID_MAPPING',
      'A finite 3 × 3 image mapping is required',
    );
  const d = matrix[6] * p.x + matrix[7] * p.y + matrix[8];
  if (Math.abs(d) < 1e-9)
    throw new RobotArmError('INVALID_MAPPING', 'Image mapping is singular');
  return {
    x: (matrix[0] * p.x + matrix[1] * p.y + matrix[2]) / d,
    y: (matrix[3] * p.x + matrix[4] * p.y + matrix[5]) / d,
  };
}

export function invertMapping(matrix: readonly number[]): number[] {
  if (matrix.length !== 9 || !matrix.every(Number.isFinite))
    throw new RobotArmError(
      'INVALID_MAPPING',
      'A finite 3 × 3 image mapping is required',
    );
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const inverse = [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ];
  const determinant = a * inverse[0] + b * inverse[3] + c * inverse[6];
  if (Math.abs(determinant) < 1e-12)
    throw new RobotArmError('INVALID_MAPPING', 'Image mapping is singular');
  return inverse.map((v) => v / determinant);
}
