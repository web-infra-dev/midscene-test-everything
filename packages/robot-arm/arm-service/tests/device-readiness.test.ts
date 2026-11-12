import assert from 'node:assert/strict';
import { afterEach, test } from '@rstest/core';
import { checkDeviceCalibration } from '../src/ui/device-readiness';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function respond(data: unknown, status = 200) {
  globalThis.fetch = async () => new Response(JSON.stringify(data), { status });
}
test('accepted server configuration opens the workspace for the selected device', async () => {
  globalThis.fetch = async (url) => {
    assert.equal(url, '/api/devices/usb%2Fcamera/configuration');
    return new Response(
      JSON.stringify({
        calibration: { id: 'accepted' },
        screen: { id: 'screen' },
      }),
    );
  };
  assert.equal(await checkDeviceCalibration('usb/camera'), 'ready');
});
test('only explicit missing or invalid calibration enters preparation', async () => {
  respond(
    { code: 'CALIBRATION_REQUIRED', error: 'Calibrate this device' },
    409,
  );
  assert.equal(await checkDeviceCalibration('camera'), 'required');
});
test('service and camera errors stay retryable instead of launching calibration', async () => {
  respond({ code: 'CAMERA_UNAVAILABLE', error: 'Camera unavailable' }, 500);
  await assert.rejects(checkDeviceCalibration('camera'), /Camera unavailable/);
  globalThis.fetch = async () => {
    throw new Error('Network unavailable');
  };
  await assert.rejects(checkDeviceCalibration('camera'), /Network unavailable/);
});
test('malformed success cannot expose tasks', async () => {
  respond({});
  await assert.rejects(
    checkDeviceCalibration('camera'),
    /Invalid device configuration/,
  );
});
test('a cancelled check cannot resolve for the next selected camera', async () => {
  const abort = new AbortController();
  abort.abort();
  globalThis.fetch = async (_url, init) => {
    init?.signal?.throwIfAborted();
    throw new Error('Expected aborted signal');
  };
  await assert.rejects(checkDeviceCalibration('camera', abort.signal), {
    name: 'AbortError',
  });
});
