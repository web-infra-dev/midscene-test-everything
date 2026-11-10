import { verifyCameraModel } from '@midscene/robotics-vision/camera/verify-model';
import { expect, it, rstest } from '@rstest/core';
const calls = rstest.hoisted(() => ({ verify: rstest.fn() }));
rstest.mock('@midscene/core', () => ({ runConnectivityTest: calls.verify }));
it('verifies the supplied calibration model without changing process settings', async () => {
  const before = process.env.MIDSCENE_MODEL_NAME;
  calls.verify.mockResolvedValue({ passed: true, checks: [], requestCount: 0 });
  const result = await verifyCameraModel({
    MIDSCENE_MODEL_NAME: 'camera-test',
    MIDSCENE_MODEL_FAMILY: 'qwen3.6',
    MIDSCENE_MODEL_API_KEY: 'test-only',
    MIDSCENE_MODEL_BASE_URL: 'https://model.test/v1',
  });
  expect(result.passed).toBe(true);
  expect(calls.verify).toHaveBeenCalledTimes(1);
  expect(calls.verify.mock.calls[0][0].planningModelConfig.modelName).toBe(
    'camera-test',
  );
  expect(process.env.MIDSCENE_MODEL_NAME).toBe(before);
});
it('rejects incomplete configuration before invoking the model', async () => {
  calls.verify.mockClear();
  await expect(
    verifyCameraModel({ MIDSCENE_MODEL_NAME: 'test' }),
  ).rejects.toThrow('模型系列');
  expect(calls.verify).not.toHaveBeenCalled();
});
