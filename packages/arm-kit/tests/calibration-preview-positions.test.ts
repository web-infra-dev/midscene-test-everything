import { expect, it } from '@rstest/core';
import type { AssistedCalibrationState } from '../src/assisted-contracts.js';
import {
  calibrationPreviewPositions,
  projectPreviewPositions,
} from '../src/calibration-server/preview-positions.js';
import type { CameraSession } from '../src/camera/session.js';
import type { CameraCorrection } from '../src/contracts.js';
import { fixture, pose } from './fixtures.js';

const correction: CameraCorrection = {
  sourceWidth: 640,
  sourceHeight: 480,
  rotation: 0,
  points: {
    topLeft: { x: 100, y: 100 },
    topRight: { x: 300, y: 100 },
    bottomRight: { x: 300, y: 200 },
    bottomLeft: { x: 100, y: 200 },
  },
};

it('uses the perspective centre only for a recorded reference before fitting', () => {
  const trapezoid = {
    ...correction,
    points: {
      ...correction.points,
      bottomLeft: { x: 50, y: 200 },
      bottomRight: { x: 350, y: 200 },
    },
  };
  const markers = projectPreviewPositions(trapezoid, {
    reference: pose(),
    safe: pose(),
    cameraBoundary: pose(40, 0),
  });
  expect(markers?.reference?.x).toBeCloseTo(200);
  expect(markers?.reference?.y).toBeCloseTo(140);
  expect(markers?.safe).toBeUndefined();
  expect(markers?.cameraBoundary).toBeUndefined();
  expect(projectPreviewPositions(correction, {})).toBeUndefined();
});

it('uses the stylus footprint, output rotation and extrapolation outside the phone', async () => {
  const f = await fixture();
  try {
    for (const geometryFrame of [undefined, 'screen'] as const) {
      const fit = {
        calibration: { ...f.calibration, geometryFrame },
        screen: f.screen,
        offsetMm: { x: 10, y: 0, z: -40 },
      };
      const positions = projectPreviewPositions(
        { ...correction, rotation: 90 },
        { reference: pose(90, -50, 70), safe: pose(190, -125, 95) },
        fit,
      );
      expect(positions?.reference?.x).toBeCloseTo(200);
      expect(positions?.reference?.y).toBeCloseTo(150);
      expect(positions?.safe?.x).toBeCloseTo(350);
      expect(positions?.safe?.y).toBeCloseTo(100);
    }
  } finally {
    await f.cleanup();
  }
});

it('displays the accepted parking pose only for its current camera mapping', async () => {
  const f = await fixture();
  try {
    const workstation = f.store.list().workstation!;
    await f.store.acceptDeviceBinding({
      ...workstation,
      deviceId: 'phone',
      revision: 0,
      vision: workstation.vision!,
    });
    let current = true;
    const camera = {
      camera: { id: 'cam' },
      getCorrection: () => correction,
      getPerspectiveValidity: () => undefined,
      isBindingCurrent: () => current,
    } as unknown as CameraSession;
    const read = () => calibrationPreviewPositions(f.runtime, camera, 'phone');
    expect(read()?.safe?.x).toBeCloseTo(200);
    expect(read()?.reference).toBeUndefined();
    const session = {
      stage: 'safety',
      mapping: { vision: workstation.vision },
      referencePosition: pose(50, -25, 70),
      cameraBoundaryPosition: pose(50, -75, 70),
      calibration: {
        candidate: {
          ...f.calibration,
          acceptanceStatus: 'pending',
          observationPose: pose(50, -25, 70),
        },
      },
    } as AssistedCalibrationState;
    const live = () =>
      calibrationPreviewPositions(f.runtime, camera, 'phone', { session });
    expect(live()?.reference?.x).toBeCloseTo(150);
    expect(live()?.safe).toBeUndefined();
    expect(live()?.cameraBoundary?.x).toBeCloseTo(150);
    expect(live()?.cameraBoundary?.y).toBeCloseTo(175);
    session.safePosition = pose(220, -50, 90);
    expect(live()?.safe?.x).toBeCloseTo(320);
    await f.store.saveInstallationTeaching({
      ...f.binding,
      id: 'teaching',
      cameraId: 'cam',
      referenceDeviceId: 'phone',
      recordedAt: new Date().toISOString(),
      robotGeometryRevision: f.robot.geometryRevision,
      toolGeometryRevision: f.tool.geometryRevision,
      referencePose: pose(50, -25, 70),
      poses: {
        reference: pose(50, -25, 70),
        cameraBoundary: pose(50, -75, 70),
      },
      cameraBoundary: { point: { x: 50, y: -75 }, normal: { x: 0, y: -1 } },
      corridorConfirmed: true,
    });
    expect(read()?.cameraBoundary?.y).toBeCloseTo(175);
    current = false;
    expect(read()?.cameraBoundary).toBeUndefined();
    expect(read()?.safe).toBeUndefined();
  } finally {
    await f.cleanup();
  }
});
