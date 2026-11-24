import { RobotArmError } from '@midscene/arm-kit';
import { expect, it, rstest } from '@rstest/core';
import { PlaygroundDevices } from '../src/server/devices';

it('publishes camera imaging setup failures before calibration starts', async () => {
  const failure = new RobotArmError(
    'PHONE_UNAVAILABLE',
    'Phone left disconnected',
    409,
  );
  const token = 'calibration-token';
  const beginScreensImaging = rstest.fn(() => token);
  const failScreensImaging = rstest.fn();
  const calibrateScreens = rstest.fn();
  const devices = Object.create(
    PlaygroundDevices.prototype,
  ) as PlaygroundDevices;
  Object.assign(devices, {
    entries: new Map([
      [
        'left',
        {
          cameraId: 'cam',
          host: {},
          device: { id: 'left' },
          camera: {
            beginScreensImaging,
            failScreensImaging,
            calibrateScreens,
          },
        },
      ],
    ]),
    setCameraImagingPattern: rstest.fn().mockRejectedValue(failure),
  });

  await expect(devices.calibrateCameraImaging('cam', ['left'])).rejects.toBe(
    failure,
  );

  expect(beginScreensImaging).toHaveBeenCalledWith(['left']);
  expect(failScreensImaging).toHaveBeenCalledWith(token, ['left'], failure);
  expect(calibrateScreens).not.toHaveBeenCalled();
});
