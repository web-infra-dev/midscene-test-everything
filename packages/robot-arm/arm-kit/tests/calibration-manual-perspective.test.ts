import { expect, it, rstest } from '@rstest/core';
import { CalibrationSetup } from '../src/calibration/setup.js';

it('rebinds a manual perspective without redetecting the page mapping', async () => {
  const webToImage = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const layout = {
    revision: 1,
    width: 400,
    height: 800,
    screen: { width: 400, height: 800, devicePixelRatio: 1 },
    markers: [],
  };
  const previousVision = {
    cameraId: 'cam',
    cameraName: 'Camera',
    perspectiveProfileKey: 'screen-a',
    fingerprint: 'old-perspective',
    width: 1000,
    height: 500,
  };
  const nextVision = { ...previousVision, fingerprint: 'manual-perspective' };
  const binding = rstest.fn(async () => nextVision);
  const detectMarkers = rstest.fn();
  const saveCalibrationMapping = rstest.fn(async () => undefined);
  const setup = Object.create(CalibrationSetup.prototype) as CalibrationSetup;
  Object.assign(setup, {
    input: {
      robotProfileId: 'robot',
      toolProfileId: 'tool',
      cameraId: 'cam',
      width: 1000,
      height: 500,
    },
    mapping: {
      vision: previousVision,
      layout,
      webToImage,
      markerErrorPx: 0.4,
      accuracy: {
        fit: { count: 4, meanErrorCssPx: 0.2, maxErrorCssPx: 0.4 },
        validation: { count: 2, meanErrorCssPx: 0.3, maxErrorCssPx: 0.5 },
      },
    },
    geometryKey: 'geometry',
    deviceId: 'screen-a',
    phone: {
      available: () => true,
      update: { layout },
    },
    vision: { binding, detectMarkers },
    runtime: {
      profileStore: {
        installationTeaching: () => undefined,
        saveCalibrationMapping,
      },
    },
  });
  const updateSaved = rstest
    .spyOn(
      setup as unknown as {
        updateSavedCameraMapping(): Promise<void>;
      },
      'updateSavedCameraMapping',
    )
    .mockResolvedValue(undefined);

  const result = await setup.rebindCurrentMapping();

  expect(binding).toHaveBeenCalledTimes(1);
  expect(detectMarkers).not.toHaveBeenCalled();
  expect(result.mapping?.vision).toEqual(nextVision);
  expect(result.mapping?.webToImage).toEqual(webToImage);
  expect(result.mapping?.accuracy).toMatchObject({
    fit: { count: 4 },
    validation: { count: 2 },
  });
  expect(saveCalibrationMapping).toHaveBeenCalledWith('screen-a', {
    geometryKey: 'geometry',
    accuracyBasis: 'outer-markers',
    mapping: result.mapping,
  });
  updateSaved.mockRestore();
});
