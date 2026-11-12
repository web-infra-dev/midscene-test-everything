import {
  type CalibrationProfile,
  type RobotArmCapabilities,
  RobotArmError,
  type ToolProfile,
} from '../../contracts.js';
import {
  type AutoCalibrationSample,
  autoCalibrationGeometry,
  maxSurfaceResidualMm,
  measuredScreenPixel,
  screenResidualMm,
} from './geometry.js';
import { explorationQualityWarnings } from './quality.js';
import type { runAutoExploration } from './sampler.js';
export function fitExploration(
  collection: Awaited<ReturnType<typeof runAutoExploration>>,
  tool: ToolProfile,
  capabilities: RobotArmCapabilities,
  binding: Pick<
    CalibrationProfile,
    | 'id'
    | 'robotProfileId'
    | 'toolProfileId'
    | 'screenProfileId'
    | 'robotGeometryRevision'
    | 'toolGeometryRevision'
    | 'screenGeometryRevision'
  >,
  fast: boolean,
) {
  const { probes, grid, start, screen } = collection;
  const validationGrid = grid.filter(
    (point) => point.target.role === 'validation',
  );
  if (validationGrid.length < 2)
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      'Fewer than two validation touches were collected',
      409,
    );
  const samples: AutoCalibrationSample[] = [
    ...probes,
    ...grid.filter((point) => point.target.role === 'fit'),
  ].map((point) => ({
    robot: { x: point.contact.x, y: point.contact.y, z: point.contact.z },
    screen: point.screen,
    weight: point.weight,
  }));
  const result = autoCalibrationGeometry({
    startPose: start,
    samples,
    screen,
    tool,
    capabilities: capabilities,
    binding,
  });
  const validationResiduals = validationGrid.map((point) => {
    const predicted = measuredScreenPixel(
      result.candidate,
      result.frame,
      point.contact,
    );
    const offset = {
      x: predicted.x - point.screen.x,
      y: predicted.y - point.screen.y,
    };
    return {
      px: Math.hypot(offset.x, offset.y),
      mm: screenResidualMm(result.frame, offset),
    };
  });
  // Holdouts measure the independently fitted surface and never train it.
  const validationHeightMaxMm = maxSurfaceResidualMm(
    result.candidate,
    validationGrid.map((point) => point.contact),
  );

  // Validation targets were excluded from both plane and XY fitting above.
  const gridRmsPx = result.gridRmsPx;
  const validationRmsPx = Math.sqrt(
    validationResiduals.reduce((sum, value) => sum + value.px * value.px, 0) /
      validationResiduals.length,
  );
  const validationMaxPx = Math.max(...validationResiduals.map(({ px }) => px));
  const validationMaxMm = Math.max(...validationResiduals.map(({ mm }) => mm));
  if (
    ![
      result.gridRmsMm,
      result.coverage,
      validationMaxMm,
      validationRmsPx,
      validationHeightMaxMm,
    ].every(Number.isFinite)
  )
    throw new RobotArmError(
      'CALIBRATION_QUALITY',
      'Touch measurements must produce finite residuals and coverage',
      409,
    );
  const evidence = {
    planeSource: fast ? 'assumed-horizontal' : 'measured',
    planeRmseMm: result.quality.rmseMm,
    gridRmsPx,
    gridRmsMm: result.gridRmsMm,
    validationRmsPx,
    validationMaxPx,
    validationMaxMm,
    validationHeightMaxMm,
    axisSkewRatio: result.axisSkewRatio,
    coverage: result.coverage,
    surfaceMaxMm: result.surfaceMaxMm,
    samples: [...probes, ...grid].map((point) => ({
      screen: point.screen,
      planeMm: { x: point.contact.x, y: point.contact.y },
      zMm: point.contact.z,
    })),
  };
  return {
    ...result,
    evidence,
    warnings: explorationQualityWarnings(
      result.measuredSize,
      result.quality,
      evidence,
    ),
  };
}
